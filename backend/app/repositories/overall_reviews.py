from typing import Annotated

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas import OverallReviewRead

# products.id is a Postgres INTEGER; larger IDs can't exist, and querying one raises an error.
_MAX_ID = 2**31 - 1

# Starting from products tells "no such product" (no row) from "no overall review yet" (a row
# with a NULL overall_review).
_OVERALL_REVIEW = """
SELECT p.id AS product_id, s.overall_review, s.review_count, s.generated_at
FROM products AS p
LEFT JOIN agent_review_summaries AS s ON s.product_id = p.id
WHERE p.id = %(product_id)s
"""

# Uses the (product_id, source) primary key from migration 022.
_SOURCES = """
SELECT source, average_stars::float AS average_stars, review_count
FROM agent_source_ratings
WHERE product_id = %(product_id)s
ORDER BY review_count DESC NULLS LAST, source
"""


class OverallReviewRepository:
    """Reads the review agent's overall reviews (written by jobs/product-monitor)."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def get(self, product_id: int) -> tuple[bool, OverallReviewRead | None]:
        """Whether the product exists, and its overall review (None if it has none yet)."""
        if not 0 < product_id <= _MAX_ID:
            return False, None
        params = {"product_id": product_id}
        with self._connection.cursor(row_factory=dict_row) as cursor:
            row = cursor.execute(_OVERALL_REVIEW, params).fetchone()
            if row is None or row["overall_review"] is None:
                return row is not None, None
            sources = cursor.execute(_SOURCES, params).fetchall()
        return True, OverallReviewRead.model_validate({**row, "sources": sources})


def get_overall_review_repository(db: DbConnection) -> OverallReviewRepository:
    return OverallReviewRepository(db)


# Use as a route parameter: def show(overall_reviews: OverallReviews) -> ...
OverallReviews = Annotated[OverallReviewRepository, Depends(get_overall_review_repository)]
