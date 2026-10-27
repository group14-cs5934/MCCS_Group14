"""MCCS store locations and whether each one has a product in stock (US06)."""

from datetime import datetime
from typing import Annotated, Self

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.schemas.category import Slug


class StoreRead(BaseModel):
    """An MCCS store, e.g. a Marine Corps Exchange (MCX)."""

    id: int
    name: str = Field(examples=["Camp Lejeune MCX"])
    slug: str = Field(examples=["camp-lejeune-mcx"])
    address: str | None = Field(default=None, examples=["Bldg. 1231 Birch St., Camp Lejeune, NC"])
    hours: str | None = Field(
        default=None,
        description="Opening hours as the store words them; null if not listed",
        examples=["Mon–Sat 9 AM–9 PM · Sun 10 AM–6 PM"],
    )


class StoreAvailability(BaseModel):
    """Whether one store has the product."""

    store: StoreRead
    in_stock: bool = Field(description="False when out of stock, or when the store has no record")
    quantity: int | None = Field(default=None, ge=0, description="Units on hand, if known")
    aisle: str | None = Field(default=None, examples=["Aisle 7"])
    updated_at: datetime | None = Field(
        default=None, description="When this store's stock was last updated; null if never"
    )


class ProductAvailability(BaseModel):
    """A product's stock at every store, in-stock stores first."""

    product_id: int
    stores: list[StoreAvailability]


# --- Admin (T094) ---


def _blank_is_none(value: object) -> object:
    """Blank text (e.g. "  ") is the same as none."""
    return (value.strip() or None) if isinstance(value, str) else value


# A store's hours as it words them. Blank is saved as none, so the app shows "Hours not listed".
Hours = Annotated[Annotated[str, Field(max_length=200)] | None, BeforeValidator(_blank_is_none)]


class StoreCreate(BaseModel):
    """A new store. Without a slug, one is made from the name, e.g. "Camp Lejeune MCX" ->
    "camp-lejeune-mcx"."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=200, examples=["Camp Lejeune MCX"])
    slug: Slug | None = Field(default=None, examples=["camp-lejeune-mcx"])
    address: str | None = Field(default=None, max_length=500)
    hours: Hours = Field(default=None, examples=["Mon–Sat 9 AM–9 PM · Sun 10 AM–6 PM"])


class StoreUpdate(BaseModel):
    """Changes to a store; only the fields sent change. null clears the address or hours."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: Slug | None = None
    address: str | None = Field(default=None, max_length=500)
    hours: Hours = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("send at least one field to change")
        for field in ("name", "slug"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} can't be null")
        return self


class StockUpdate(BaseModel):
    """An admin setting a product's stock at one store, e.g. {"in_stock": false}."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    in_stock: bool = Field(strict=True, description="false marks the product out of stock there")
    quantity: int | None = Field(
        default=None, strict=True, ge=0, description="Units on hand, if known"
    )
    aisle: str | None = Field(default=None, max_length=50, examples=["Aisle 7"])

    @model_validator(mode="after")
    def _check_quantity(self) -> Self:
        # The same rule as the product_stock table: a quantity must agree with in_stock.
        if self.quantity is not None and self.in_stock != (self.quantity > 0):
            raise ValueError(
                "quantity must be above 0 when in_stock is true, and 0 when it's false"
            )
        return self


class AdminStoreStock(StoreAvailability):
    """One store's stock of a product, as admins see it."""

    admin_set_at: datetime | None = Field(
        default=None,
        description="When an admin set this; automatic updates leave it alone until it's removed",
    )


class AdminProductStock(BaseModel):
    """A product's stock at every store, in-stock stores first, as admins see it."""

    product_id: int
    stores: list[AdminStoreStock]
