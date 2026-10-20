"""Access control for every admin endpoint (T088), with real signed tokens.

T088 acceptance: when a regular user calls product admin endpoints, a 403 is returned.

Every route under /admin is found automatically, so admin endpoints added later (e.g. store and
stock management, T094) are covered without editing this file; one that forgets the admin check
fails here. Requests carry real signed access tokens, so the whole chain runs as in the app:
token check, the user's role from the users table, then the admin check. The data stand-ins are
tripwires, which proves a denied request never reads or changes anything.

Saving changes as an admin is tested in test_admin_products.py and test_admin_users.py.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.core.auth import TokenVerifier
from app.core.config import load_settings
from app.main import create_app
from app.repositories.products import get_product_repository
from app.repositories.ratings import get_rating_repository
from app.repositories.users import get_user_repository
from tests.conftest import VALID_DATABASE_URL, VALID_SUPABASE_URL
from tests.fakes import FakeUsers

ISSUER = f"{VALID_SUPABASE_URL}/auth/v1"
SHOPPER_ID = UUID("b0000000-0000-4000-8000-000000000002")
ADMIN_ID = UUID("a0000000-0000-4000-8000-000000000001")

# The admin endpoints that exist today. The route list must include at least these, so the
# automatic discovery below can't silently find nothing.
KNOWN_ADMIN_ROUTES = {
    ("GET", "/admin/users"),
    ("GET", "/admin/products"),
    ("PATCH", "/admin/users/{user_id}"),
    ("POST", "/admin/products"),
    ("PATCH", "/admin/products/{product_id}"),
    ("DELETE", "/admin/products/{product_id}"),
}

# A valid value for each path parameter, so requests reach the access check.
PATH_VALUES = {"product_id": "7", "user_id": str(SHOPPER_ID)}

# A body that passes validation for every admin endpoint that takes one, so a 422 can't hide a
# missing access check. (Extra fields don't matter: access is checked first.)
BODY = {"barcode": "036000291452", "name": "Sample Chips", "role": "admin", "active": True}


class TrippedError(AssertionError):
    """Raised when a request reaches data through a Tripwire."""


class Tripwire:
    """Stands in for a repository the endpoint uses after the access check. Any use raises
    TrippedError, so a denied request that reads or changes data fails the test."""

    def __init__(self, name: str) -> None:
        self._name = name

    def __getattr__(self, method: str) -> Any:
        raise TrippedError(f"the request used {self._name}.{method}()")


def admin_routes(app) -> list[tuple[str, str]]:
    """Every (method, path) under /admin, from the app's own API description (the one /docs
    shows). A route hidden from the docs (include_in_schema=False) wouldn't be listed, so admin
    routes must stay in the docs."""
    return sorted(
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.startswith("/admin")
        for method in operations
    )


def fill(path: str) -> str:
    return path.format(**PATH_VALUES)


# Read from the app when the tests are collected: one test case per admin route.
ADMIN_ROUTES = admin_routes(
    create_app(
        load_settings(
            _env_file=None, database_url=VALID_DATABASE_URL, supabase_url=VALID_SUPABASE_URL
        )
    )
)
each_admin_route = pytest.mark.parametrize(
    "admin_route", ADMIN_ROUTES, ids=[f"{method} {path}" for method, path in ADMIN_ROUTES]
)


@pytest.fixture(scope="module")
def private_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def token(key: rsa.RSAPrivateKey, user_id: UUID) -> str:
    """A signed Supabase-style access token for this user, valid for an hour."""
    now = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "email": f"{user_id.hex[:6]}@example.com",
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + timedelta(hours=1),
    }
    return jwt.encode(claims, key, algorithm="RS256")


@pytest.fixture
def users() -> FakeUsers:
    """The users table: a regular user, and an admin."""
    users = FakeUsers()
    users.get_or_create(SHOPPER_ID, "shopper@example.com")
    users.get_or_create(ADMIN_ID, "admin@example.com")
    users.update(ADMIN_ID, role="admin")
    return users


@pytest.fixture
def client(make_client, private_key, users) -> TestClient:
    """The real app, trusting tokens signed with private_key instead of Supabase's keys."""
    client = make_client()
    client.app.state.token_verifier = TokenVerifier(
        ISSUER, key_resolver=lambda _token: private_key.public_key()
    )
    client.app.dependency_overrides[get_user_repository] = lambda: users
    client.app.dependency_overrides[get_product_repository] = lambda: Tripwire("products")
    client.app.dependency_overrides[get_rating_repository] = lambda: Tripwire("ratings")
    return client


def call(client: TestClient, method: str, path: str, auth: str | None) -> Any:
    headers = {"Authorization": f"Bearer {auth}"} if auth else {}
    return client.request(method, fill(path), json=BODY, headers=headers)


def test_every_known_admin_route_is_checked() -> None:
    assert KNOWN_ADMIN_ROUTES <= set(ADMIN_ROUTES)


def test_product_admin_endpoints_return_403_to_regular_users(client, private_key) -> None:
    product_routes = [route for route in ADMIN_ROUTES if route[1].startswith("/admin/products")]
    assert len(product_routes) >= 3  # create, edit, delete

    for method, path in product_routes:
        response = call(client, method, path, token(private_key, SHOPPER_ID))

        assert response.status_code == 403, (method, path)
        assert response.json() == {
            "code": "forbidden",
            "message": "You don't have permission to do that.",
        }, (method, path)


@each_admin_route
def test_regular_user_gets_403(client, private_key, users, admin_route) -> None:
    method, path = admin_route

    response = call(client, method, path, token(private_key, SHOPPER_ID))

    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"
    assert users.accounts[SHOPPER_ID].role == "user"  # couldn't promote themselves either


@each_admin_route
def test_no_token_gets_401(client, admin_route) -> None:
    method, path = admin_route

    response = call(client, method, path, auth=None)

    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"


@each_admin_route
@pytest.mark.parametrize("bad_token", ["not-a-token", "a.b.c"])
def test_garbage_token_gets_401(client, admin_route, bad_token) -> None:
    method, path = admin_route

    assert call(client, method, path, bad_token).status_code == 401


@each_admin_route
def test_token_signed_by_someone_else_gets_401(client, admin_route) -> None:
    # A forged token claiming to be the admin, signed with a key the API doesn't trust.
    method, path = admin_route
    forger = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    assert call(client, method, path, token(forger, ADMIN_ID)).status_code == 401


@each_admin_route
def test_expired_admin_token_gets_401(client, private_key, admin_route) -> None:
    method, path = admin_route
    now = datetime.now(UTC)
    expired = jwt.encode(
        {
            "sub": str(ADMIN_ID),
            "aud": "authenticated",
            "iss": ISSUER,
            "iat": now - timedelta(hours=2),
            "exp": now - timedelta(hours=1),
        },
        private_key,
        algorithm="RS256",
    )

    assert call(client, method, path, expired).status_code == 401


@each_admin_route
def test_deactivated_admin_gets_403(client, private_key, users, admin_route) -> None:
    method, path = admin_route
    users.update(ADMIN_ID, active=False)

    response = call(client, method, path, token(private_key, ADMIN_ID))

    assert response.status_code == 403
    assert response.json()["code"] == "account_deactivated"


@each_admin_route
def test_admin_gets_past_the_access_check(client, private_key, admin_route) -> None:
    # With a real admin token the request goes on to the endpoint: it either reaches the data
    # (the tripwire, for products) or succeeds (the fake users table) instead of a 401 or 403.
    method, path = admin_route

    try:
        response = call(client, method, path, token(private_key, ADMIN_ID))
    except TrippedError:
        return
    assert response.status_code not in (401, 403)
