"""What the redesigned Home and admin overview show: a store's popular products, and counts
across every store."""

from pydantic import BaseModel, Field

from app.schemas.shopping import ProductCard


class PopularProduct(BaseModel):
    """A product shoppers looked at a lot at a store lately, with its stock there."""

    product: ProductCard
    interest: int = Field(ge=0, description="App views plus scans at this store, last 30 days")
    in_stock: bool | None = Field(description="Null when the store has no stock record for it")
    quantity: int | None = None
    low: bool = Field(
        False, description="In stock but at or below the store's reorder point for it"
    )
    aisle: str | None = None
    rating: float | None = Field(None, description="Mean stars, 2 decimals; null if unrated")
    rating_count: int = Field(0, ge=0)


class AdminOverview(BaseModel):
    """Counts for the admin overview, across every store."""

    products: int = Field(ge=0)
    users: int = Field(ge=0, description="Accounts that aren't deactivated")
    staff: int = Field(ge=0, description="Of those, store staff")
    admins: int = Field(ge=0)
    stores: int = Field(ge=0)
    reviews_today: int = Field(
        ge=0, description="Reviews written in the last 24 hours (hidden ones included)"
    )
    out_of_stock: int = Field(ge=0, description="Product and store pairs marked out of stock")
    low_stock: int = Field(ge=0, description="In stock at or below the store's reorder point")
    open_reorders: int = Field(ge=0, description="Restock requests not yet closed")
