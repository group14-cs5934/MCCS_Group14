from typing import Annotated, Any

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.core.database import DbConnection
from app.schemas import ProductRead
from app.schemas.product import GTIN_LENGTHS

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


def _same_barcode_forms(barcode: str) -> list[str]:
    """Every length this barcode can be written at by adding or removing leading zeros.

    GS1 pads shorter barcodes with zeros to compare them, so these all name the same product,
    e.g. "012000001291" -> ["012000001291", "0012000001291", "00012000001291"].
    """
    digits = barcode.lstrip("0")
    return [digits.zfill(length) for length in GTIN_LENGTHS if len(digits) <= length]


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
        """The product with this barcode, or None if there isn't one.

        Leading zeros don't change which product a barcode means, so 012000001291 (UPC-A, what
        the app sends) also finds a product stored as 0012000001291 (EAN-13, how many data sources
        write it), and the other way round. An exact match wins if both forms are stored.
        """
        # Stored barcodes are always 8, 12, 13, or 14 ASCII digits, so nothing else can match.
        # Checking first also keeps text Postgres rejects (like a NUL byte) out of the query.
        if not (barcode.isascii() and barcode.isdigit() and len(barcode) in GTIN_LENGTHS):
            return None
        return self._fetch_one(
            "WHERE p.barcode = ANY(%s) ORDER BY p.barcode = %s DESC LIMIT 1",
            (_same_barcode_forms(barcode), barcode),
        )

    def search(
        self, query: str = "", category: str | None = None, limit: int = 20, offset: int = 0
    ) -> list[ProductRead]:
        """Products whose name matches `query`, best match first, and/or that are in the category
        with slug `category` (then sorted by name). Empty if neither is given.

        Small typos still match ("coffe" finds "Ground Coffee"): a product matches when one of
        its words is close enough to the query (pg_trgm word similarity; see migration 003).
        """
        query = query.strip()
        category = (category or "").strip().lower()
        # Postgres rejects text containing NUL, and no name or slug contains one.
        if (not query and not category) or "\x00" in query + category:
            return []

        # Built only from the constants below; values only ever go in `params`.
        conditions = []
        if query:
            conditions.append("%(query)s <%% p.name")
        if category:
            conditions.append("c.slug = %(category)s")
        order = "word_similarity(%(query)s, p.name) DESC, p.name, p.id" if query else "p.name, p.id"
        params = {"query": query, "category": category, "limit": limit, "offset": offset}
        return self._fetch_all(
            f"WHERE {' AND '.join(conditions)} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s",
            params,
        )

    def _fetch_one(self, where: str, params: tuple[Any, ...]) -> ProductRead | None:
        # `where` is always a constant from this class; values only ever go in `params`.
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_PRODUCT_QUERY + where, params)
            row = cursor.fetchone()
        return _to_product(row) if row is not None else None

    def _fetch_all(self, where: str, params: dict[str, Any]) -> list[ProductRead]:
        # `where` is always a constant from this class; values only ever go in `params`.
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(_PRODUCT_QUERY + where, params)
            return [_to_product(row) for row in cursor.fetchall()]


def get_product_repository(db: DbConnection) -> ProductRepository:
    return ProductRepository(db)


# Use as a route parameter: def get_product(product_id: int, products: Products) -> ...
Products = Annotated[ProductRepository, Depends(get_product_repository)]
