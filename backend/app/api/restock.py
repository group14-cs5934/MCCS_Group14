"""Restock alerts (migration 020): what's low or out of stock at a store, how popular it is and
how often it runs out, and reorder requests.

A product is out when it's out of stock, and low when it's in stock at or below its reorder point
(its own at the store, else the store's default). Popularity comes from shoppers' views and scans
at the store (POST /products/{id}/activity); running out and selling, from the stock history that
a trigger keeps (stock_events). See app/core/restock.py for the numbers.

There are no suppliers yet, so a reorder request is a record of who asked for how many. It
closes by itself once the product is above its reorder point again.

Seeing alerts needs view_restock; requesting reorders and setting reorder points needs
request_restock. Requests and reorder point changes are recorded in the audit log.
"""

from datetime import UTC, datetime
from typing import Annotated, Literal

import psycopg
from fastapi import APIRouter, Depends, Query, Response, status

from app.api.staff import RESPONSES, require_permission
from app.core import restock as stats
from app.core.auth import StaffUser
from app.core.errors import ApiError, error_response
from app.repositories import AuditLog, Restock, Stores
from app.repositories.audit_log import changed_fields
from app.schemas.restock import (
    ReorderPointRead,
    ReorderPointUpdate,
    RestockItem,
    RestockRequestCreate,
    RestockRequestRead,
    RestockSettingsUpdate,
    RestockStats,
    RestockSummary,
)
from app.schemas.store import StoreRead

MAX_PER_PAGE = 50

router = APIRouter(
    prefix="/staff/stores/{store_id:int}/restock", tags=["staff"], responses=RESPONSES
)

# Route parameters: the store, once the user's permission there is checked.
AlertsStore = Annotated[StoreRead, Depends(require_permission("view_restock", "request_restock"))]
RequestsStore = Annotated[StoreRead, Depends(require_permission("request_restock"))]

Limit = Annotated[int, Query(ge=1, le=MAX_PER_PAGE)]
Offset = Annotated[int, Query(ge=0, le=10_000)]


def _product(stores: Stores, product_id: int) -> None:
    if not stores.product_exists(product_id):
        raise ApiError(status.HTTP_404_NOT_FOUND, "product_not_found", "Product not found")


def _record(audit: AuditLog, user: StaffUser, action: str, request: RestockRequestRead) -> None:
    audit.record(
        admin_id=user.id,
        admin_email=user.email,
        action=action,
        target_type="restock_request",
        target_id=request.id,
        changes={
            "product": request.product.name,
            "quantity": request.quantity,
            "status": request.status,
        },
    )


@router.get("/summary")
def summary(store: AlertsStore, restock: Restock) -> RestockSummary:
    """How many products are out and low, and how many reorders are open: the app's badge."""
    return restock.summary(store.id)


@router.get("")
def list_items(
    store: AlertsStore,
    restock: Restock,
    status_filter: Annotated[
        Literal["all", "out", "low"], Query(alias="status", description="Which items")
    ] = "all",
    limit: Limit = 20,
    offset: Offset = 0,
) -> list[RestockItem]:
    """Products that are out or low at this store, most urgent first (out before low, then the
    most viewed and scanned), each with its stats, last reorder request, a suggested quantity,
    and a sentence of advice when there's something worth saying."""
    rows = restock.items(store.id, status_filter, limit=limit, offset=offset)
    product_ids = [row["product_id"] for row in rows]
    history = restock.history(store.id, product_ids)
    last = restock.last_requests(store.id, product_ids)
    now = datetime.now(UTC)
    items = []
    for row in rows:
        found = stats.history_stats(history.get(row["product_id"], []), now)
        left = stats.days_left(row["in_stock"], row["quantity"], found.sold_per_day)
        last_request = last.get(row["product_id"])
        suggested, advice = stats.suggestion(
            quantity=row["quantity"],
            reorder_point=row["reorder_point"],
            sold_per_day=found.sold_per_day,
            last_quantity=last_request.quantity if last_request else None,
            popular=row["popular"],
            stockouts_30d=found.stockouts_30d,
            days_left=left,
        )
        items.append(
            RestockItem(
                product=row["product"],
                status=row["status"],
                quantity=row["quantity"],
                aisle=row["aisle"],
                reorder_point=row["reorder_point"],
                reorder_point_is_default=row["reorder_point_is_default"],
                stats=RestockStats(
                    views_30d=row["views_30d"],
                    scans_30d=row["scans_30d"],
                    interest_change=stats.interest_change(
                        row["views_30d"] + row["scans_30d"], row["before_30d"]
                    ),
                    popular=row["popular"],
                    stockouts_30d=found.stockouts_30d,
                    stockouts_90d=found.stockouts_90d,
                    days_out_30d=found.days_out_30d,
                    sold_per_day=found.sold_per_day,
                    days_left=left,
                ),
                last_request=last_request,
                suggested_quantity=suggested,
                advice=advice,
            )
        )
    return items


@router.get("/requests")
def list_requests(
    store: AlertsStore,
    restock: Restock,
    status_filter: Annotated[Literal["open", "all"], Query(alias="status")] = "open",
    limit: Limit = 20,
    offset: Offset = 0,
) -> list[RestockRequestRead]:
    """The store's reorder requests, newest first: only open ones unless status=all."""
    return restock.requests(store.id, status_filter == "open", limit=limit, offset=offset)


@router.post(
    "/{product_id:int}/requests",
    status_code=status.HTTP_201_CREATED,
    responses={409: error_response("A request for this product is already open")},
)
def request_reorder(
    product_id: int,
    request: RestockRequestCreate,
    store: RequestsStore,
    user: StaffUser,
    stores: Stores,
    restock: Restock,
    audit: AuditLog,
) -> RestockRequestRead:
    """Request a reorder of this product, e.g. {"quantity": 24, "note": "Before the weekend"}.
    One can be open per product at a time (409 restock_already_requested). A product that's
    known to be above its reorder point can't be requested (409 not_low): the request would stay
    open until its next stock change. One the store doesn't carry yet can, and closes once it's
    stocked."""
    _product(stores, product_id)
    if restock.above_reorder_point(store.id, product_id):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "not_low",
            "This product isn't low here. Lower its reorder point if it should count as low.",
        )
    try:
        created = restock.create_request(
            store.id, product_id, request.quantity, request.note, user.id
        )
    except psycopg.errors.UniqueViolation:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "restock_already_requested",
            "A reorder of this product is already open. Cancel it to request a different amount.",
        ) from None
    _record(audit, user, "restock.request", created)
    return created


@router.delete(
    "/{product_id:int}/requests/open",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: error_response("No open request for this product")},
)
def cancel_reorder(
    product_id: int, store: RequestsStore, user: StaffUser, restock: Restock, audit: AuditLog
) -> Response:
    """Cancel this product's open reorder request (404 no_open_request)."""
    cancelled = restock.cancel_open_request(store.id, product_id)
    if cancelled is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "no_open_request",
            "There's no open reorder request for this product.",
        )
    _record(audit, user, "restock.cancel", cancelled)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{product_id:int}/reorder-point")
def set_reorder_point(
    product_id: int,
    change: ReorderPointUpdate,
    store: RequestsStore,
    user: StaffUser,
    stores: Stores,
    restock: Restock,
    audit: AuditLog,
) -> ReorderPointRead:
    """When this product counts as low here: {"reorder_point": 12}, or {"reorder_point": null}
    to use the store's default."""
    _product(stores, product_id)
    before = restock.reorder_point(store.id, product_id)
    restock.set_reorder_point(store.id, product_id, change.reorder_point)
    value, is_default = restock.reorder_point(store.id, product_id)
    audit.record(
        admin_id=user.id,
        admin_email=user.email,
        action="restock.reorder_point",
        target_type="product",
        target_id=product_id,
        changes=changed_fields(
            {f"store {store.id} reorder point": before[0]},
            {f"store {store.id} reorder point": value},
        ),
    )
    return ReorderPointRead(reorder_point=value, reorder_point_is_default=is_default)


@router.put("/settings")
def update_settings(
    change: RestockSettingsUpdate,
    store: RequestsStore,
    user: StaffUser,
    restock: Restock,
    audit: AuditLog,
) -> RestockSummary:
    """The store's default reorder point, for products without their own."""
    before = restock.summary(store.id).default_reorder_point
    restock.set_default_reorder_point(store.id, change.default_reorder_point)
    audit.record(
        admin_id=user.id,
        admin_email=user.email,
        action="store.update",
        target_type="store",
        target_id=store.id,
        changes=changed_fields(
            {"default_reorder_point": before},
            {"default_reorder_point": change.default_reorder_point},
        ),
    )
    return restock.summary(store.id)
