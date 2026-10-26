"""Admin-only endpoints (US12). Every route here needs a signed-in admin: 401 without a valid
token, 403 for anyone else.

User management (T081): list users, change a user's role, and deactivate or reactivate them.
Changes take effect on the user's next request, because the API reads their role and status from
the users table on every request. Each change is recorded in the audit log (T083).
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status

from app.core.auth import AdminUser
from app.core.errors import ApiError, error_response
from app.repositories import AuditLog, Users
from app.repositories.audit_log import changed_fields
from app.schemas import UserAccount, UserUpdate

MAX_USERS_PER_PAGE = 100

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    responses={
        401: error_response("Missing, invalid, or expired token"),
        403: error_response("Not an admin, or the admin's account is deactivated"),
        422: error_response("Invalid request; details lists each problem"),
    },
)


@router.get("/users")
def list_users(
    admin: AdminUser,
    users: Users,
    email: Annotated[
        str, Query(max_length=320, description="Only users whose email contains this")
    ] = "",
    limit: Annotated[int, Query(ge=1, le=MAX_USERS_PER_PAGE)] = 50,
    offset: Annotated[int, Query(ge=0, description="Users to skip, for paging")] = 0,
) -> list[UserAccount]:
    """Users in the order they joined, with their role and whether their account is active."""
    return users.list_users(email, limit=limit, offset=offset)


@router.patch(
    "/users/{user_id}",
    responses={
        404: error_response("No user with this ID"),
        409: error_response("Admins can't demote or deactivate themselves"),
    },
)
def update_user(
    user_id: UUID, change: UserUpdate, admin: AdminUser, users: Users, audit: AuditLog
) -> UserAccount:
    """Change a user's role and/or deactivate or reactivate them, e.g. {"role": "admin"} or
    {"active": false}. It takes effect on the user's next request: a deactivated user gets 403
    with code account_deactivated.

    Admins can't remove their own admin role or deactivate themselves (409), so the app can't be
    left without an admin by accident.
    """
    if user_id == admin.id and (change.role == "user" or change.active is False):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "cannot_change_own_account",
            "You can't remove your own admin role or deactivate yourself.",
        )
    if not users.lock(user_id):
        raise ApiError(status.HTTP_404_NOT_FOUND, "user_not_found", "User not found")
    before = users.get(user_id)
    assert before is not None  # locked above
    updated = users.update(user_id, role=change.role, active=change.active)
    assert updated is not None  # found above, in this same transaction
    audit.record(
        admin_id=admin.id,
        admin_email=admin.email,
        action="user.update",
        target_type="user",
        target_id=user_id,
        changes=changed_fields(_user_fields(before), _user_fields(updated)),
    )
    return updated


def _user_fields(user: UserAccount) -> dict[str, object]:
    """What the audit log compares for a user."""
    return {"email": user.email, "role": user.role, "active": user.active}
