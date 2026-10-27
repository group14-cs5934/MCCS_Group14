"""Store staff (added after the Gantt tasks): workers and managers look after their own store.

Roles are in users.role and users.store_id (migration 016):

- worker: edits their store's stock;
- manager: also adds and removes their store's workers;
- admin: can do both at every store (and makes people managers, through PATCH /admin/users).

Every route needs a signed-in worker, manager, or admin: 401 without a valid token, 403 for
regular users (code forbidden) and for staff of another store (code not_your_store). Stock is set
exactly as admins set it (stock_edits.py), so the product monitor keeps it until it's handed back.
Each change is recorded in the audit log under whoever made it.
"""

from typing import Annotated, Any
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, Response, status

from app.api import stock_edits
from app.core.auth import AuthUser, StaffUser, can_edit_stock, can_manage_staff
from app.core.errors import ApiError, error_response
from app.repositories import AuditLog, Stores, Users
from app.repositories.audit_log import changed_fields
from app.schemas import StaffAdd, UserAccount
from app.schemas.store import AdminStoreStock, StaffStockRow, StockUpdate, StoreRead

MAX_STOCK_PER_PAGE = 50

_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: error_response("Missing, invalid, or expired token"),
    403: error_response("Not store staff, or not staff at this store"),
    404: error_response("No such store (or product, or person)"),
    422: error_response("Invalid request; details lists each problem"),
}

router = APIRouter(prefix="/staff/stores/{store_id:int}", tags=["staff"], responses=_RESPONSES)


def _not_your_store() -> ApiError:
    return ApiError(
        status.HTTP_403_FORBIDDEN, "not_your_store", "You can only do that at your own store."
    )


def _store(stores: Stores, store_id: int) -> StoreRead:
    store = stores.get_store(store_id)
    if store is None:  # only admins get here for a store that doesn't exist
        raise stock_edits.store_not_found()
    return store


def _stock_store(store_id: int, user: StaffUser, stores: Stores) -> StoreRead:
    """FastAPI dependency: the store, if this user may edit its stock. A dependency, so it's
    checked before the request body (an invalid body from another store's staff is still 403)."""
    if not can_edit_stock(user, store_id):
        raise _not_your_store()
    return _store(stores, store_id)


def _staff_store(store_id: int, user: StaffUser, stores: Stores) -> StoreRead:
    """FastAPI dependency: the store, if this user may manage its staff."""
    if not can_manage_staff(user, store_id):
        if user.role == "worker" and user.store_id == store_id:
            raise ApiError(
                status.HTTP_403_FORBIDDEN,
                "managers_only",
                "Only the store's manager can change its staff.",
            )
        raise _not_your_store()
    return _store(stores, store_id)


# Route parameters: the store from the path, once the signed-in user's access to it is checked.
StockStore = Annotated[StoreRead, Depends(_stock_store)]
ManagedStore = Annotated[StoreRead, Depends(_staff_store)]


def _record_user_change(
    audit: AuditLog, actor: AuthUser, before: UserAccount, after: UserAccount
) -> None:
    fields = ("role", "store_id")
    audit.record(
        admin_id=actor.id,
        admin_email=actor.email,
        action="user.update",
        target_type="user",
        target_id=after.id,
        changes=changed_fields(
            {field: getattr(before, field) for field in fields},
            {field: getattr(after, field) for field in fields},
        ),
    )


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
    the store has no record for are listed as out of stock, so they can be stocked."""
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
    updates leave it alone until it's handed back (DELETE)."""
    return stock_edits.set_stock(stores, audit, user, product_id, store, stock)


@router.delete("/stock/{product_id:int}", status_code=status.HTTP_204_NO_CONTENT)
def clear_stock(
    product_id: int, store: StockStore, user: StaffUser, stores: Stores, audit: AuditLog
) -> Response:
    """Hand a product's stock at this store back to automatic updates. 204 when done; 404 with
    code admin_stock_not_found if it wasn't set by hand."""
    stock_edits.clear_stock(stores, audit, user, product_id, store)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Staff ---


@router.get("/staff")
def list_staff(store: ManagedStore, users: Users) -> list[UserAccount]:
    """The store's managers, then its workers. Managers (of this store) and admins only."""
    return users.list_staff(store.id)


@router.post(
    "/staff",
    status_code=status.HTTP_201_CREATED,
    responses={409: error_response("Already staff or an admin, or the account is deactivated")},
)
def add_worker(
    person: StaffAdd, store: ManagedStore, user: StaffUser, users: Users, audit: AuditLog
) -> UserAccount:
    """Make someone a worker at this store, by the email they signed up with. They need an
    account first (404 user_not_found), must be a regular user (409 already_staff), and active
    (409 account_deactivated). Only admins make managers (PATCH /admin/users)."""
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
        after = users.update(before.id, role="worker", store_id=store.id)
    except psycopg.errors.ForeignKeyViolation:  # an admin deleted the store just now
        raise stock_edits.store_not_found() from None
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
    """Make one of this store's workers a regular user again. Only admins remove managers
    (403 admins_only). Nobody removes themselves (409 cannot_change_own_account)."""
    if user_id == user.id:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "cannot_change_own_account",
            "You can't remove yourself from the store.",
        )
    before = users.get(user_id) if users.lock(user_id) else None
    if before is None or before.store_id != store.id:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "staff_not_found", "This person isn't staff at this store."
        )
    if before.role == "manager" and user.role != "admin":
        raise ApiError(
            status.HTTP_403_FORBIDDEN, "admins_only", "Only an admin can remove a manager."
        )
    after = users.update(user_id, role="user")
    assert after is not None  # locked above
    _record_user_change(audit, user, before, after)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
