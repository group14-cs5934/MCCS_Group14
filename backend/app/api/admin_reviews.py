"""Review moderation (US12, T082): admins list reviews, hide or show them, and delete them.

Every route needs a signed-in admin: 401 without a valid token, 403 for anyone else. A hidden
review no longer appears on the product page (GET /products/{id}/reviews leaves it out, and it
doesn't count in the total), but it stays in the database so it can be shown again. Its author can
still see, edit, or remove it through /products/{id}/reviews/me; editing doesn't unhide it.
Hiding a review doesn't change the author's star rating. Each change is recorded in the audit
log (T083).
"""

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.core.auth import AdminUser
from app.core.errors import ApiError, error_response
from app.repositories import AuditLog, Reviews
from app.repositories.audit_log import changed_fields
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
    review_id: int,
    change: ReviewModeration,
    admin: AdminUser,
    reviews: Reviews,
    audit: AuditLog,
) -> AdminReviewRead:
    """Hide a review from the product page ({"hidden": true}) or show it again
    ({"hidden": false}). Returns the review."""
    if not reviews.lock(review_id):
        raise _review_not_found()
    before = reviews.get_for_admin(review_id)
    assert before is not None  # locked above
    review = reviews.set_hidden(review_id, change.hidden, admin_id=admin.id)
    assert review is not None  # found above, in this same transaction
    audit.record(
        admin_id=admin.id,
        admin_email=admin.email,
        action="review.hide" if change.hidden else "review.show",
        target_type="review",
        target_id=review_id,
        changes=changed_fields({"hidden": before.hidden}, {"hidden": review.hidden}),
    )
    return review


@router.delete(
    "/{review_id:int}", status_code=status.HTTP_204_NO_CONTENT, responses={404: _NOT_FOUND}
)
def delete_review(review_id: int, admin: AdminUser, reviews: Reviews, audit: AuditLog) -> Response:
    """Remove a review for good. 204 (no body) when done. To take a review down but keep it,
    hide it instead."""
    before = reviews.get_for_admin(review_id)
    if before is None or not reviews.delete(review_id):
        raise _review_not_found()
    # Keep what was deleted, so the log still shows what the review said and who wrote it.
    deleted = {
        "product_id": before.product_id,
        "author_email": before.author_email,
        "title": before.title,
        "body": before.body,
        "hidden": before.hidden,
    }
    audit.record(
        admin_id=admin.id,
        admin_email=admin.email,
        action="review.delete",
        target_type="review",
        target_id=review_id,
        changes=changed_fields(deleted, {}),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
