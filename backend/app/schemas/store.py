"""MCCS store locations and whether each one has a product in stock (US06)."""

from datetime import datetime

from pydantic import BaseModel, Field


class StoreRead(BaseModel):
    """An MCCS store, e.g. a Marine Corps Exchange (MCX)."""

    id: int
    name: str = Field(examples=["Camp Lejeune MCX"])
    slug: str = Field(examples=["camp-lejeune-mcx"])
    address: str | None = Field(default=None, examples=["Bldg. 1231 Birch St., Camp Lejeune, NC"])


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
