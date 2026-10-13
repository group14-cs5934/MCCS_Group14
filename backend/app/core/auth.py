"""Supabase access-token verification and the CurrentUser dependency.

The mobile app signs users in with Supabase directly and sends the access token as
`Authorization: Bearer <token>`. Routes that need a signed-in user take a CurrentUser parameter.
Tokens are never logged.
"""

from collections.abc import Callable
from typing import Annotated, Any, Self
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ValidationError

from app.core.config import Settings

# Supabase gives signed-in users' tokens this audience.
AUDIENCE = "authenticated"
ASYMMETRIC_ALGORITHMS = ["RS256", "ES256"]
JWKS_TIMEOUT_SECONDS = 5

# Takes a token and returns the public key that should have signed it.
KeyResolver = Callable[[str], Any]


class AuthUser(BaseModel):
    """The user a request's token belongs to. Roles are added here later in T039."""

    id: UUID
    email: str | None = None


class AuthUnavailableError(Exception):
    """Supabase's signing keys couldn't be fetched, so no token can be checked right now."""


def _jwks_resolver(url: str) -> KeyResolver:
    # PyJWKClient caches the keys, so Supabase is only asked again when a new key ID shows up.
    client = jwt.PyJWKClient(url, cache_keys=True, timeout=JWKS_TIMEOUT_SECONDS)

    def resolve(token: str) -> Any:
        return client.get_signing_key_from_jwt(token).key

    return resolve


class TokenVerifier:
    """Checks a Supabase access token's signature, audience, issuer, and expiry."""

    def __init__(
        self, issuer: str, jwt_secret: str | None = None, key_resolver: KeyResolver | None = None
    ) -> None:
        self._issuer = issuer
        self._jwt_secret = jwt_secret
        self._resolve_key = key_resolver or _jwks_resolver(f"{issuer}/.well-known/jwks.json")

    @classmethod
    def from_settings(cls, settings: Settings) -> Self:
        secret = settings.supabase_jwt_secret
        return cls(settings.supabase_auth_url, secret.get_secret_value() if secret else None)

    def verify(self, token: str) -> AuthUser:
        """The token's user. Raises jwt.PyJWTError if the token is invalid."""
        if jwt.get_unverified_header(token).get("alg") == "HS256":
            if self._jwt_secret is None:
                raise jwt.InvalidAlgorithmError("HS256 tokens need SUPABASE_JWT_SECRET")
            key, algorithms = self._jwt_secret, ["HS256"]
        else:
            try:
                key = self._resolve_key(token)
            except jwt.PyJWKClientConnectionError as exc:
                raise AuthUnavailableError from exc
            algorithms = ASYMMETRIC_ALGORITHMS
        claims = jwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience=AUDIENCE,
            issuer=self._issuer,
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
        return AuthUser(id=claims["sub"], email=claims.get("email"))


_bearer = HTTPBearer(auto_error=False)


def get_token_verifier(request: Request) -> TokenVerifier:
    return request.app.state.token_verifier


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    verifier: Annotated[TokenVerifier, Depends(get_token_verifier)],
) -> AuthUser:
    """FastAPI dependency: the signed-in user, or 401 if the token is missing or invalid."""
    if credentials is None:
        raise _unauthorized()
    try:
        return verifier.verify(credentials.credentials)
    except AuthUnavailableError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sign-in can't be checked right now. Please try again.",
        ) from None
    except (jwt.PyJWTError, ValidationError):
        raise _unauthorized() from None


# Use as a route parameter: def get_thing(user: CurrentUser) -> ...
CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
