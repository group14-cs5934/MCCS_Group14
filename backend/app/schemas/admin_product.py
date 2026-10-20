"""What admins send to create or edit a product (T087)."""

from typing import Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from app.schemas.price import Money
from app.schemas.product import Barcode, ProductCreate

# Product fields that can't be cleared: every product has a barcode and a name.
_REQUIRED_FIELDS = ("barcode", "name")


class AdminProductCreate(ProductCreate):
    """A new product, optionally with its current price."""

    price: Money | None = Field(
        default=None, description='Current price in USD, e.g. "3.49"; leave out if unknown'
    )


class AdminProductUpdate(BaseModel):
    """Changes to a product. Only the fields sent are changed; send null to clear an optional
    field (description, size, image_url, brand_id, category_id). A new price is added to the
    product's price history and becomes its current price."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    barcode: Barcode | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    size: str | None = Field(default=None, max_length=50)
    image_url: HttpUrl | None = None
    brand_id: int | None = None
    category_id: int | None = None
    price: Money | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("send at least one field to change")
        for field in (*_REQUIRED_FIELDS, "price"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} can't be null")
        return self

    def product_changes(self) -> dict[str, object]:
        """The product columns to change (everything sent except price), ready for the database."""
        changes = self.model_dump(include=self.model_fields_set - {"price"})
        if changes.get("image_url") is not None:
            changes["image_url"] = str(changes["image_url"])
        return changes
