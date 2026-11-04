"""Custom store roles (migration 019): each store names its own roles, e.g. "Cashier",
"Stocker", or "Buyer", and ticks what each may do from the permission list (GET
/staff/permissions). Every store starts with "Manager" (everything) and "Worker" (edit stock),
which it can rename, change, or delete like any other.

Any of the store's staff can see its roles; changing them needs manage_roles. Staff can't create
or change a role so it can do something they can't, or change or delete a role that already can
(403 beyond_your_permissions), so nobody can give themselves more than they have. Admins can do
everything at every store. Each change is recorded in the audit log.
"""

from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends, Response, status

from app.api.staff import (
    RESPONSES,
    MemberStore,
    beyond_your_permissions,
    require_permission,
    role_not_found,
)
from app.core.auth import AuthUser, CurrentUser, StaffUser, can_hand_out
from app.core.errors import ApiError, error_response
from app.repositories import AuditLog, StoreRoles
from app.repositories.audit_log import changed_fields
from app.schemas import (
    PERMISSIONS,
    PermissionInfo,
    StoreRoleCreate,
    StoreRoleRead,
    StoreRoleUpdate,
)
from app.schemas.store import StoreRead

permissions_router = APIRouter(prefix="/staff", tags=["staff"])
router = APIRouter(prefix="/staff/stores/{store_id:int}/roles", tags=["staff"], responses=RESPONSES)

_NAME_TAKEN = error_response("The store already has a role with this name")


@permissions_router.get(
    "/permissions", responses={401: error_response("Missing, invalid, or expired token")}
)
def list_permissions(_user: CurrentUser) -> list[PermissionInfo]:
    """Everything a store role can be allowed to do, in the order to list them."""
    return list(PERMISSIONS)


def _name_taken() -> ApiError:
    return ApiError(
        status.HTTP_409_CONFLICT,
        "role_name_taken",
        "This store already has a role with that name.",
    )


def _role_fields(role: StoreRoleRead) -> dict[str, object]:
    return {"name": role.name, "permissions": role.permissions}


def _record(audit: AuditLog, user: AuthUser, action: str, role_id: int, changes) -> None:
    audit.record(
        admin_id=user.id,
        admin_email=user.email,
        action=action,
        target_type="store_role",
        target_id=role_id,
        changes=changes,
    )


def _locked_role(roles: StoreRoles, store_id: int, role_id: int, user: AuthUser) -> StoreRoleRead:
    """One of this store's roles, locked, if the user may change it (it can't do more than
    them)."""
    role = roles.get(role_id, lock=True)
    if role is None or role.store_id != store_id:
        raise role_not_found()
    if not can_hand_out(user, role.permissions):
        raise beyond_your_permissions()
    return role


# Route parameter: the store, once the user's permission to manage its roles is checked.
RolesStore = Annotated[StoreRead, Depends(require_permission("manage_roles"))]


@router.get("")
def list_roles(store: MemberStore, roles: StoreRoles) -> list[StoreRoleRead]:
    """The store's roles and how many people have each: those that can do the most first. Any
    of the store's staff (and admins) can see them."""
    return roles.list_for_store(store.id)


@router.post("", status_code=status.HTTP_201_CREATED, responses={409: _NAME_TAKEN})
def create_role(
    role: StoreRoleCreate, store: RolesStore, user: StaffUser, roles: StoreRoles, audit: AuditLog
) -> StoreRoleRead:
    """Add a role, e.g. {"name": "Stocker", "permissions": ["edit_stock"]}. Needs manage_roles,
    and only permissions the caller has (403 beyond_your_permissions). Names are unique at each
    store, ignoring case (409 role_name_taken)."""
    if not can_hand_out(user, role.permissions):
        raise beyond_your_permissions()
    if roles.name_taken(store.id, role.name):
        raise _name_taken()
    try:
        created = roles.create(store.id, role.name, role.permissions)
    except psycopg.errors.UniqueViolation:  # someone else took the name just now
        raise _name_taken() from None
    _record(audit, user, "store_role.create", created.id, changed_fields({}, _role_fields(created)))
    return created


@router.patch("/{role_id:int}", responses={409: _NAME_TAKEN})
def update_role(
    role_id: int,
    change: StoreRoleUpdate,
    store: RolesStore,
    user: StaffUser,
    roles: StoreRoles,
    audit: AuditLog,
) -> StoreRoleRead:
    """Rename a role and/or change what it may do; it applies to everyone who has it on their
    next request. Needs manage_roles; the role, before and after, can't do more than the caller
    (403 beyond_your_permissions)."""
    before = _locked_role(roles, store.id, role_id, user)
    if change.permissions is not None and not can_hand_out(user, change.permissions):
        raise beyond_your_permissions()
    if change.name is not None and roles.name_taken(store.id, change.name, except_id=role_id):
        raise _name_taken()
    try:
        updated = roles.update(role_id, name=change.name, permissions=change.permissions)
    except psycopg.errors.UniqueViolation:  # someone else took the name just now
        raise _name_taken() from None
    _record(
        audit, user, "store_role.update", role_id,
        changed_fields(_role_fields(before), _role_fields(updated)),
    )  # fmt: skip
    return updated


@router.delete(
    "/{role_id:int}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={409: error_response("Someone still has this role")},
)
def delete_role(
    role_id: int, store: RolesStore, user: StaffUser, roles: StoreRoles, audit: AuditLog
) -> Response:
    """Remove a role nobody has; give its people another role first (409 role_in_use). Needs
    manage_roles, and the role can't do more than the caller (403 beyond_your_permissions)."""
    before = _locked_role(roles, store.id, role_id, user)
    if before.member_count:
        raise _role_in_use()
    try:
        roles.delete(role_id)
    except psycopg.errors.ForeignKeyViolation:  # someone was given the role just now
        raise _role_in_use() from None
    _record(audit, user, "store_role.delete", role_id, changed_fields(_role_fields(before), {}))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _role_in_use() -> ApiError:
    return ApiError(
        status.HTTP_409_CONFLICT,
        "role_in_use",
        "People still have this role. Give them another role first.",
    )
