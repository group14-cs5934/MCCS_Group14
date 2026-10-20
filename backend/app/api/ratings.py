"""Product ratings (US08): a signed-in user rates a product 1 to 5 stars, and anyone can see a
product's average rating and how many people rated it.

Each user has one rating per product; rating it again changes the stars.
"""

from fastapi import APIRouter

from app.core.auth import CurrentUser
from app.core.errors import ApiError, error_response
from app.repositories import Ratings
from app.schemas import RatingCreate, RatingRead, RatingSummary

router = APIRouter(
    prefix="/products",
    tags=["ratings"],
    responses={422: error_response("Invalid request; details lists each problem")},
)

_NOT_SIGNED_IN = error_response("Missing, invalid, or expired token")


@router.get("/{product_id:int}/ratings", responses={404: error_response("No product with this ID")})
def get_rating_summary(product_id: int, ratings: Ratings) -> RatingSummary:
    """A product's average rating and how many users rated it. No sign-in needed.

    For example, ratings of 4 and 2 give {"average": 3.0, "count": 2}. A product nobody has rated
    yet has {"average": null, "count": 0}.
    """
    summary = ratings.summary(product_id)
    if summary is None:
        raise ApiError(404, "product_not_found", "Product not found")
    return summary


@router.post(
    "/{product_id:int}/ratings",
    responses={401: _NOT_SIGNED_IN, 404: error_response("No product with this ID")},
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
    responses={
        401: _NOT_SIGNED_IN,
        404: error_response("You haven't rated this product (or it doesn't exist)"),
    },
)
def get_my_rating(product_id: int, user: CurrentUser, ratings: Ratings) -> RatingRead:
    """The signed-in user's rating of a product, e.g. to show their stars when the page opens.

    404 with code rating_not_found if they haven't rated it yet.
    """
    rating = ratings.get(product_id, user.id)
    if rating is None:
        raise ApiError(404, "rating_not_found", "You haven't rated this product")
    return rating
