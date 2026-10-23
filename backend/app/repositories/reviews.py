from typing import Annotated, Any
from uuid import UUID

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas import ReviewPage, ReviewRead
from app.schemas.review import author_name

# products.id is a Postgres INTEGER; larger IDs can't exist, and querying one raises an error.
_MAX_ID = 2**31 - 1

# A review with its author's email (shortened before it leaves the API) and their own rating of
# the product, if they rated it.
_REVIEW_QUERY = """
SELECT
    r.id, r.product_id, r.title, r.body, r.created_at, r.updated_at,
    u.email AS author_email,
    ra.stars
FROM reviews AS r
JOIN users AS u ON u.id = r.user_id
LEFT JOIN ratings AS ra ON ra.product_id = r.product_id AND ra.user_id = r.user_id
"""

# Adds the user's review, or replaces its title and text if they already reviewed the product
# (one review per user per product, migration 005). Selecting from products means nothing is
# inserted, and no row comes back, if the product doesn't exist.
_SAVE = """
INSERT INTO reviews (product_id, user_id, title, body)
SELECT id, %(user_id)s, %(title)s, %(body)s FROM products WHERE id = %(product_id)s
ON CONFLICT (product_id, user_id)
DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, updated_at = NOW()
RETURNING id
"""

# How many reviews a product has. Starting from products means an unknown product gives no row.
_COUNT = """
SELECT count(r.id) FROM products AS p
LEFT JOIN reviews AS r ON r.product_id = p.id
WHERE p.id = %s
GROUP BY p.id
"""

# Newest first; the ID breaks ties so paging never skips or repeats a review. Uses the
# reviews_product_newest_idx index from migration 005.
_PAGE = "WHERE r.product_id = %s ORDER BY r.created_at DESC, r.id DESC LIMIT %s OFFSET %s"


def _to_review(row: dict[str, Any]) -> ReviewRead:
    return ReviewRead.model_validate({**row, "author": author_name(row.pop("author_email"))})


class ReviewRepository:
    """Review queries, run on one request's connection."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def save(
        self, product_id: int, user_id: UUID, title: str | None, body: str
    ) -> ReviewRead | None:
        """Store the user's review of the product, replacing any earlier one. None if there's no
        product with this ID."""
        if not 0 < product_id <= _MAX_ID:
            return None
        params = {"product_id": product_id, "user_id": user_id, "title": title, "body": body}
        row = self._connection.execute(_SAVE, params).fetchone()
        return self._fetch_one("WHERE r.id = %s", (row[0],)) if row is not None else None

    def list_for_product(self, product_id: int, limit: int, offset: int) -> ReviewPage | None:
        """A page of the product's reviews, newest first, with the total count. None if there's
        no product with this ID."""
        if not 0 < product_id <= _MAX_ID:
            return None
        row = self._connection.execute(_COUNT, (product_id,)).fetchone()
        if row is None:
            return None
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_REVIEW_QUERY + _PAGE, (product_id, limit, offset))
            items = [_to_review(row) for row in cursor.fetchall()]
        return ReviewPage(items=items, total=row[0], limit=limit, offset=offset)

    def _fetch_one(self, where: str, params: tuple[Any, ...]) -> ReviewRead | None:
        # `where` is always a constant from this class; values only ever go in `params`.
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_REVIEW_QUERY + where, params)
            row = cursor.fetchone()
        return _to_review(row) if row is not None else None


def get_review_repository(db: DbConnection) -> ReviewRepository:
    return ReviewRepository(db)


# Use as a route parameter: def post_review(reviews: Reviews) -> ...
Reviews = Annotated[ReviewRepository, Depends(get_review_repository)]
