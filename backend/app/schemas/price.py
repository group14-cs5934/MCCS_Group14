from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# Exact decimal with cents (never float). Serialized to JSON as a string, e.g. "3.49".
Money = Annotated[Decimal, Field(gt=0, max_digits=10, decimal_places=2, examples=["3.49"])]

# ISO 4217 code, e.g. USD.
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]


class PriceBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    amount: Money
    currency: Currency = "USD"
    source: str | None = Field(
        default=None, max_length=100, description="Where the price came from", examples=["MCCS"]
    )


class PriceCreate(PriceBase):
    """Payload to record a price for a product."""

    model_config = ConfigDict(extra="forbid")

    product_id: int
    observed_at: datetime | None = Field(
        default=None, description="When the price was seen; the server uses now if omitted"
    )


class PriceRead(PriceBase):
    """Price as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    observed_at: datetime
