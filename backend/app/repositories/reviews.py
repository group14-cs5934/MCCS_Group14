from typing import Annotated, Any
from uuid import UUID

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas import AdminReviewRead, ReviewPage, ReviewRead
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

# The same review for admins (T082): the author's ID and full email, and whether it's hidden.
_ADMIN_REVIEW_QUERY = """
SELECT
    r.id, r.product_id, r.title, r.body, r.created_at, r.updated_at,
    r.user_id, u.email AS author_email, r.hidden_at,
    ra.stars
FROM reviews AS r
JOIN users AS u ON u.id = r.user_id
LEFT JOIN ratings AS ra ON ra.product_id = r.product_id AND ra.user_id = r.user_id
"""

# Adds the user's review, or replaces its title and text if they already reviewed the product
# (one review per user per product, migration 005). Selecting from products means nothing is
# inserted, and no row comes back, if the product doesn't exist. Editing a hidden review leaves
# it hidden (hidden_at isn't touched), so an author can't undo moderation by changing a word.
_SAVE = """
INSERT INTO reviews (product_id, user_id, title, body)
SELECT id, %(user_id)s, %(title)s, %(body)s FROM products WHERE id = %(product_id)s
ON CONFLICT (product_id, user_id)
DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, updated_at = NOW()
RETURNING id
"""

# How many visible reviews a product has (hidden ones don't count, T082). Starting from products
# means an unknown product gives no row.
_COUNT = """
SELECT count(r.id) FROM products AS p
LEFT JOIN reviews AS r ON r.product_id = p.id AND r.hidden_at IS NULL
WHERE p.id = %s
GROUP BY p.id
"""

# Visible reviews, newest first; the ID breaks ties so paging never skips or repeats a review.
# Uses the reviews_product_newest_idx index from migration 005.
_PAGE = (
    "WHERE r.product_id = %s AND r.hidden_at IS NULL "
    "ORDER BY r.created_at DESC, r.id DESC LIMIT %s OFFSET %s"
)

# Hides or shows a review. Hiding one that's already hidden keeps who hid it and when. SET sees
# the row as it was before the update, so hidden_by can check the old hidden_at.
_SET_HIDDEN = """
UPDATE reviews SET
    hidden_by = CASE
        WHEN NOT %(hidden)s THEN NULL
        WHEN hidden_at IS NULL THEN %(admin_id)s
        ELSE hidden_by
    END,
    hidden_at = CASE WHEN %(hidden)s THEN COALESCE(hidden_at, NOW()) END
WHERE id = %(id)s
RETURNING id
"""


def _to_review(row: dict[str, Any]) -> ReviewRead:
    return ReviewRead.model_validate({**row, "author": author_name(row.pop("author_email"))})


def _to_admin_review(row: dict[str, Any]) -> AdminReviewRead:
    return AdminReviewRead.model_validate(
        {
            **row,
            "author": author_name(row["author_email"]),
            "hidden": row["hidden_at"] is not None,
        }
    )


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

    def get_mine(self, product_id: int, user_id: UUID) -> ReviewRead | None:
        """The user's review of the product, or None if they haven't reviewed it. Includes a
        review an admin hid, so its author can still edit or remove it."""
        if not 0 < product_id <= _MAX_ID:
            return None
        return self._fetch_one("WHERE r.product_id = %s AND r.user_id = %s", (product_id, user_id))

    def delete_mine(self, product_id: int, user_id: UUID) -> bool:
        """Remove the user's review of the product. False if they hadn't reviewed it."""
        if not 0 < product_id <= _MAX_ID:
            return False
        cursor = self._connection.execute(
            "DELETE FROM reviews WHERE product_id = %s AND user_id = %s", (product_id, user_id)
        )
        return cursor.rowcount > 0

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

    # --- Moderation (T082) ---

    def list_all(
        self,
        product_id: int | None = None,
        hidden: bool | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[AdminReviewRead]:
        """Every review, newest first, including hidden ones; optionally only one product's, or
        only hidden (hidden=True) or visible (hidden=False) ones."""
        if product_id is not None and not 0 < product_id <= _MAX_ID:
            return []
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                _ADMIN_REVIEW_QUERY
                + "WHERE (%(product_id)s::integer IS NULL OR r.product_id = %(product_id)s) "
                "AND (%(hidden)s::boolean IS NULL OR (r.hidden_at IS NOT NULL) = %(hidden)s) "
                "ORDER BY r.created_at DESC, r.id DESC LIMIT %(limit)s OFFSET %(offset)s",
                {"product_id": product_id, "hidden": hidden, "limit": limit, "offset": offset},
            )
            return [_to_admin_review(row) for row in cursor.fetchall()]

    def get_for_admin(self, review_id: int) -> AdminReviewRead | None:
        """Any review by ID, hidden or not. None if there isn't one."""
        if not 0 < review_id <= _MAX_ID:
            return None
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_ADMIN_REVIEW_QUERY + "WHERE r.id = %s", (review_id,))
            row = cursor.fetchone()
        return _to_admin_review(row) if row is not None else None

    def set_hidden(self, review_id: int, hidden: bool, admin_id: UUID) -> AdminReviewRead | None:
        """Hide the review from the product page (hidden=True), or show it again. None if there's
        no review with this ID."""
        if not 0 < review_id <= _MAX_ID:
            return None
        params = {"id": review_id, "hidden": hidden, "admin_id": admin_id}
        if self._connection.execute(_SET_HIDDEN, params).fetchone() is None:
            return None
        return self.get_for_admin(review_id)

    def delete(self, review_id: int) -> bool:
        """Remove any review for good. False if there's no review with this ID."""
        if not 0 < review_id <= _MAX_ID:
            return False
        cursor = self._connection.execute("DELETE FROM reviews WHERE id = %s", (review_id,))
        return cursor.rowcount > 0

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
