"""What admins send to create or edit a product (T087)."""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from app.schemas.price import Money
from app.schemas.product import Barcode, ProductCreate, ProductRead

# Fields an admin can set, and so protect from the product sync (T089).
AdminField = Literal[
    "barcode", "name", "description", "size", "image_url", "brand_id", "category_id", "price"
]

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
    # Fields set here are protected from the product sync (T089). This hands fields back to it:
    # true for all of them, or a list such as ["name", "price"].
    resume_sync: Literal[True] | list[AdminField] | None = Field(
        default=None,
        description="Let the product sync update these fields again: true for all, or a list",
        examples=[["name"]],
    )

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("send at least one field to change")
        for field in (*_REQUIRED_FIELDS, "price"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} can't be null")
        return self

    def edited_fields(self) -> set[str]:
        """The product fields this edit sets, which the sync should leave alone from now on."""
        return self.model_fields_set - {"resume_sync"}

    def product_changes(self) -> dict[str, object]:
        """The product columns to change (everything sent except price), ready for the database."""
        changes = self.model_dump(include=self.model_fields_set - {"price", "resume_sync"})
        if changes.get("image_url") is not None:
            changes["image_url"] = str(changes["image_url"])
        return changes


class AdminProductRead(ProductRead):
    """A product as admins see it: also which fields an admin set, so the sync leaves them."""

    admin_fields: list[str] = Field(
        default=[],
        description="Fields an admin set; the product sync doesn't change them (T089)",
        examples=[["name", "price"]],
    )
