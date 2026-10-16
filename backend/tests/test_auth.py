"""T039: the API identifies users from their Supabase access token, and checks their role.

The users table is replaced by an in-memory fake here, so these tests need no database. The real
table is tested in test_user_repository.py.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter

from app.core.auth import AdminUser, TokenVerifier
from app.repositories.users import get_user_repository
from app.schemas import UserRead
from tests.conftest import VALID_SUPABASE_URL

ISSUER = f"{VALID_SUPABASE_URL}/auth/v1"
USER_ID = "8f14e45f-ceea-467f-a8f0-3b7b2b1c1f00"
EMAIL = "shopper@example.com"
SECRET = "legacy-jwt-secret-that-is-at-least-32-bytes"


@pytest.fixture(scope="module")
def private_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_token(key, algorithm="RS256", **claims) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": USER_ID,
        "email": EMAIL,
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + timedelta(hours=1),
        **claims,
    }
    return jwt.encode(payload, key, algorithm=algorithm)


class FakeUserRepository:
    """Stands in for UserRepository: users are kept in a dict instead of the database."""

    def __init__(self) -> None:
        self.users: dict[UUID, UserRead] = {}

    def get_or_create(self, user_id: UUID, email: str | None) -> UserRead:
        existing = self.users.get(user_id)
        role = existing.role if existing else "user"
        self.users[user_id] = UserRead(id=user_id, email=email, role=role)
        return self.users[user_id]


admin_router = APIRouter()


@admin_router.get("/admin-only")
def admin_only(user: AdminUser) -> dict[str, str]:
    return {"role": user.role}


@pytest.fixture
def users() -> FakeUserRepository:
    return FakeUserRepository()


@pytest.fixture
def client(make_client, private_key, users):
    """Client whose verifier trusts private_key (instead of fetching Supabase's JWKS)."""
    client = make_client()
    client.app.state.token_verifier = TokenVerifier(
        ISSUER, jwt_secret=SECRET, key_resolver=lambda _token: private_key.public_key()
    )
    client.app.dependency_overrides[get_user_repository] = lambda: users
    client.app.include_router(admin_router)
    return client


def make_admin(users: FakeUserRepository) -> None:
    users.users[UUID(USER_ID)] = UserRead(id=UUID(USER_ID), email=EMAIL, role="admin")


def get_me(client, token):
    return client.get("/me", headers={"Authorization": f"Bearer {token}"})


def test_valid_token_returns_the_user(client, private_key):
    response = get_me(client, make_token(private_key))
    assert response.status_code == 200
    assert response.json() == {"id": USER_ID, "email": EMAIL, "role": "user"}


def test_first_request_adds_the_user_with_the_user_role(client, private_key, users):
    get_me(client, make_token(private_key))
    get_me(client, make_token(private_key))

    assert list(users.users) == [UUID(USER_ID)]
    assert users.users[UUID(USER_ID)].role == "user"


def test_me_returns_the_stored_role(client, private_key, users):
    make_admin(users)

    assert get_me(client, make_token(private_key)).json()["role"] == "admin"


def test_missing_token_is_401(client):
    response = client.get("/me")
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "claims",
    [
        {"exp": datetime.now(UTC) - timedelta(minutes=1)},
        {"aud": "anon"},
        {"iss": "https://someone-else.supabase.co/auth/v1"},
        {"sub": "not-a-uuid"},
    ],
)
def test_invalid_claims_are_401(client, private_key, claims):
    assert get_me(client, make_token(private_key, **claims)).status_code == 401


def test_token_signed_by_another_key_is_401(client):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert get_me(client, make_token(other)).status_code == 401


def test_garbage_token_is_401(client):
    assert get_me(client, "not.a.jwt").status_code == 401


def test_legacy_hs256_token_works_with_secret(client):
    assert get_me(client, make_token(SECRET, algorithm="HS256")).status_code == 200


def test_hs256_token_without_secret_is_401(client, private_key):
    client.app.state.token_verifier = TokenVerifier(
        ISSUER, key_resolver=lambda _token: private_key.public_key()
    )
    assert get_me(client, make_token(SECRET, algorithm="HS256")).status_code == 401


def test_unreachable_jwks_is_503(client, private_key):
    def down(_token):
        raise jwt.PyJWKClientConnectionError("connection refused")

    client.app.state.token_verifier = TokenVerifier(ISSUER, key_resolver=down)
    assert get_me(client, make_token(private_key)).status_code == 503


def get_admin_only(client, token):
    return client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})


def test_admin_route_allows_admins(client, private_key, users):
    make_admin(users)

    response = get_admin_only(client, make_token(private_key))

    assert response.status_code == 200
    assert response.json() == {"role": "admin"}


def test_admin_route_is_403_for_users(client, private_key):
    response = get_admin_only(client, make_token(private_key))

    assert response.status_code == 403
    assert response.json() == {"detail": "You don't have permission to do that."}


def test_admin_route_is_401_without_a_token(client):
    assert client.get("/admin-only").status_code == 401
