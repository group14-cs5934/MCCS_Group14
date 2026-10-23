"""Product reviews (US09): a signed-in user writes a review of a product.

Each user has one review per product; posting again replaces its title and text. The review's
rules (required text, length limits) are in app/schemas/review.py.
"""

from fastapi import APIRouter

from app.core.auth import CurrentUser
from app.core.errors import ApiError, error_response
from app.repositories import Reviews
from app.schemas import ReviewCreate, ReviewRead

router = APIRouter(
    prefix="/products",
    tags=["reviews"],
    responses={422: error_response("Invalid review; details lists each problem")},
)

_NOT_SIGNED_IN = error_response("Missing, invalid, or expired token")


@router.post(
    "/{product_id:int}/reviews",
    responses={401: _NOT_SIGNED_IN, 404: error_response("No product with this ID")},
)
def post_review(
    product_id: int, review: ReviewCreate, user: CurrentUser, reviews: Reviews
) -> ReviewRead:
    """Save the signed-in user's review of a product and return it.

    Posting a second review of the same product replaces the first (title and text), keeping its
    original posting time. An empty review, or one over the length limits, is a 422 whose details
    say what's wrong.
    """
    saved = reviews.save(product_id, user.id, review.title, review.body)
    if saved is None:
        raise ApiError(404, "product_not_found", "Product not found")
    return saved
