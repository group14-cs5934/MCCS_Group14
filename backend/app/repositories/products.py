from typing import Annotated, Any

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas import ProductRead

# products.id is a Postgres INTEGER; larger IDs can't exist, and querying one raises an error.
_MAX_ID = 2**31 - 1

# A product with its category and most recent price. Columns of a joined table are aliased
# "<field>__<column>" so _to_product can nest them. Brand stays None until there's a brands
# table to join (products.brand_id has nothing to reference yet).
_PRODUCT_QUERY = """
SELECT
    p.id, p.barcode, p.name, p.description, p.size, p.image_url,
    p.brand_id, p.category_id, p.created_at, p.updated_at,
    c.id AS category__id,
    c.name AS category__name,
    c.slug AS category__slug,
    c.description AS category__description,
    pr.id AS price__id,
    pr.product_id AS price__product_id,
    pr.amount AS price__amount,
    pr.currency AS price__currency,
    pr.source AS price__source,
    pr.observed_at AS price__observed_at
FROM products AS p
LEFT JOIN categories AS c ON c.id = p.category_id
LEFT JOIN LATERAL (
    SELECT id, product_id, amount, currency, source, observed_at
    FROM prices
    WHERE prices.product_id = p.id
    ORDER BY observed_at DESC, id DESC
    LIMIT 1
) AS pr ON TRUE
"""


def _pop_nested(row: dict[str, Any], field: str) -> dict[str, Any] | None:
    """Move the row's "<field>__*" columns into their own dict; None if nothing was joined."""
    prefix = f"{field}__"
    nested = {key.removeprefix(prefix): row.pop(key) for key in list(row) if key.startswith(prefix)}
    return nested if nested["id"] is not None else None


def _to_product(row: dict[str, Any]) -> ProductRead:
    category = _pop_nested(row, "category")
    price = _pop_nested(row, "price")
    return ProductRead.model_validate({**row, "category": category, "price": price})


class ProductRepository:
    """Product queries, run on one request's connection."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._connection = connection

    def get_by_id(self, product_id: int) -> ProductRead | None:
        """The product with this ID, or None if there isn't one."""
        if not 0 < product_id <= _MAX_ID:
            return None
        return self._fetch_one("WHERE p.id = %s", (product_id,))

    def get_by_barcode(self, barcode: str) -> ProductRead | None:
        """The product with this barcode, or None if there isn't one."""
        return self._fetch_one("WHERE p.barcode = %s", (barcode,))

    def _fetch_one(self, where: str, params: tuple[Any, ...]) -> ProductRead | None:
        # `where` is always a constant from this class; values only ever go in `params`.
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_PRODUCT_QUERY + where, params)
            row = cursor.fetchone()
        return _to_product(row) if row is not None else None


def get_product_repository(db: DbConnection) -> ProductRepository:
    return ProductRepository(db)


# Use as a route parameter: def get_product(product_id: int, products: Products) -> ...
Products = Annotated[ProductRepository, Depends(get_product_repository)]
