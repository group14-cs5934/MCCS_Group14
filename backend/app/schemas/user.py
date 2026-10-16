from typing import Literal
from uuid import UUID

from pydantic import BaseModel

# Every role a user can have; must match the CHECK constraint on users.role. New users get "user".
Role = Literal["user", "admin"]


class UserRead(BaseModel):
    """A user's account: the ID and email come from Supabase Auth, the role from our users table."""

    id: UUID
    email: str | None = None
    role: Role
