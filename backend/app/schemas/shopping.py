"""Saved products, the cart, and demo orders (migration 021, app/api/shopping.py)."""

from datetime import datetime
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.store import StoreRead

MAX_QUANTITY = 99

Fulfillment = Literal["pickup", "delivery"]
Availability = Literal["available", "limited", "unavailable"]


class ProductCard(BaseModel):
    """A product as a saved list, cart, or checkout shows it."""

    id: int
    barcode: str
    name: str
    size: str | None = None
    image_url: str | None = None
    price: Decimal | None = Field(default=None, description="The latest price; null if none")


class SavedProduct(BaseModel):
    product: ProductCard
    saved_at: datetime
    in_cart: bool


class CartItem(BaseModel):
    product: ProductCard
    quantity: int
    line_total: Decimal | None = Field(description="Price × quantity; null without a price")


class Cart(BaseModel):
    items: list[CartItem]
    item_count: int = Field(description="Every unit in the cart")
    subtotal: Decimal | None = Field(description="Total of the priced lines; null when empty")
    unpriced_items: int = Field(description="Lines whose product has no price yet")


class CartAdd(BaseModel):
    """Adding to the cart; adds to what's there, up to MAX_QUANTITY."""

    model_config = ConfigDict(extra="forbid")

    quantity: int = Field(default=1, ge=1, le=MAX_QUANTITY, strict=True)


class CartSet(BaseModel):
    """Setting how many of a product are in the cart."""

    model_config = ConfigDict(extra="forbid")

    quantity: int = Field(ge=1, le=MAX_QUANTITY, strict=True)


class CheckItem(BaseModel):
    product: ProductCard
    quantity: int
    status: Availability
    available_quantity: int | None = Field(
        default=None, description="For limited: how many the store has"
    )


class StoreOption(BaseModel):
    store: StoreRead
    available_items: int = Field(description="Cart lines this store can fill completely")
    total_items: int


class CartCheck(BaseModel):
    """Whether a store can fill the cart, line by line, and which stores could."""

    store: StoreRead
    all_available: bool
    items: list[CheckItem]
    stores: list[StoreOption] = Field(description="Best first: all available, then most, then name")


class OrderCreate(BaseModel):
    """Placing a demo order for what's in the cart. No payment is taken."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    store_id: int = Field(ge=1, le=2**31 - 1)
    fulfillment: Fulfillment
    delivery_address: str | None = Field(default=None, min_length=5, max_length=300)
    contact_name: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def _blank_name_is_none(self) -> Self:
        if self.contact_name == "":
            self.contact_name = None
        return self


class OrderStore(BaseModel):
    id: int | None = Field(description="Null if the store has since been deleted")
    name: str


class OrderItem(BaseModel):
    product_id: int | None = Field(description="Null if the product has since been deleted")
    name: str
    quantity: int
    unit_price: Decimal | None = None


class Order(BaseModel):
    id: int
    number: str = Field(examples=["R-1042"])
    store: OrderStore
    fulfillment: Fulfillment
    delivery_address: str | None = None
    contact_name: str | None = None
    status: Literal["placed"]
    placed_at: datetime
    items: list[OrderItem]
    item_count: int
    total: Decimal | None = Field(description="Total of the priced items; null if none had one")
