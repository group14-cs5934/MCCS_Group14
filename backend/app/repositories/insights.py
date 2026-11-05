from typing import Annotated

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.core.restock import RECENT_DAYS
from app.repositories.shopping import _CARD_COLUMNS, _LATEST_PRICE, _card
from app.schemas.insights import AdminOverview, PopularProduct

# The store's most viewed and scanned products lately, with stock and rating.
_POPULAR = f"""
WITH interest AS (
    SELECT product_id, sum(views + scans) AS interest
    FROM product_activity
    WHERE store_id = %(store_id)s AND day > CURRENT_DATE - {RECENT_DAYS}
    GROUP BY product_id
    HAVING sum(views + scans) > 0
)
SELECT i.interest, ps.in_stock, ps.quantity, ps.aisle,
    COALESCE(ps.in_stock AND ps.quantity <= COALESCE(rp.reorder_point, s.default_reorder_point),
        FALSE) AS low,
    round(avg(r.stars)::numeric, 2)::float AS rating, count(r.id) AS rating_count,
    {_CARD_COLUMNS}
FROM interest AS i
JOIN products AS p ON p.id = i.product_id
{_LATEST_PRICE}
LEFT JOIN product_stock AS ps ON ps.product_id = p.id AND ps.store_id = %(store_id)s
LEFT JOIN store_locations AS s ON s.id = ps.store_id
LEFT JOIN reorder_points AS rp ON rp.product_id = p.id AND rp.store_id = ps.store_id
LEFT JOIN ratings AS r ON r.product_id = p.id
GROUP BY i.interest, ps.in_stock, ps.quantity, ps.aisle, s.default_reorder_point,
    rp.reorder_point, p.id, pr.amount
ORDER BY i.interest DESC, lower(p.name), p.id
LIMIT %(limit)s
"""

_OVERVIEW = """
SELECT
    (SELECT count(*) FROM products) AS products,
    (SELECT count(*) FROM users WHERE deactivated_at IS NULL) AS users,
    (SELECT count(*) FROM users WHERE deactivated_at IS NULL AND role = 'staff') AS staff,
    (SELECT count(*) FROM users WHERE deactivated_at IS NULL AND role = 'admin') AS admins,
    (SELECT count(*) FROM store_locations) AS stores,
    (SELECT count(*) FROM reviews WHERE created_at > NOW() - INTERVAL '24 hours')
        AS reviews_today,
    (SELECT count(*) FROM product_stock WHERE NOT in_stock) AS out_of_stock,
    (SELECT count(*)
     FROM product_stock AS ps
     JOIN store_locations AS s ON s.id = ps.store_id
     LEFT JOIN reorder_points AS rp
        ON rp.product_id = ps.product_id AND rp.store_id = ps.store_id
     WHERE ps.in_stock
        AND ps.quantity <= COALESCE(rp.reorder_point, s.default_reorder_point)) AS low_stock,
    (SELECT count(*) FROM restock_requests WHERE status = 'open') AS open_reorders
"""


class InsightsRepository:
    """Read-only summaries for Home and the admin overview, run on one request's connection."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def popular(self, store_id: int, limit: int) -> list[PopularProduct]:
        """The store's products with the most app views and scans in the last 30 days."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_POPULAR, {"store_id": store_id, "limit": limit})
            rows = cursor.fetchall()
        return [PopularProduct.model_validate({**row, "product": _card(row)}) for row in rows]

    def admin_overview(self) -> AdminOverview:
        with self._connection.cursor(row_factory=dict_row) as cursor:
            row = cursor.execute(_OVERVIEW).fetchone()
        return AdminOverview.model_validate(row)


def get_insights_repository(db: DbConnection) -> InsightsRepository:
    return InsightsRepository(db)


Insights = Annotated[InsightsRepository, Depends(get_insights_repository)]
