from fastapi import APIRouter

from app.core.auth import CurrentUser
from app.schemas import UserRead

router = APIRouter(tags=["auth"])


@router.get("/me", responses={401: {"description": "Missing, invalid, or expired token"}})
def read_me(user: CurrentUser) -> UserRead:
    """The signed-in user, from their Supabase access token."""
    return UserRead(id=user.id, email=user.email)
