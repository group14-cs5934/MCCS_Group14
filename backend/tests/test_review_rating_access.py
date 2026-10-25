"""Sign-in is required to write reviews and ratings (T072), with real signed tokens.

T072 acceptance: when an anonymous user tries to post a review or rating, a 401 is returned.

Every review and rating route that needs a user is found automatically (each POST and DELETE, and
the GET .../me routes), so ones added later are covered without editing this file. The data
stand-ins are tripwires, which proves a rejected request never reads or changes anything. The
public routes (a product's reviews and rating average) are checked to stay public.
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
from app.repositories.ratings import get_rating_repository
from app.repositories.reviews import get_review_repository
from app.repositories.users import get_user_repository
from tests.conftest import VALID_DATABASE_URL, VALID_SUPABASE_URL
from tests.fakes import FakeUsers

ISSUER = f"{VALID_SUPABASE_URL}/auth/v1"
SHOPPER_ID = UUID("b0000000-0000-4000-8000-000000000002")

# The routes that must need a user today; discovery must find at least these.
KNOWN_PRIVATE_ROUTES = {
    ("POST", "/products/{product_id}/reviews"),
    ("POST", "/products/{product_id}/ratings"),
    ("GET", "/products/{product_id}/reviews/me"),
    ("GET", "/products/{product_id}/ratings/me"),
    ("DELETE", "/products/{product_id}/reviews/me"),
    ("DELETE", "/products/{product_id}/ratings/me"),
}
PUBLIC_ROUTES = [
    ("GET", "/products/{product_id}/reviews"),
    ("GET", "/products/{product_id}/ratings"),
]

# A body that passes validation for both POSTs, so a 422 can't hide a missing sign-in check.
BODY = {"body": "Crunchy and not too salty.", "stars": 4}


class TrippedError(AssertionError):
    """Raised when a request reaches data through a Tripwire."""


class Tripwire:
    """Stands in for a repository; any use raises TrippedError."""

    def __init__(self, name: str) -> None:
        self._name = name

    def __getattr__(self, method: str) -> Any:
        raise TrippedError(f"the request used {self._name}.{method}()")


def private_routes(app) -> list[tuple[str, str]]:
    """Every review or rating route that writes, or reads the caller's own (".../me")."""
    return sorted(
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.endswith(("/reviews", "/ratings", "/reviews/me", "/ratings/me"))
        for method in operations
        if method != "get" or path.endswith("/me")
    )


PRIVATE_ROUTES = private_routes(
    create_app(
        load_settings(
            _env_file=None, database_url=VALID_DATABASE_URL, supabase_url=VALID_SUPABASE_URL
        )
    )
)
each_private_route = pytest.mark.parametrize(
    "route", PRIVATE_ROUTES, ids=[f"{method} {path}" for method, path in PRIVATE_ROUTES]
)


@pytest.fixture(scope="module")
def private_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def token(key: rsa.RSAPrivateKey, user_id: UUID, expires_in: timedelta = timedelta(hours=1)):
    now = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "email": "shopper@example.com",
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now - timedelta(hours=2),
        "exp": now + expires_in,
    }
    return jwt.encode(claims, key, algorithm="RS256")


@pytest.fixture
def users() -> FakeUsers:
    users = FakeUsers()
    users.get_or_create(SHOPPER_ID, "shopper@example.com")
    return users


@pytest.fixture
def client(make_client, private_key, users) -> TestClient:
    """The real app, trusting tokens signed with private_key, with tripwires for the data."""
    client = make_client()
    client.app.state.token_verifier = TokenVerifier(
        ISSUER, key_resolver=lambda _token: private_key.public_key()
    )
    client.app.dependency_overrides[get_user_repository] = lambda: users
    client.app.dependency_overrides[get_review_repository] = lambda: Tripwire("reviews")
    client.app.dependency_overrides[get_rating_repository] = lambda: Tripwire("ratings")
    return client


def call(client: TestClient, method: str, path: str, auth: str | None) -> Any:
    headers = {"Authorization": f"Bearer {auth}"} if auth else {}
    return client.request(method, path.format(product_id=7), json=BODY, headers=headers)


def test_every_known_private_route_is_checked() -> None:
    assert KNOWN_PRIVATE_ROUTES <= set(PRIVATE_ROUTES)
    assert not set(PUBLIC_ROUTES) & set(PRIVATE_ROUTES)


@pytest.mark.parametrize("kind", ["reviews", "ratings"])
def test_anonymous_post_of_a_review_or_rating_is_401(client, kind) -> None:
    response = call(client, "POST", f"/products/{{product_id}}/{kind}", auth=None)

    assert response.status_code == 401
    assert response.json() == {"code": "not_authenticated", "message": "Not authenticated"}
    assert response.headers["WWW-Authenticate"] == "Bearer"


@each_private_route
def test_no_token_gets_401(client, route) -> None:
    assert call(client, *route, auth=None).status_code == 401


@each_private_route
@pytest.mark.parametrize("bad_token", ["not-a-token", "a.b.c"])
def test_garbage_token_gets_401(client, route, bad_token) -> None:
    assert call(client, *route, bad_token).status_code == 401


@each_private_route
def test_token_signed_by_someone_else_gets_401(client, route) -> None:
    forger = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    assert call(client, *route, token(forger, SHOPPER_ID)).status_code == 401


@each_private_route
def test_expired_token_gets_401(client, private_key, route) -> None:
    expired = token(private_key, SHOPPER_ID, expires_in=-timedelta(hours=1))

    assert call(client, *route, expired).status_code == 401


@each_private_route
def test_deactivated_account_gets_403(client, private_key, users, route) -> None:
    users.update(SHOPPER_ID, active=False)

    response = call(client, *route, token(private_key, SHOPPER_ID))

    assert response.status_code == 403
    assert response.json()["code"] == "account_deactivated"


@pytest.mark.parametrize("route", PUBLIC_ROUTES)
def test_reading_reviews_and_the_average_stays_public(make_client, route) -> None:
    # Reaching the repository (the tripwire) means no sign-in check stopped the request.
    client = make_client()
    client.app.dependency_overrides[get_review_repository] = lambda: Tripwire("reviews")
    client.app.dependency_overrides[get_rating_repository] = lambda: Tripwire("ratings")

    with pytest.raises(TrippedError):
        call(client, *route, auth=None)
