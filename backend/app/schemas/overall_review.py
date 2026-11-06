"""The AI-written overall review of a product (T052.8).

jobs/product-monitor reads shoppers' reviews on online stores' product pages and has a model
write one overall review per product from them (agent_review_summaries, migrations 018 and 022).
The product page shows it apart from app users' own reviews, labelled as written by AI.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class OverallReviewSource(BaseModel):
    """What one store's product page says about all of the product's reviews there."""

    source: str = Field(
        description="The store's web address, e.g. mynavyexchange.com",
        examples=["mynavyexchange.com"],
    )
    average_stars: float | None = Field(
        description="The page's average rating out of 5; null if it shows none", examples=[4.6]
    )
    review_count: int | None = Field(
        description="How many reviews the page says the product has; null if it doesn't say",
        examples=[928],
    )


class OverallReviewRead(BaseModel):
    """A product's overall review, written by AI from shoppers' reviews on other stores' sites."""

    product_id: int
    overall_review: str = Field(
        description="The AI-written overall review",
        examples=["Shoppers like its smooth, mild flavour; a few find it too weak."],
    )
    review_count: int = Field(
        ge=0, description="How many collected reviews it was written from", examples=[128]
    )
    generated_at: datetime = Field(description="When it was written")
    sources: list[OverallReviewSource] = Field(
        description="Each store the reviews came from, with its own average and total"
    )
