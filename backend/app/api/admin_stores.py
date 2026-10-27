"""Admin management of store locations and per-store stock (US11, T094).

Every route needs a signed-in admin: 401 without a valid token, 403 for anyone else. Stock an
admin sets is marked as theirs (product_stock.admin_set_at), so the product monitor and the
simulated stock script leave it alone; removing the setting hands that store back to them. The
app reads stock fresh (GET /products/{id}/availability), so changes show up there right away.
Each change is recorded in the audit log (T083).
"""

from typing import Any

import psycopg
from fastapi import APIRouter, Response, status

from app.core.auth import AdminUser
from app.core.errors import ApiError, error_response
from app.ingest.load import slugify
from app.repositories import AuditLog, Stores
from app.repositories.audit_log import changed_fields
from app.schemas.store import (
    AdminProductStock,
    AdminStoreStock,
    StockUpdate,
    StoreCreate,
    StoreRead,
    StoreUpdate,
)

_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: error_response("Missing, invalid, or expired token"),
    403: error_response("Not an admin, or the admin's account is deactivated"),
    422: error_response("Invalid request; details lists each problem"),
}

stores_router = APIRouter(prefix="/admin/stores", tags=["admin"], responses=_RESPONSES)
stock_router = APIRouter(prefix="/admin/products", tags=["admin"], responses=_RESPONSES)

_STORE_NOT_FOUND = error_response("No store with this ID")
_SLUG_TAKEN = error_response("Another store already has this slug")


def _store_not_found() -> ApiError:
    return ApiError(status.HTTP_404_NOT_FOUND, "store_not_found", "Store not found")


# Same limit as a slug sent by hand (schemas/category.py), so every store's slug can be edited.
_MAX_SLUG_LENGTH = 100


def _slug_taken() -> ApiError:
    return ApiError(status.HTTP_409_CONFLICT, "slug_taken", "Another store has this slug")


def _check_slug(stores: Stores, slug: str, store_id: int | None) -> None:
    if not slug:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "slug_required",
            "The name has no letters or digits to make a slug from; send a slug",
        )
    if stores.slug_taken(slug, except_id=store_id):
        raise _slug_taken()


def _store_fields(store: StoreRead) -> dict[str, object]:
    return {"name": store.name, "slug": store.slug, "address": store.address, "hours": store.hours}


def _record(
    audit: AuditLog, admin: AdminUser, action: str, target_type: str, target_id, changes
) -> None:
    audit.record(
        admin_id=admin.id,
        admin_email=admin.email,
        action=action,
        target_type=target_type,
        target_id=target_id,
        changes=changes,
    )


# --- Stores ---


@stores_router.post("", status_code=status.HTTP_201_CREATED, responses={409: _SLUG_TAKEN})
def create_store(
    store: StoreCreate, admin: AdminUser, stores: Stores, audit: AuditLog
) -> StoreRead:
    """Add a store. Without a slug, one is made from the name. A slug another store has is a
    409."""
    slug = store.slug or slugify(store.name)[:_MAX_SLUG_LENGTH].strip("-")
    _check_slug(stores, slug, store_id=None)
    try:
        created = stores.create_store(store.name, slug, store.address, store.hours)
    except psycopg.errors.UniqueViolation:  # another admin took the slug just now
        raise _slug_taken() from None
    _record(
        audit, admin, "store.create", "store", created.id,
        changed_fields({}, _store_fields(created)),
    )  # fmt: skip
    return created


@stores_router.patch("/{store_id:int}", responses={404: _STORE_NOT_FOUND, 409: _SLUG_TAKEN})
def update_store(
    store_id: int, change: StoreUpdate, admin: AdminUser, stores: Stores, audit: AuditLog
) -> StoreRead:
    """Change a store's name, slug, address, or hours; only the fields sent change."""
    before = stores.get_store(store_id, lock=True)
    if before is None:
        raise _store_not_found()
    fields = change.model_dump(include=change.model_fields_set)
    if "slug" in fields:
        _check_slug(stores, fields["slug"], store_id=store_id)
    try:
        updated = stores.update_store(store_id, fields)
    except psycopg.errors.UniqueViolation:  # another admin took the slug just now
        raise _slug_taken() from None
    _record(
        audit, admin, "store.update", "store", store_id,
        changed_fields(_store_fields(before), _store_fields(updated)),
    )  # fmt: skip
    return updated


@stores_router.delete(
    "/{store_id:int}", status_code=status.HTTP_204_NO_CONTENT, responses={404: _STORE_NOT_FOUND}
)
def delete_store(store_id: int, admin: AdminUser, stores: Stores, audit: AuditLog) -> Response:
    """Remove a store, along with its stock records. 204 (no body) when done."""
    before = stores.get_store(store_id, lock=True)
    if before is None:
        raise _store_not_found()
    stock_rows = stores.stock_count(store_id)
    stores.delete_store(store_id)
    changes = changed_fields(_store_fields(before), {})
    changes |= changed_fields({"stock_records": stock_rows}, {"stock_records": 0})
    _record(audit, admin, "store.delete", "store", store_id, changes)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Stock ---


def _product_not_found() -> ApiError:
    return ApiError(status.HTTP_404_NOT_FOUND, "product_not_found", "Product not found")


def _stock_fields(store: StoreRead, row: dict | None) -> dict[str, object]:
    """What the audit log compares for one store's stock, labelled with the store's name, e.g.
    "Camp Lejeune MCX in_stock"."""
    row = row or {}
    return {
        f"{store.name} in_stock": row.get("in_stock"),
        f"{store.name} quantity": row.get("quantity"),
        f"{store.name} aisle": row.get("aisle"),
    }


def _store_stock(stores: Stores, product_id: int, store_id: int) -> AdminStoreStock:
    availability = stores.admin_availability(product_id)
    assert availability is not None
    return next(row for row in availability.stores if row.store.id == store_id)


@stock_router.get("/{product_id:int}/stock", responses={404: error_response("No such product")})
def get_stock(product_id: int, admin: AdminUser, stores: Stores) -> AdminProductStock:
    """The product's stock at every store, in-stock stores first, with when an admin set it."""
    availability = stores.admin_availability(product_id)
    if availability is None:
        raise _product_not_found()
    return availability


@stock_router.put(
    "/{product_id:int}/stock/{store_id:int}",
    responses={404: error_response("No such product or store")},
)
def set_stock(
    product_id: int,
    store_id: int,
    stock: StockUpdate,
    admin: AdminUser,
    stores: Stores,
    audit: AuditLog,
) -> AdminStoreStock:
    """Set the product's stock at one store, e.g. {"in_stock": false} to mark it out of stock
    there. Optionally a quantity (which must agree with in_stock) and an aisle; an aisle that
    isn't sent keeps its value. Automatic updates leave this store's stock alone from now on."""
    if not stores.product_exists(product_id):
        raise _product_not_found()
    store = stores.get_store(store_id)
    if store is None:
        raise _store_not_found()
    before = stores.stock(product_id, store_id)
    stores.set_stock(
        product_id,
        store_id,
        stock.in_stock,
        stock.quantity,
        stock.aisle,
        keep_aisle="aisle" not in stock.model_fields_set,
    )
    after = stores.stock(product_id, store_id)
    changes = changed_fields(_stock_fields(store, before), _stock_fields(store, after))
    _record(audit, admin, "stock.set", "product", product_id, changes)
    return _store_stock(stores, product_id, store_id)


@stock_router.delete(
    "/{product_id:int}/stock/{store_id:int}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: error_response("No such product or store, or an admin hadn't set it")},
)
def clear_stock(
    product_id: int, store_id: int, admin: AdminUser, stores: Stores, audit: AuditLog
) -> Response:
    """Hand one store's stock back to automatic updates. The values stay as they are until the
    product monitor next updates them. 204 when done; 404 with code admin_stock_not_found if an
    admin hadn't set it."""
    if not stores.product_exists(product_id):
        raise _product_not_found()
    store = stores.get_store(store_id)
    if store is None:
        raise _store_not_found()
    if not stores.clear_admin_stock(product_id, store_id):
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "admin_stock_not_found",
            "An admin hasn't set this product's stock at this store",
        )
    changes = changed_fields({f"{store.name} set_by_admin": True}, {})
    _record(audit, admin, "stock.clear", "product", product_id, changes)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
