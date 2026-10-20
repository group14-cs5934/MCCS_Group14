from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas import RatingRead, RatingSummary

# products.id is a Postgres INTEGER; larger IDs can't exist, and querying one raises an error.
_MAX_ID = 2**31 - 1

_COLUMNS = "product_id, stars, created_at, updated_at"

# Adds the user's rating, or changes the stars if they already rated the product (one rating per
# user per product, migration 005). Selecting from products means nothing is inserted, and no
# row comes back, if the product doesn't exist.
_SAVE = f"""
INSERT INTO ratings (product_id, user_id, stars)
SELECT id, %(user_id)s, %(stars)s FROM products WHERE id = %(product_id)s
ON CONFLICT (product_id, user_id)
DO UPDATE SET stars = EXCLUDED.stars, updated_at = NOW()
RETURNING {_COLUMNS}
"""


# A product's average and count. Starting from products means an unknown product gives no row,
# while a product with no ratings gives count 0 and a NULL average. The (product_id, user_id)
# unique index from migration 005 finds a product's ratings.
_SUMMARY = """
SELECT p.id AS product_id, round(avg(r.stars), 2) AS average, count(r.stars) AS count
FROM products AS p
LEFT JOIN ratings AS r ON r.product_id = p.id
WHERE p.id = %(product_id)s
GROUP BY p.id
"""


class RatingRepository:
    """Rating queries, run on one request's connection."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def save(self, product_id: int, user_id: UUID, stars: int) -> RatingRead | None:
        """Store the user's rating of the product, replacing any earlier one. None if there's no
        product with this ID."""
        if not 0 < product_id <= _MAX_ID:
            return None
        params = {"product_id": product_id, "user_id": user_id, "stars": stars}
        return self._fetch_one(_SAVE, params)

    def get(self, product_id: int, user_id: UUID) -> RatingRead | None:
        """The user's rating of the product, or None if they haven't rated it."""
        if not 0 < product_id <= _MAX_ID:
            return None
        return self._fetch_one(
            f"SELECT {_COLUMNS} FROM ratings WHERE product_id = %(product_id)s "
            "AND user_id = %(user_id)s",
            {"product_id": product_id, "user_id": user_id},
        )

    def summary(self, product_id: int) -> RatingSummary | None:
        """The product's average rating and number of ratings, or None if there's no product
        with this ID. A product nobody has rated has count 0 and average None."""
        if not 0 < product_id <= _MAX_ID:
            return None
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_SUMMARY, {"product_id": product_id})
            row = cursor.fetchone()
        return RatingSummary.model_validate(row) if row is not None else None

    def _fetch_one(self, query: str, params: dict) -> RatingRead | None:
        # `query` is always a constant from this module; values only ever go in `params`.
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(query, params)
            row = cursor.fetchone()
        return RatingRead.model_validate(row) if row is not None else None


def get_rating_repository(db: DbConnection) -> RatingRepository:
    return RatingRepository(db)


# Use as a route parameter: def rate(ratings: Ratings) -> ...
Ratings = Annotated[RatingRepository, Depends(get_rating_repository)]
