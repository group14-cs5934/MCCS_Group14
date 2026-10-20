from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

# Whole stars only: strict, so 4.5, "4", and true are rejected instead of being converted.
Stars = Annotated[int, Field(strict=True, ge=1, le=5, description="1 to 5 stars", examples=[4])]


class RatingCreate(BaseModel):
    """What the app sends to rate a product. Unknown fields are rejected so typos don't pass."""

    model_config = ConfigDict(extra="forbid")

    stars: Stars


class RatingRead(BaseModel):
    """The signed-in user's rating of a product."""

    product_id: int
    stars: int = Field(ge=1, le=5, examples=[4])
    created_at: datetime = Field(description="When the product was first rated")
    updated_at: datetime = Field(description="When the stars last changed")
