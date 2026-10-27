"""Setting a product's stock at one store by hand, shared by admins (/admin/products/{id}/stock,
T094) and store staff (/staff/stores/{id}/stock). Who may edit which store is checked by the
routes; this does the edit the same way for both.

Stock set by hand is marked (product_stock.admin_set_at, "set by an admin or store staff"), so the
product monitor and the simulated stock script leave it alone until it's handed back to them.
Each change is recorded in the audit log (T083) under whoever made it.
"""

from fastapi import status

from app.core.auth import AuthUser
from app.core.errors import ApiError
from app.repositories import AuditLog, Stores
from app.repositories.audit_log import changed_fields
from app.schemas.store import AdminStoreStock, StockUpdate, StoreRead


def product_not_found() -> ApiError:
    return ApiError(status.HTTP_404_NOT_FOUND, "product_not_found", "Product not found")


def store_not_found() -> ApiError:
    return ApiError(status.HTTP_404_NOT_FOUND, "store_not_found", "Store not found")


def _stock_fields(store: StoreRead, row: dict | None) -> dict[str, object]:
    """What the audit log compares for one store's stock, labelled with the store's name, e.g.
    "Camp Lejeune MCX in_stock"."""
    row = row or {}
    return {
        f"{store.name} in_stock": row.get("in_stock"),
        f"{store.name} quantity": row.get("quantity"),
        f"{store.name} aisle": row.get("aisle"),
    }


def _record(audit: AuditLog, actor: AuthUser, action: str, product_id: int, changes) -> None:
    audit.record(
        admin_id=actor.id,
        admin_email=actor.email,
        action=action,
        target_type="product",
        target_id=product_id,
        changes=changes,
    )


def store_stock(stores: Stores, product_id: int, store_id: int) -> AdminStoreStock:
    """The product's stock at one store, as it is now."""
    availability = stores.admin_availability(product_id)
    assert availability is not None
    return next(row for row in availability.stores if row.store.id == store_id)


def set_stock(
    stores: Stores,
    audit: AuditLog,
    actor: AuthUser,
    product_id: int,
    store: StoreRead,
    stock: StockUpdate,
) -> AdminStoreStock:
    """Set the product's stock at `store`; an aisle that isn't sent keeps its value. 404 if the
    product doesn't exist."""
    if not stores.product_exists(product_id):
        raise product_not_found()
    before = stores.stock(product_id, store.id)
    stores.set_stock(
        product_id,
        store.id,
        stock.in_stock,
        stock.quantity,
        stock.aisle,
        keep_aisle="aisle" not in stock.model_fields_set,
    )
    after = stores.stock(product_id, store.id)
    changes = changed_fields(_stock_fields(store, before), _stock_fields(store, after))
    _record(audit, actor, "stock.set", product_id, changes)
    return store_stock(stores, product_id, store.id)


def clear_stock(
    stores: Stores, audit: AuditLog, actor: AuthUser, product_id: int, store: StoreRead
) -> None:
    """Hand the product's stock at `store` back to automatic updates. 404 if the product doesn't
    exist, or (admin_stock_not_found) if nobody had set it by hand."""
    if not stores.product_exists(product_id):
        raise product_not_found()
    if not stores.clear_admin_stock(product_id, store.id):
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "admin_stock_not_found",
            "This product's stock at this store wasn't set by hand",
        )
    changes = changed_fields({f"{store.name} set_by_admin": True}, {})
    _record(audit, actor, "stock.clear", product_id, changes)
