"""Supabase access-token verification and the CurrentUser dependency.

The mobile app signs users in with Supabase directly and sends the access token as
`Authorization: Bearer <token>`. Routes that need a signed-in user take a CurrentUser parameter,
and admin-only routes take AdminUser. Tokens are never logged.

Each user's role is kept in our users table. Their row is added with the "user" role the first
time they call the API (the app calls GET /me right after signing in).
"""

from collections.abc import Callable
from typing import Annotated, Any, Self
from uuid import UUID

import jwt
from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ValidationError

from app.core.config import Settings
from app.core.errors import ApiError
from app.repositories.users import Users
from app.schemas import Role

# Supabase gives signed-in users' tokens this audience.
AUDIENCE = "authenticated"
ASYMMETRIC_ALGORITHMS = ["RS256", "ES256"]
JWKS_TIMEOUT_SECONDS = 5

# Takes a token and returns the public key that should have signed it.
KeyResolver = Callable[[str], Any]


class TokenUser(BaseModel):
    """Who a request's token says the caller is."""

    id: UUID
    email: str | None = None


class AuthUser(TokenUser):
    """The signed-in user, with their role (and, for store staff, their store) from the users
    table."""

    role: Role
    store_id: int | None = None


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

    def verify(self, token: str) -> TokenUser:
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
        return TokenUser(id=claims["sub"], email=claims.get("email"))


_bearer = HTTPBearer(auto_error=False)


def get_token_verifier(request: Request) -> TokenVerifier:
    return request.app.state.token_verifier


def _unauthorized() -> ApiError:
    return ApiError(
        status.HTTP_401_UNAUTHORIZED,
        "not_authenticated",
        "Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_token_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    verifier: Annotated[TokenVerifier, Depends(get_token_verifier)],
) -> TokenUser:
    """FastAPI dependency: the token's user, or 401 if the token is missing or invalid."""
    if credentials is None:
        raise _unauthorized()
    try:
        return verifier.verify(credentials.credentials)
    except AuthUnavailableError:
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "auth_unavailable",
            "Sign-in can't be checked right now. Please try again.",
        ) from None
    except (jwt.PyJWTError, ValidationError):
        raise _unauthorized() from None


def get_current_user(
    token_user: Annotated[TokenUser, Depends(get_token_user)], users: Users
) -> AuthUser:
    """FastAPI dependency: the signed-in user and their role, adding their row on first use.

    The role and status are read on every request, so an admin's change takes effect on the
    user's next request. A deactivated user gets 403 with code account_deactivated.
    """
    account = users.get_or_create(token_user.id, token_user.email)
    if not account.active:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "account_deactivated",
            "This account has been deactivated.",
        )
    return AuthUser(
        id=account.id, email=account.email, role=account.role, store_id=account.store_id
    )


# Use as a route parameter: def get_thing(user: CurrentUser) -> ...
CurrentUser = Annotated[AuthUser, Depends(get_current_user)]


def require_role(*roles: Role) -> Callable[[AuthUser], AuthUser]:
    """FastAPI dependency factory: the signed-in user, or 403 unless they have one of `roles`."""

    def check_role(user: CurrentUser) -> AuthUser:
        if user.role not in roles:
            raise ApiError(
                status.HTTP_403_FORBIDDEN, "forbidden", "You don't have permission to do that."
            )
        return user

    return check_role


# Use as a route parameter for admin-only routes: def delete_thing(user: AdminUser) -> ...
AdminUser = Annotated[AuthUser, Depends(require_role("admin"))]

# Store staff routes (app/api/staff.py): workers, managers, and admins. Which store they may act
# on is checked per route, with can_edit_stock / can_manage_staff below.
StaffUser = Annotated[AuthUser, Depends(require_role("worker", "manager", "admin"))]


def can_edit_stock(user: AuthUser, store_id: int) -> bool:
    """Admins edit stock anywhere; workers and managers only at their own store."""
    if user.role == "admin":
        return True
    return user.role in ("worker", "manager") and user.store_id == store_id


def can_manage_staff(user: AuthUser, store_id: int) -> bool:
    """Admins manage any store's staff; a manager only their own store's workers."""
    if user.role == "admin":
        return True
    return user.role == "manager" and user.store_id == store_id
