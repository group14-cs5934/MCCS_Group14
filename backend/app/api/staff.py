"""Store staff (added after the Gantt tasks): staff look after their own store, as far as their
role there allows.

Each store has its own roles (migration 019, app/api/store_roles.py), each a name and a list of
permissions from app/schemas/store_role.py. Staff have users.role = "staff", their store in
users.store_id, and their role there in users.store_role_id. Admins can do everything at every
store, and make anyone staff through PATCH /admin/users.

Every route needs signed-in staff or an admin: 401 without a valid token, 403 for regular users
(code forbidden), for staff of another store (code not_your_store), and for staff whose role
doesn't allow it (code missing_permission). Staff can't give anyone a role with permissions they
don't have themselves, or change or remove someone who has one (code beyond_your_permissions).
Stock is set exactly as admins set it (stock_edits.py), so the product monitor keeps it until it's
handed back. Each change is recorded in the audit log under whoever made it.
"""

from collections.abc import Callable
from typing import Annotated, Any
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, Response, status

from app.api import stock_edits
from app.core.auth import AuthUser, StaffUser, can_hand_out, has_permission
from app.core.errors import ApiError, error_response
from app.repositories import AuditLog, StoreRoles, Stores, Users
from app.repositories.audit_log import changed_fields
from app.schemas import Permission, StaffAdd, StaffRoleChange, StoreRoleRead, UserAccount
from app.schemas.store import (
    AdminStoreStock,
    StaffStockRow,
    StaffStoreUpdate,
    StockUpdate,
    StoreRead,
)

MAX_STOCK_PER_PAGE = 50

RESPONSES: dict[int | str, dict[str, Any]] = {
    401: error_response("Missing, invalid, or expired token"),
    403: error_response("Not staff at this store, or their role doesn't allow it"),
    404: error_response("No such store (or product, person, or role)"),
    422: error_response("Invalid request; details lists each problem"),
}

router = APIRouter(prefix="/staff/stores/{store_id:int}", tags=["staff"], responses=RESPONSES)


def _not_your_store() -> ApiError:
    return ApiError(
        status.HTTP_403_FORBIDDEN, "not_your_store", "You can only do that at your own store."
    )


def beyond_your_permissions() -> ApiError:
    return ApiError(
        status.HTTP_403_FORBIDDEN,
        "beyond_your_permissions",
        "You can only hand out, change, or take away roles that can't do more than yours.",
    )


def role_not_found() -> ApiError:
    return ApiError(
        status.HTTP_404_NOT_FOUND, "store_role_not_found", "This store has no such role."
    )


def _store(stores: Stores, store_id: int) -> StoreRead:
    store = stores.get_store(store_id)
    if store is None:  # only admins get here for a store that doesn't exist
        raise stock_edits.store_not_found()
    return store


def require_permission(*permissions: Permission) -> Callable[..., StoreRead]:
    """FastAPI dependency factory: the store from the path, if the signed-in user may do any of
    `permissions` there (or, with none given, is its staff). A dependency, so it's checked before
    the request body (an invalid body from another store's staff is still 403)."""

    def check(store_id: int, user: StaffUser, stores: Stores) -> StoreRead:
        if user.role != "admin":
            if user.store_id != store_id:
                raise _not_your_store()
            if permissions and not any(has_permission(user, store_id, p) for p in permissions):
                raise ApiError(
                    status.HTTP_403_FORBIDDEN,
                    "missing_permission",
                    "Your role at this store doesn't allow that.",
                )
        return _store(stores, store_id)

    return check


# Route parameters: the store from the path, once the signed-in user's access to it is checked.
MemberStore = Annotated[StoreRead, Depends(require_permission())]
StockStore = Annotated[StoreRead, Depends(require_permission("edit_stock"))]
StaffListStore = Annotated[StoreRead, Depends(require_permission("view_staff", "manage_staff"))]
ManagedStore = Annotated[StoreRead, Depends(require_permission("manage_staff"))]
InfoStore = Annotated[StoreRead, Depends(require_permission("edit_store_info"))]


def _record_user_change(
    audit: AuditLog, actor: AuthUser, before: UserAccount, after: UserAccount
) -> None:
    audit.record(
        admin_id=actor.id,
        admin_email=actor.email,
        action="user.update",
        target_type="user",
        target_id=after.id,
        changes=changed_fields(user_audit_fields(before), user_audit_fields(after)),
    )


def user_audit_fields(user: UserAccount) -> dict[str, object]:
    """What the audit log compares for a change to someone's role."""
    return {
        "role": user.role,
        "store_id": user.store_id,
        "store_role": user.store_role.name if user.store_role else None,
    }


def locked_role(stores: Stores, roles: StoreRoles, store_id: int, role_id: int) -> StoreRoleRead:
    """One of this store's roles, or 404, to give to someone. The store and then the role stay
    locked until the request ends (the order deleting a store locks them in), so the role's
    permissions can't change, nor the store go away, between checking the role and giving it."""
    if stores.get_store(store_id, lock=True) is None:
        raise stock_edits.store_not_found()
    role = roles.get(role_id, lock=True)
    if role is None or role.store_id != store_id:
        raise role_not_found()
    return role


# --- Store details ---


@router.patch("")
def update_store_info(
    change: StaffStoreUpdate, store: InfoStore, user: StaffUser, stores: Stores, audit: AuditLog
) -> StoreRead:
    """Change the store's address or hours; only the fields sent change, and null clears one.
    Needs edit_store_info. Admins change the name and slug (PATCH /admin/stores/{id})."""
    before = stores.get_store(store.id, lock=True)
    if before is None:  # an admin deleted the store just now
        raise stock_edits.store_not_found()
    updated = stores.update_store(store.id, change.model_dump(include=change.model_fields_set))
    fields = ("address", "hours")
    audit.record(
        admin_id=user.id,
        admin_email=user.email,
        action="store.update",
        target_type="store",
        target_id=store.id,
        changes=changed_fields(
            {field: getattr(before, field) for field in fields},
            {field: getattr(updated, field) for field in fields},
        ),
    )
    return updated


# --- Stock ---


@router.get("/stock")
def list_stock(
    store: StockStore,
    stores: Stores,
    q: Annotated[
        str, Query(max_length=100, description="A product name (typos are OK) or exact barcode")
    ] = "",
    limit: Annotated[int, Query(ge=1, le=MAX_STOCK_PER_PAGE)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> list[StaffStockRow]:
    """Products and their stock at this store: matches for q, or every product by name. Products
    the store has no record for are listed as out of stock, so they can be stocked. Needs
    edit_stock."""
    return stores.store_stock(store.id, q, limit=limit, offset=offset)


@router.put("/stock/{product_id:int}")
def set_stock(
    product_id: int,
    stock: StockUpdate,
    store: StockStore,
    user: StaffUser,
    stores: Stores,
    audit: AuditLog,
) -> AdminStoreStock:
    """Set a product's stock at this store, e.g. {"in_stock": false}, or {"in_stock": true,
    "quantity": 12, "aisle": "Aisle 7"}. An aisle that isn't sent keeps its value. Automatic
    updates leave it alone until it's handed back (DELETE). Needs edit_stock."""
    return stock_edits.set_stock(stores, audit, user, product_id, store, stock)


@router.delete("/stock/{product_id:int}", status_code=status.HTTP_204_NO_CONTENT)
def clear_stock(
    product_id: int, store: StockStore, user: StaffUser, stores: Stores, audit: AuditLog
) -> Response:
    """Hand a product's stock at this store back to automatic updates. 204 when done; 404 with
    code admin_stock_not_found if it wasn't set by hand. Needs edit_stock."""
    stock_edits.clear_stock(stores, audit, user, product_id, store)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Staff ---


@router.get("/staff")
def list_staff(store: StaffListStore, users: Users) -> list[UserAccount]:
    """The store's staff, with their roles: those whose role can do the most first. Needs
    view_staff or manage_staff."""
    return users.list_staff(store.id)


@router.post(
    "/staff",
    status_code=status.HTTP_201_CREATED,
    responses={409: error_response("Already staff or an admin, or the account is deactivated")},
)
def add_staff(
    person: StaffAdd,
    store: ManagedStore,
    user: StaffUser,
    users: Users,
    stores: Stores,
    roles: StoreRoles,
    audit: AuditLog,
) -> UserAccount:
    """Add someone to this store's staff with one of its roles, by the email they signed up
    with. They need an account first (404 user_not_found), must be a regular user (409
    already_staff), and active (409 account_deactivated). Needs manage_staff, and a role that
    can't do more than the caller's (403 beyond_your_permissions)."""
    role = locked_role(stores, roles, store.id, person.role_id)
    if not can_hand_out(user, role.permissions):
        raise beyond_your_permissions()
    found = users.find_by_email(person.email)
    if found is None or not users.lock(found.id):
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "user_not_found",
            "No account with this email. They need to sign up in the app first.",
        )
    before = users.get(found.id)
    assert before is not None  # locked above
    if before.role != "user":
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "already_staff",
            "This person is already store staff or an admin.",
        )
    if not before.active:
        raise ApiError(
            status.HTTP_409_CONFLICT, "account_deactivated", "This account has been deactivated."
        )
    try:
        after = users.update(before.id, role="staff", store_role_id=role.id)
    except psycopg.errors.ForeignKeyViolation:  # the role or store was deleted just now
        raise role_not_found() from None
    assert after is not None  # locked above
    _record_user_change(audit, user, before, after)
    return after


def _staff_member(users: Users, store_id: int, user_id: UUID, actor: AuthUser) -> UserAccount:
    """One of this store's staff, locked, if the actor may change them: not themselves (409
    cannot_change_own_account), and not someone whose role can do more than theirs (403)."""
    if user_id == actor.id:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "cannot_change_own_account",
            "You can't change your own role or remove yourself from the store.",
        )
    person = users.get(user_id) if users.lock(user_id) else None
    if person is None or person.store_id != store_id or person.store_role is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "staff_not_found", "This person isn't staff at this store."
        )
    if not can_hand_out(actor, person.store_role.permissions):
        raise beyond_your_permissions()
    return person


@router.patch(
    "/staff/{user_id}", responses={409: error_response("Staff can't change their own role")}
)
def change_staff_role(
    user_id: UUID,
    change: StaffRoleChange,
    store: ManagedStore,
    user: StaffUser,
    users: Users,
    stores: Stores,
    roles: StoreRoles,
    audit: AuditLog,
) -> UserAccount:
    """Give one of this store's staff another of its roles. Needs manage_staff; neither their
    current role nor the new one can do more than the caller's (403 beyond_your_permissions)."""
    before = _staff_member(users, store.id, user_id, user)
    role = locked_role(stores, roles, store.id, change.role_id)
    if not can_hand_out(user, role.permissions):
        raise beyond_your_permissions()
    try:
        after = users.update(user_id, store_role_id=role.id)
    except psycopg.errors.ForeignKeyViolation:  # the role was deleted just now
        raise role_not_found() from None
    assert after is not None  # locked above
    _record_user_change(audit, user, before, after)
    return after


@router.delete(
    "/staff/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={409: error_response("Staff can't remove themselves")},
)
def remove_staff(
    user_id: UUID, store: ManagedStore, user: StaffUser, users: Users, audit: AuditLog
) -> Response:
    """Make one of this store's staff a regular user again. Needs manage_staff, and their role
    can't do more than the caller's (403 beyond_your_permissions). Nobody removes themselves
    (409 cannot_change_own_account)."""
    before = _staff_member(users, store.id, user_id, user)
    after = users.update(user_id, role="user")
    assert after is not None  # locked above
    _record_user_change(audit, user, before, after)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
