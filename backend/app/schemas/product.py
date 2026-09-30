from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, HttpUrl

from app.schemas.brand import BrandRead
from app.schemas.category import CategoryRead
from app.schemas.price import PriceRead

GTIN_LENGTHS = (8, 12, 13, 14)  # EAN-8, UPC-A, EAN-13, GTIN-14


def _check_barcode(value: str) -> str:
    value = value.strip()
    if not value.isdigit() or len(value) not in GTIN_LENGTHS:
        raise ValueError("barcode must be 8, 12, 13, or 14 digits (EAN-8, UPC-A, EAN-13, GTIN-14)")
    body, check = value[:-1], int(value[-1])
    # GS1 check digit: weight body digits 3,1,3,... starting from the right.
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    if (10 - total % 10) % 10 != check:
        raise ValueError("barcode check digit is wrong (mistyped or misread barcode)")
    return value


Barcode = Annotated[
    str,
    AfterValidator(_check_barcode),
    Field(description="UPC/EAN barcode digits", examples=["036000291452"]),
]


class ProductBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    # Required
    barcode: Barcode
    name: str = Field(min_length=1, max_length=200, examples=["Lay's Sour Cream & Onion"])

    # Optional
    description: str | None = Field(default=None, max_length=2000)
    size: str | None = Field(default=None, max_length=50, examples=["184g"])
    image_url: HttpUrl | None = None
    brand_id: int | None = None
    category_id: int | None = None


class ProductCreate(ProductBase):
    """Payload to create a product. Unknown fields are rejected so typos don't pass silently."""

    model_config = ConfigDict(extra="forbid")


class ProductRead(ProductBase):
    """Product as returned by the API, with its brand, category, and current price."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    brand: BrandRead | None = None
    category: CategoryRead | None = None
    price: PriceRead | None = Field(default=None, description="Most recent price, if any")
    created_at: datetime
    updated_at: datetime
