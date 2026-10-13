"""T039: the API identifies users from their Supabase access token."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.auth import TokenVerifier
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


@pytest.fixture
def client(make_client, private_key):
    """Client whose verifier trusts private_key (instead of fetching Supabase's JWKS)."""
    client = make_client()
    client.app.state.token_verifier = TokenVerifier(
        ISSUER, jwt_secret=SECRET, key_resolver=lambda _token: private_key.public_key()
    )
    return client


def get_me(client, token):
    return client.get("/me", headers={"Authorization": f"Bearer {token}"})


def test_valid_token_returns_the_user(client, private_key):
    response = get_me(client, make_token(private_key))
    assert response.status_code == 200
    assert response.json() == {"id": USER_ID, "email": EMAIL}


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
