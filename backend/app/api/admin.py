"""Admin-only endpoints (US12). Every route here needs a signed-in admin: 401 without a valid
token, 403 for anyone else.

User management (T081): list users, change a user's role, and deactivate or reactivate them.
Admins also make users store staff, with one of a store's roles (migration 019).
Changes take effect on the user's next request, because the API reads their role and status from
the users table on every request. Each change is recorded in the audit log (T083).
"""

from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, Query, status

from app.api.staff import locked_role, role_not_found, user_audit_fields
from app.core.auth import AdminUser
from app.core.errors import ApiError, error_response
from app.repositories import AuditLog, StoreRoles, Stores, Users
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
        404: error_response("No user or store role with this ID"),
        409: error_response("Admins can't demote or deactivate themselves"),
    },
)
def update_user(
    user_id: UUID,
    change: UserUpdate,
    admin: AdminUser,
    users: Users,
    stores: Stores,
    roles: StoreRoles,
    audit: AuditLog,
) -> UserAccount:
    """Change a user's role or store role and/or deactivate or reactivate them, e.g.
    {"role": "admin"}, {"role": "staff", "store_role_id": 3}, or {"active": false}. It takes
    effect on the user's next request: a deactivated user gets 403 with code account_deactivated.

    Staff have one of a store's roles, and work at that store: making someone staff needs a
    store_role_id (422 store_role_required), and only staff can have one (422
    store_role_not_allowed). Sending only store_role_id gives existing staff another role, at
    their store or another. Any other role takes them off their store.

    Admins can't remove their own admin role or deactivate themselves (409), so the app can't be
    left without an admin by accident.
    """
    if user_id == admin.id and (change.role not in (None, "admin") or change.active is False):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "cannot_change_own_account",
            "You can't remove your own admin role or deactivate yourself.",
        )
    if not users.lock(user_id):
        raise ApiError(status.HTTP_404_NOT_FOUND, "user_not_found", "User not found")
    before = users.get(user_id)
    assert before is not None  # locked above
    _check_store_role(change, before, stores, roles)
    try:
        updated = users.update(
            user_id, role=change.role, active=change.active, store_role_id=change.store_role_id
        )
    except psycopg.errors.ForeignKeyViolation:  # the role was deleted just now
        raise role_not_found() from None
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


def _check_store_role(
    change: UserUpdate, before: UserAccount, stores: Stores, roles: StoreRoles
) -> None:
    """Staff need a store role that exists, and nobody else has one. A new role and its store
    are locked until the request ends (see staff.locked_role)."""
    role = change.role or before.role
    if role == "staff":
        if change.store_role_id is None and before.store_role is None:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "store_role_required",
                "Staff need one of a store's roles; send store_role_id.",
            )
        if change.store_role_id is not None:
            role = roles.get(change.store_role_id)
            if role is None:
                raise role_not_found()
            locked_role(stores, roles, role.store_id, role.id)
    elif change.store_role_id is not None:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "store_role_not_allowed",
            "Only staff have a store role.",
        )


def _user_fields(user: UserAccount) -> dict[str, object]:
    """What the audit log compares for a user."""
    return {"email": user.email, **user_audit_fields(user), "active": user.active}
