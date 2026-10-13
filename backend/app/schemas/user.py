from uuid import UUID

from pydantic import BaseModel


class UserRead(BaseModel):
    """The signed-in user. Account data comes from Supabase Auth; roles are added later (T039)."""

    id: UUID
    email: str | None = None
