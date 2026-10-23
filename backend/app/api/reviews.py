"""Product reviews (US09): a signed-in user writes a review of a product, and anyone can read a
product's reviews, newest first, a page at a time.

Each user has one review per product; posting again replaces its title and text, and they can
remove it. The review's rules (required text, length limits) are in app/schemas/review.py.

Writing, reading your own, and removing a review need a signed-in user (T072): no token, or an
invalid or expired one, is a 401, and a deactivated account is a 403. Every review is linked to
the account that wrote it, so it's removed if that account is deleted.
"""

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.core.auth import CurrentUser
from app.core.errors import ApiError, error_response
from app.repositories import Reviews
from app.schemas import ReviewCreate, ReviewPage, ReviewRead

router = APIRouter(
    prefix="/products",
    tags=["reviews"],
    responses={422: error_response("Invalid review; details lists each problem")},
)

_NOT_SIGNED_IN = error_response("Missing, invalid, or expired token")
_NO_REVIEW = error_response("You haven't reviewed this product (or it doesn't exist)")

# Reviews per page unless the app asks for another size, and the most it can ask for.
PAGE_SIZE = 10
MAX_PAGE_SIZE = 50


@router.get("/{product_id:int}/reviews", responses={404: error_response("No product with this ID")})
def list_reviews(
    product_id: int,
    reviews: Reviews,
    limit: Annotated[
        int, Query(ge=1, le=MAX_PAGE_SIZE, description="Reviews per page")
    ] = PAGE_SIZE,
    offset: Annotated[int, Query(ge=0, le=100_000, description="Reviews to skip, for paging")] = 0,
) -> ReviewPage:
    """A product's reviews, newest first, 10 at a time. No sign-in needed.

    For the next page, ask again with offset increased by limit; there are more while
    offset + len(items) < total. A product with no reviews gives {"items": [], "total": 0, ...}.
    """
    page = reviews.list_for_product(product_id, limit=limit, offset=offset)
    if page is None:
        raise ApiError(404, "product_not_found", "Product not found")
    return page


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


@router.get("/{product_id:int}/reviews/me", responses={401: _NOT_SIGNED_IN, 404: _NO_REVIEW})
def get_my_review(product_id: int, user: CurrentUser, reviews: Reviews) -> ReviewRead:
    """The signed-in user's review of a product, e.g. to fill in the form for editing it.

    404 with code review_not_found if they haven't reviewed it yet.
    """
    review = reviews.get_mine(product_id, user.id)
    if review is None:
        raise ApiError(404, "review_not_found", "You haven't reviewed this product")
    return review


@router.delete(
    "/{product_id:int}/reviews/me",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: _NOT_SIGNED_IN, 404: _NO_REVIEW},
)
def remove_my_review(product_id: int, user: CurrentUser, reviews: Reviews) -> Response:
    """Remove the signed-in user's review of a product.

    204 (no body) when removed; 404 with code review_not_found if they hadn't reviewed it.
    """
    if not reviews.delete_mine(product_id, user.id):
        raise ApiError(404, "review_not_found", "You haven't reviewed this product")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
