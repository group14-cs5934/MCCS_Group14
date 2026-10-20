from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Every role a user can have; must match the CHECK constraint on users.role. New users get "user".
Role = Literal["user", "admin"]


class UserRead(BaseModel):
    """A user's account: the ID and email come from Supabase Auth, the role from our users table."""

    id: UUID
    email: str | None = None
    role: Role


class UserAccount(UserRead):
    """A user as admins see them (GET /admin/users), including whether the account is active."""

    active: bool = Field(description="False once an admin deactivates the account")
    created_at: datetime = Field(description="When the user first signed in")


class UserUpdate(BaseModel):
    """An admin's change to a user (PATCH /admin/users/{id}). Send one or both fields."""

    model_config = ConfigDict(extra="forbid")

    role: Role | None = Field(default=None, examples=["admin"])
    # Strict: only true or false, so a string like "no" can't deactivate someone by accident.
    active: bool | None = Field(
        default=None, strict=True, description="false deactivates the account, true reactivates it"
    )

    @model_validator(mode="after")
    def _has_a_change(self) -> Self:
        if self.role is None and self.active is None:
            raise ValueError("send role, active, or both")
        return self
