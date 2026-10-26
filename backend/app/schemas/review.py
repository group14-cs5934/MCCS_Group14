"""Product reviews (US09): a signed-in user's written review of a product (T058)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Limits match the reviews table (migration 005); the API checks them first so the app gets a
# clear message instead of a database error.
TITLE_MAX_LENGTH = 100
BODY_MAX_LENGTH = 2000


def _collapse_blank_lines(text: str) -> str:
    """Text without trailing spaces on each line, and at most one blank line in a row."""
    lines = [line.rstrip() for line in text.strip().splitlines()]
    kept: list[str] = []
    for line in lines:
        if line or (kept and kept[-1]):
            kept.append(line)
    return "\n".join(kept)


class ReviewCreate(BaseModel):
    """What the app sends to write (or rewrite) a review. Unknown fields are rejected.

    Whitespace around the text is ignored when checking lengths, so a review of only spaces counts
    as empty. A blank title is the same as no title.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(
        default=None,
        description=f"Optional headline, up to {TITLE_MAX_LENGTH} characters",
        examples=["Great for road trips"],
    )
    body: str = Field(
        description=f"The review, 1 to {BODY_MAX_LENGTH} characters",
        examples=["Crunchy, not too salty, and the bag lasts the whole drive."],
    )

    @field_validator("title")
    @classmethod
    def _check_title(cls, title: str | None) -> str | None:
        title = " ".join((title or "").split())
        if len(title) > TITLE_MAX_LENGTH:
            raise ValueError(
                f"The title is {len(title)} characters; keep it to {TITLE_MAX_LENGTH} or fewer"
            )
        return title or None

    @field_validator("body")
    @classmethod
    def _check_body(cls, body: str) -> str:
        body = _collapse_blank_lines(body)
        if not body:
            raise ValueError("The review can't be empty")
        if len(body) > BODY_MAX_LENGTH:
            raise ValueError(
                f"The review is {len(body)} characters; keep it to {BODY_MAX_LENGTH} or fewer"
            )
        return body


class ReviewRead(BaseModel):
    """A review as shown on the product page."""

    id: int
    product_id: int
    title: str | None
    body: str
    author: str = Field(
        description="Who wrote it, shortened so it doesn't reveal their email", examples=["a***"]
    )
    stars: int | None = Field(
        default=None, ge=1, le=5, description="The author's own rating of the product, if any"
    )
    created_at: datetime = Field(description="When the review was first posted")
    updated_at: datetime = Field(description="When the review was last edited")


class ReviewPage(BaseModel):
    """One page of a product's reviews, newest first."""

    items: list[ReviewRead]
    total: int = Field(ge=0, description="How many reviews the product has in all")
    limit: int = Field(description="Most reviews per page, as requested")
    offset: int = Field(description="Reviews skipped before this page, as requested")


def author_name(email: str | None) -> str:
    """How a reviewer is shown: the first letter of their email, e.g. alice@example.com ->
    "a***". Reviews are public, so the full email is never sent."""
    local = (email or "").split("@", 1)[0].strip()
    return f"{local[0].lower()}***" if local else "Shopper"


class AdminReviewRead(ReviewRead):
    """A review as admins see it when moderating (T082): who wrote it, and whether it's hidden."""

    user_id: UUID
    author_email: str | None = Field(description="The author's full email (admins only)")
    hidden: bool = Field(description="True if an admin hid it from the product page")
    hidden_at: datetime | None = Field(default=None, description="When it was hidden")


class ReviewModeration(BaseModel):
    """An admin's change to a review (PATCH /admin/reviews/{id})."""

    model_config = ConfigDict(extra="forbid")

    # Strict: only true or false, so a string like "no" can't change a review by accident.
    hidden: bool = Field(
        strict=True, description="true hides the review from the product page, false shows it again"
    )
