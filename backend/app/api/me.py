from fastapi import APIRouter

from app.core.auth import CurrentUser
from app.core.errors import error_response
from app.schemas import UserRead

router = APIRouter(tags=["auth"])


@router.get("/me", responses={401: error_response("Missing, invalid, or expired token")})
def read_me(user: CurrentUser) -> UserRead:
    """The signed-in user, their role, and (for store staff) their store and their role there,
    with what it lets them do. The first call adds them with the "user" role."""
    return UserRead(
        id=user.id,
        email=user.email,
        role=user.role,
        store_id=user.store_id,
        store_role=user.store_role,
    )
