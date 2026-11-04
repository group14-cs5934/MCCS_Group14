from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.store_role import StoreRoleSummary

# Every role a user can have; must match the CHECK constraint on users.role (migration 019). New
# users get "user". Staff belong to one store (store_id), where they have one of its custom roles
# (store_role), which says what they may do there.
Role = Literal["user", "staff", "admin"]

# Up to Postgres' INTEGER limit, so a huge ID is a 422 (or 404), not a database error.
MAX_ID = 2**31 - 1


class UserRead(BaseModel):
    """A user's account: the ID and email come from Supabase Auth, the role from our users table."""

    id: UUID
    email: str | None = None
    role: Role
    store_id: int | None = Field(
        default=None, description="The store a staff member works at; null for anyone else"
    )
    store_role: StoreRoleSummary | None = Field(
        default=None, description="A staff member's role at their store; null for anyone else"
    )


class UserAccount(UserRead):
    """A user as admins see them (GET /admin/users), including whether the account is active."""

    active: bool = Field(description="False once an admin deactivates the account")
    created_at: datetime = Field(description="When the user first signed in")


class UserUpdate(BaseModel):
    """An admin's change to a user (PATCH /admin/users/{id}). Send at least one field.

    Staff need one of a store's roles: send store_role_id with the role, or on its own to give
    existing staff another role (at their store or another one). Any other role leaves the store
    and its role behind.
    """

    model_config = ConfigDict(extra="forbid")

    role: Role | None = Field(default=None, examples=["staff"])
    store_role_id: int | None = Field(default=None, ge=1, le=MAX_ID, examples=[3])
    # Strict: only true or false, so a string like "no" can't deactivate someone by accident.
    active: bool | None = Field(
        default=None, strict=True, description="false deactivates the account, true reactivates it"
    )

    @model_validator(mode="after")
    def _has_a_change(self) -> Self:
        if self.role is None and self.store_role_id is None and self.active is None:
            raise ValueError("send role, store_role_id, active, or a combination")
        return self


class StaffAdd(BaseModel):
    """Adding someone to a store's staff with one of its roles (POST /staff/stores/{id}/staff).
    The person must have signed up to the app first."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    email: str = Field(min_length=3, max_length=320, examples=["new.stocker@example.com"])
    role_id: int = Field(ge=1, le=MAX_ID, description="One of the store's roles", examples=[3])


class StaffRoleChange(BaseModel):
    """Giving a staff member another of the store's roles (PATCH /staff/stores/{id}/staff/{id})."""

    model_config = ConfigDict(extra="forbid")

    role_id: int = Field(ge=1, le=MAX_ID, examples=[3])
