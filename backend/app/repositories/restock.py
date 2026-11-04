from collections import defaultdict
from typing import Annotated, Any, Literal
from uuid import UUID

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.core.restock import HISTORY_DAYS, RECENT_DAYS, StockEvent
from app.schemas.restock import RestockRequestRead, RestockSummary

# A product needs at least this many views and scans in 30 days to count as popular, so a store
# with little activity doesn't call everything popular.
MIN_POPULAR_INTEREST = 5
# The share of a store's viewed or scanned products that count as popular (the top 10%).
POPULAR_PERCENTILE = 0.9

_PRODUCT_KEYS = ("id", "barcode", "name", "size", "image_url")

# Each product's stock at the store and its reorder point there (its own, else the store's).
_STOCK = """
SELECT ps.product_id, ps.in_stock, ps.quantity, ps.aisle,
    COALESCE(rp.reorder_point, s.default_reorder_point) AS reorder_point,
    rp.reorder_point IS NULL AS reorder_point_is_default,
    CASE WHEN ps.in_stock THEN 'low' ELSE 'out' END AS status
FROM product_stock AS ps
JOIN store_locations AS s ON s.id = ps.store_id
LEFT JOIN reorder_points AS rp ON rp.product_id = ps.product_id AND rp.store_id = ps.store_id
WHERE ps.store_id = %(store_id)s
"""

# Out of stock, or in stock at or below the reorder point (an unknown quantity is never low).
_NEEDS_RESTOCK = (
    "(NOT ps.in_stock OR ps.quantity <= COALESCE(rp.reorder_point, s.default_reorder_point))"
)

# Low and out items with their views and scans, most urgent first. A product is popular when
# its interest is in the store's top 10% and at least MIN_POPULAR_INTEREST.
_ITEMS = f"""
WITH interest AS (
    SELECT product_id,
        COALESCE(sum(views) FILTER (WHERE day > CURRENT_DATE - {RECENT_DAYS}), 0) AS views_30d,
        COALESCE(sum(scans) FILTER (WHERE day > CURRENT_DATE - {RECENT_DAYS}), 0) AS scans_30d,
        sum(views + scans) FILTER (WHERE day <= CURRENT_DATE - {RECENT_DAYS}) AS before_30d
    FROM product_activity
    WHERE store_id = %(store_id)s AND day > CURRENT_DATE - {2 * RECENT_DAYS}
    GROUP BY product_id
),
threshold AS (
    SELECT GREATEST(
        percentile_cont({POPULAR_PERCENTILE}) WITHIN GROUP (ORDER BY views_30d + scans_30d),
        {MIN_POPULAR_INTEREST}
    ) AS popular_at
    FROM interest WHERE views_30d + scans_30d > 0
),
items AS ({_STOCK} AND {_NEEDS_RESTOCK})
SELECT i.*, p.barcode, p.name, p.size, p.image_url,
    COALESCE(a.views_30d, 0) AS views_30d, COALESCE(a.scans_30d, 0) AS scans_30d,
    a.before_30d,
    COALESCE(a.views_30d + a.scans_30d >= t.popular_at, FALSE) AS popular
FROM items AS i
JOIN products AS p ON p.id = i.product_id
LEFT JOIN interest AS a ON a.product_id = i.product_id
CROSS JOIN threshold AS t
WHERE %(status)s = 'all' OR i.status = %(status)s
ORDER BY i.status = 'out' DESC, COALESCE(a.views_30d + a.scans_30d, 0) DESC, lower(p.name), p.id
LIMIT %(limit)s OFFSET %(offset)s
"""

# A request with its product (columns product__*) and the requester's email.
_REQUEST_COLUMNS = """
r.id, r.quantity, r.note, r.status, r.requested_at, r.closed_at, u.email AS requested_by,
p.id AS product__id, p.barcode AS product__barcode, p.name AS product__name,
p.size AS product__size, p.image_url AS product__image_url
"""
_REQUEST_FROM = """
FROM restock_requests AS r
JOIN products AS p ON p.id = r.product_id
LEFT JOIN users AS u ON u.id = r.requested_by
"""
_REQUESTS = f"SELECT {_REQUEST_COLUMNS} {_REQUEST_FROM}"


def _request(row: dict[str, Any]) -> RestockRequestRead:
    product = {key: row.pop(f"product__{key}") for key in _PRODUCT_KEYS}
    return RestockRequestRead.model_validate({**row, "product": product})


class RestockRepository:
    """Restock alert queries (migration 020), run on one request's connection."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def summary(self, store_id: int) -> RestockSummary:
        row = self._connection.execute(
            f"""
            SELECT
                count(*) FILTER (WHERE NOT ps.in_stock),
                count(*) FILTER (WHERE ps.in_stock),
                (SELECT count(*) FROM restock_requests
                    WHERE store_id = %(store_id)s AND status = 'open'),
                (SELECT default_reorder_point FROM store_locations WHERE id = %(store_id)s)
            FROM product_stock AS ps
            JOIN store_locations AS s ON s.id = ps.store_id
            LEFT JOIN reorder_points AS rp
                ON rp.product_id = ps.product_id AND rp.store_id = ps.store_id
            WHERE ps.store_id = %(store_id)s AND {_NEEDS_RESTOCK}
            """,
            {"store_id": store_id},
        ).fetchone()
        out, low, open_requests, default_reorder_point = row
        return RestockSummary(
            out=out,
            low=low,
            open_requests=open_requests,
            default_reorder_point=default_reorder_point,
        )

    def items(
        self,
        store_id: int,
        status: Literal["all", "out", "low"] = "all",
        limit: int = 20,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """Low and out products at the store, most urgent first: out before low, then most
        viewed and scanned. Rows of stock, reorder point, product, and interest."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                _ITEMS,
                {"store_id": store_id, "status": status, "limit": limit, "offset": offset},
            )
            rows = cursor.fetchall()
        for row in rows:
            product = {key: row.pop(key) for key in _PRODUCT_KEYS if key != "id"}
            row["product"] = {"id": row["product_id"], **product}
        return rows

    def history(self, store_id: int, product_ids: list[int]) -> dict[int, list[StockEvent]]:
        """Each product's stock events at the store over the last HISTORY_DAYS, oldest first,
        starting with the last one before then (the state the window starts in)."""
        if not product_ids:
            return {}
        rows = self._connection.execute(
            f"""
            SELECT product_id, changed_at, in_stock, quantity FROM (
                SELECT e.*, row_number() OVER (
                    PARTITION BY product_id, changed_at < NOW() - INTERVAL '{HISTORY_DAYS} days'
                    ORDER BY changed_at DESC, id DESC
                ) AS newest_before
                FROM stock_events AS e
                WHERE store_id = %s AND product_id = ANY(%s)
            ) AS e
            WHERE changed_at >= NOW() - INTERVAL '{HISTORY_DAYS} days' OR newest_before = 1
            ORDER BY product_id, changed_at, id
            """,
            (store_id, product_ids),
        ).fetchall()
        events: dict[int, list[StockEvent]] = defaultdict(list)
        for product_id, changed_at, in_stock, quantity in rows:
            events[product_id].append(StockEvent(changed_at, in_stock, quantity))
        return events

    def last_requests(self, store_id: int, product_ids: list[int]) -> dict[int, RestockRequestRead]:
        """The newest request for each of these products at the store, open or not."""
        if not product_ids:
            return {}
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"SELECT DISTINCT ON (r.product_id) {_REQUEST_COLUMNS} {_REQUEST_FROM} "
                "WHERE r.store_id = %s AND r.product_id = ANY(%s) "
                "ORDER BY r.product_id, r.requested_at DESC, r.id DESC",
                (store_id, product_ids),
            )
            rows = cursor.fetchall()
        return {row["product__id"]: _request(row) for row in rows}

    def requests(
        self, store_id: int, open_only: bool, limit: int = 20, offset: int = 0
    ) -> list[RestockRequestRead]:
        """The store's requests, newest first."""
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                f"{_REQUESTS} WHERE r.store_id = %s AND (NOT %s OR r.status = 'open') "
                "ORDER BY r.requested_at DESC, r.id DESC LIMIT %s OFFSET %s",
                (store_id, open_only, limit, offset),
            )
            return [_request(row) for row in cursor.fetchall()]

    def get_request(self, request_id: int) -> RestockRequestRead:
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(f"{_REQUESTS} WHERE r.id = %s", (request_id,))
            row = cursor.fetchone()
        assert row is not None
        return _request(row)

    def create_request(
        self, store_id: int, product_id: int, quantity: int, note: str | None, user_id: UUID
    ) -> RestockRequestRead:
        """Raises psycopg.errors.UniqueViolation if one is already open for this product."""
        (request_id,) = self._connection.execute(
            "INSERT INTO restock_requests (store_id, product_id, quantity, note, requested_by) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (store_id, product_id, quantity, note, user_id),
        ).fetchone()
        return self.get_request(request_id)

    def cancel_open_request(self, store_id: int, product_id: int) -> RestockRequestRead | None:
        """Cancel the product's open request at the store; None if it has none."""
        row = self._connection.execute(
            "UPDATE restock_requests SET status = 'cancelled', closed_at = NOW() "
            "WHERE store_id = %s AND product_id = %s AND status = 'open' RETURNING id",
            (store_id, product_id),
        ).fetchone()
        return self.get_request(row[0]) if row else None

    def reorder_point(self, store_id: int, product_id: int) -> tuple[int, bool]:
        """The product's reorder point at the store, and whether it's the store's default."""
        row = self._connection.execute(
            "SELECT COALESCE(rp.reorder_point, s.default_reorder_point), rp.reorder_point IS NULL "
            "FROM store_locations AS s LEFT JOIN reorder_points AS rp "
            "ON rp.store_id = s.id AND rp.product_id = %s WHERE s.id = %s",
            (product_id, store_id),
        ).fetchone()
        return row[0], row[1]

    def above_reorder_point(self, store_id: int, product_id: int) -> bool:
        """Whether the product is in stock here with a quantity known to be above its reorder
        point, i.e. not low."""
        row = self._connection.execute(
            f"SELECT ps.in_stock AND ps.quantity IS NOT NULL AND NOT {_NEEDS_RESTOCK} "
            "FROM product_stock AS ps JOIN store_locations AS s ON s.id = ps.store_id "
            "LEFT JOIN reorder_points AS rp "
            "ON rp.product_id = ps.product_id AND rp.store_id = ps.store_id "
            "WHERE ps.store_id = %s AND ps.product_id = %s",
            (store_id, product_id),
        ).fetchone()
        return bool(row and row[0])

    def set_reorder_point(self, store_id: int, product_id: int, value: int | None) -> None:
        """Set the product's own reorder point at the store, or remove it (None)."""
        if value is None:
            self._connection.execute(
                "DELETE FROM reorder_points WHERE store_id = %s AND product_id = %s",
                (store_id, product_id),
            )
        else:
            self._connection.execute(
                "INSERT INTO reorder_points (store_id, product_id, reorder_point) "
                "VALUES (%s, %s, %s) ON CONFLICT (product_id, store_id) "
                "DO UPDATE SET reorder_point = EXCLUDED.reorder_point",
                (store_id, product_id, value),
            )

    def set_default_reorder_point(self, store_id: int, value: int) -> None:
        self._connection.execute(
            "UPDATE store_locations SET default_reorder_point = %s WHERE id = %s",
            (value, store_id),
        )

    def record_activity(self, product_id: int, store_id: int | None, kind: str) -> None:
        """Count one view or scan for today."""
        column = "views" if kind == "view" else "scans"
        # column is one of the two constants above.
        self._connection.execute(
            f"INSERT INTO product_activity (product_id, store_id, {column}) VALUES (%s, %s, 1) "
            f"ON CONFLICT (product_id, store_id, day) "
            f"DO UPDATE SET {column} = product_activity.{column} + 1",
            (product_id, store_id),
        )


def get_restock_repository(db: DbConnection) -> RestockRepository:
    return RestockRepository(db)


# Use as a route parameter: def list_items(restock: Restock) -> ...
Restock = Annotated[RestockRepository, Depends(get_restock_repository)]
