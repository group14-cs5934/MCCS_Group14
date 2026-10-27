from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Every role a user can have; must match the CHECK constraint on users.role (migration 016). New
# users get "user". Workers and managers are store staff: they belong to one store (store_id).
Role = Literal["user", "worker", "manager", "admin"]
STAFF_ROLES: tuple[Role, ...] = ("worker", "manager")


class UserRead(BaseModel):
    """A user's account: the ID and email come from Supabase Auth, the role from our users table."""

    id: UUID
    email: str | None = None
    role: Role
    store_id: int | None = Field(
        default=None, description="The store a worker or manager works at; null for anyone else"
    )


class UserAccount(UserRead):
    """A user as admins see them (GET /admin/users), including whether the account is active."""

    active: bool = Field(description="False once an admin deactivates the account")
    created_at: datetime = Field(description="When the user first signed in")


class UserUpdate(BaseModel):
    """An admin's change to a user (PATCH /admin/users/{id}). Send at least one field.

    A worker or manager needs a store: send store_id with the role, or to move existing staff to
    another store. Any other role leaves the store behind.
    """

    model_config = ConfigDict(extra="forbid")

    role: Role | None = Field(default=None, examples=["manager"])
    # Up to Postgres' INTEGER limit, so a huge ID is a 422, not a database error.
    store_id: int | None = Field(default=None, ge=1, le=2**31 - 1, examples=[3])
    # Strict: only true or false, so a string like "no" can't deactivate someone by accident.
    active: bool | None = Field(
        default=None, strict=True, description="false deactivates the account, true reactivates it"
    )

    @model_validator(mode="after")
    def _has_a_change(self) -> Self:
        if self.role is None and self.store_id is None and self.active is None:
            raise ValueError("send role, store_id, active, or a combination")
        return self


class StaffAdd(BaseModel):
    """A manager adding a worker to their store (POST /staff/stores/{id}/staff). The person
    must have signed up to the app first."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    email: str = Field(min_length=3, max_length=320, examples=["new.worker@example.com"])
