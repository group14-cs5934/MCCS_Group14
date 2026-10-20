"""Product ratings (US08): a signed-in user rates a product 1 to 5 stars.

Each user has one rating per product; rating it again changes the stars. The average rating
comes from T054.
"""

from fastapi import APIRouter

from app.core.auth import CurrentUser
from app.core.errors import ApiError, error_response
from app.repositories import Ratings
from app.schemas import RatingCreate, RatingRead

router = APIRouter(
    prefix="/products",
    tags=["ratings"],
    responses={
        401: error_response("Missing, invalid, or expired token"),
        422: error_response("Invalid request; details lists each problem"),
    },
)


@router.post(
    "/{product_id:int}/ratings", responses={404: error_response("No product with this ID")}
)
def rate_product(
    product_id: int, rating: RatingCreate, user: CurrentUser, ratings: Ratings
) -> RatingRead:
    """Save the signed-in user's rating of a product, 1 to 5 whole stars.

    Rating a product you already rated changes your stars. Anything outside 1-5 (e.g. 0 or 6),
    or not a whole number, is a 422.
    """
    saved = ratings.save(product_id, user.id, rating.stars)
    if saved is None:
        raise ApiError(404, "product_not_found", "Product not found")
    return saved


@router.get(
    "/{product_id:int}/ratings/me",
    responses={404: error_response("You haven't rated this product (or it doesn't exist)")},
)
def get_my_rating(product_id: int, user: CurrentUser, ratings: Ratings) -> RatingRead:
    """The signed-in user's rating of a product, e.g. to show their stars when the page opens.

    404 with code rating_not_found if they haven't rated it yet.
    """
    rating = ratings.get(product_id, user.id)
    if rating is None:
        raise ApiError(404, "rating_not_found", "You haven't rated this product")
    return rating
