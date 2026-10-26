"""Review moderation (US12, T082): admins list reviews, hide or show them, and delete them.

Every route needs a signed-in admin: 401 without a valid token, 403 for anyone else. A hidden
review no longer appears on the product page (GET /products/{id}/reviews leaves it out, and it
doesn't count in the total), but it stays in the database so it can be shown again. Its author can
still see, edit, or remove it through /products/{id}/reviews/me; editing doesn't unhide it.
Hiding a review doesn't change the author's star rating.
"""

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.core.auth import AdminUser
from app.core.errors import ApiError, error_response
from app.repositories import Reviews
from app.schemas import AdminReviewRead, ReviewModeration

MAX_REVIEWS_PER_PAGE = 100

router = APIRouter(
    prefix="/admin/reviews",
    tags=["admin"],
    responses={
        401: error_response("Missing, invalid, or expired token"),
        403: error_response("Not an admin, or the admin's account is deactivated"),
        422: error_response("Invalid request; details lists each problem"),
    },
)

_NOT_FOUND = error_response("No review with this ID")


def _review_not_found() -> ApiError:
    return ApiError(status.HTTP_404_NOT_FOUND, "review_not_found", "Review not found")


@router.get("")
def list_reviews(
    admin: AdminUser,
    reviews: Reviews,
    product_id: Annotated[
        int | None, Query(ge=1, description="Only this product's reviews")
    ] = None,
    hidden: Annotated[
        bool | None, Query(description="true: only hidden reviews; false: only visible ones")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_REVIEWS_PER_PAGE)] = 50,
    offset: Annotated[int, Query(ge=0, le=100_000, description="Reviews to skip, for paging")] = 0,
) -> list[AdminReviewRead]:
    """Every review, newest first, including hidden ones, with the author's email."""
    return reviews.list_all(product_id=product_id, hidden=hidden, limit=limit, offset=offset)


@router.patch("/{review_id:int}", responses={404: _NOT_FOUND})
def moderate_review(
    review_id: int, change: ReviewModeration, admin: AdminUser, reviews: Reviews
) -> AdminReviewRead:
    """Hide a review from the product page ({"hidden": true}) or show it again
    ({"hidden": false}). Returns the review."""
    review = reviews.set_hidden(review_id, change.hidden, admin_id=admin.id)
    if review is None:
        raise _review_not_found()
    return review


@router.delete(
    "/{review_id:int}", status_code=status.HTTP_204_NO_CONTENT, responses={404: _NOT_FOUND}
)
def delete_review(review_id: int, admin: AdminUser, reviews: Reviews) -> Response:
    """Remove a review for good. 204 (no body) when done. To take a review down but keep it,
    hide it instead."""
    if not reviews.delete(review_id):
        raise _review_not_found()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
