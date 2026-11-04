"""Restock alerts (migration 020, app/api/restock.py): what's low or out of stock at a store, how
popular it is and how often it runs out, and reorder requests."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.store import StockProduct

# Reorder points and quantities, kept to sensible sizes for one store.
MAX_UNITS = 10_000

RestockStatus = Literal["out", "low"]
RequestStatus = Literal["open", "restocked", "cancelled"]


class ActivityCreate(BaseModel):
    """A shopper opening a product's page, or scanning it (POST /products/{id}/activity)."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["view", "scan"]
    store_id: int | None = Field(
        default=None, ge=1, le=2**31 - 1, description="The store the shopper picked in the app"
    )


class RestockSummary(BaseModel):
    """Counts for a store's restock badge."""

    out: int = Field(description="Products out of stock")
    low: int = Field(description="Products in stock but at or below their reorder point")
    open_requests: int
    default_reorder_point: int


class RestockStats(BaseModel):
    """How popular a product is at a store and how it has sold."""

    views_30d: int
    scans_30d: int
    interest_change: float | None = Field(
        description="% change in views and scans against the 30 days before; null without data"
    )
    popular: bool = Field(description="Among the store's most viewed and scanned products")
    stockouts_30d: int = Field(description="Times it ran out in the last 30 days")
    stockouts_90d: int
    days_out_30d: float = Field(description="Days it was out of stock in the last 30 days")
    sold_per_day: float | None = Field(
        description="Estimated from drops in quantity; null when quantities aren't known"
    )
    days_left: float | None = Field(description="At that rate, until it runs out")


class RestockRequestRead(BaseModel):
    """A reorder request. There are no suppliers yet, so it's a record of who asked for how many;
    it's closed ("restocked") once the product is above its reorder point again."""

    id: int
    product: StockProduct
    quantity: int
    note: str | None = None
    status: RequestStatus
    requested_at: datetime
    requested_by: str | None = Field(default=None, description="The requester's email")
    closed_at: datetime | None = None


class RestockItem(BaseModel):
    """A product that's low or out of stock at a store, with what to reorder."""

    product: StockProduct
    status: RestockStatus
    quantity: int | None = None
    aisle: str | None = None
    reorder_point: int
    reorder_point_is_default: bool
    stats: RestockStats
    last_request: RestockRequestRead | None = None
    suggested_quantity: int | None = None
    advice: str | None = Field(default=None, description="A sentence to show with the item")


class RestockRequestCreate(BaseModel):
    """A reorder request, e.g. {"quantity": 24}."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    quantity: int = Field(ge=1, le=MAX_UNITS, strict=True, examples=[24])
    note: str | None = Field(default=None, max_length=200)


class ReorderPointUpdate(BaseModel):
    """A product's own reorder point at a store; null goes back to the store's default."""

    model_config = ConfigDict(extra="forbid")

    reorder_point: int | None = Field(ge=0, le=MAX_UNITS, strict=True)


class ReorderPointRead(BaseModel):
    reorder_point: int
    reorder_point_is_default: bool


class RestockSettingsUpdate(BaseModel):
    """A store's default reorder point."""

    model_config = ConfigDict(extra="forbid")

    default_reorder_point: int = Field(ge=0, le=MAX_UNITS, strict=True)
