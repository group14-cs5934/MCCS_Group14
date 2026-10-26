"""Save cleaned products to the database, one product per barcode (T063).

Importing a product that's already stored updates it instead of adding a second one. "Already
stored" means the same source ID from the same source, or the same barcode, counting forms that
differ only in leading zeros (012000001291 and 0012000001291 are one product). A product someone
added by hand with that barcode is linked to the source and updated too.

Fields the source leaves empty keep their stored value, so a sync never wipes out a description,
photo, or category. A new price is only recorded when it differs from the current one, so
re-importing doesn't fill the price history with copies.

Fields an admin set (products.admin_fields, T089) keep the admin's value too, so the next sync
doesn't undo an edit; "price" there means the source's price isn't recorded.
"""

import logging
import re
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from app.ingest.transform import CleanProduct
from app.repositories.products import same_barcode_forms

logger = logging.getLogger("app.ingest")


class LoadResult(StrEnum):
    INSERTED = "inserted"  # a new product
    UPDATED = "updated"  # an existing product whose details or price changed
    UNCHANGED = "unchanged"  # an existing product, same as before (only its sync time changed)


# Product columns the source fills in, compared to tell UPDATED from UNCHANGED.
_FIELDS = ("barcode", "name", "description", "size", "image_url", "category_id")

# The source's match wins over a barcode match, and an exact barcode over another form of it.
_FIND = """
SELECT id, barcode, name, description, size, image_url, category_id, admin_fields
FROM products
WHERE (source = %(source)s AND source_id = %(source_id)s) OR barcode = ANY(%(forms)s)
ORDER BY (source = %(source)s AND source_id = %(source_id)s) IS TRUE DESC,
         barcode = %(barcode)s DESC, id
LIMIT 1
FOR UPDATE
"""

_INSERT = """
INSERT INTO products (barcode, name, description, size, image_url, category_id,
                      source, source_id, last_synced_at, raw_payload)
VALUES (%(barcode)s, %(name)s, %(description)s, %(size)s, %(image_url)s, %(category_id)s,
        %(source)s, %(source_id)s, %(synced_at)s, %(raw)s)
RETURNING id
"""

_UPDATE = """
UPDATE products SET
    barcode = %(barcode)s, name = %(name)s, description = %(description)s, size = %(size)s,
    image_url = %(image_url)s, category_id = %(category_id)s,
    source = %(source)s, source_id = %(source_id)s, last_synced_at = %(synced_at)s,
    raw_payload = %(raw)s,
    updated_at = CASE WHEN %(changed)s THEN NOW() ELSE updated_at END
WHERE id = %(id)s
"""

_CURRENT_PRICE = """
SELECT amount FROM prices WHERE product_id = %s ORDER BY observed_at DESC, id DESC LIMIT 1
"""


def slugify(name: str) -> str:
    """Name as a category slug, e.g. "Cereal & Granola" -> "cereal-granola"."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def category_id(connection: psycopg.Connection, name: str) -> int:
    """The ID of the category with this name's slug, added if it doesn't exist yet."""
    (found,) = connection.execute(
        """
        INSERT INTO categories (name, slug) VALUES (%s, %s)
        ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug  -- no-op, so RETURNING
        RETURNING id                                           -- gives the existing id
        """,
        (name, slugify(name)),
    ).fetchone()
    return found


def upsert_product(
    connection: psycopg.Connection, product: CleanProduct, synced_at: datetime
) -> tuple[int, LoadResult]:
    """Insert the product, or update the one already stored; return its ID and what happened.

    Runs in the caller's transaction.
    """
    category = category_id(connection, product.category) if product.category else None
    params: dict[str, Any] = {
        "barcode": product.barcode,
        "forms": same_barcode_forms(product.barcode),
        "name": product.name,
        "description": product.description,
        "size": product.size,
        "image_url": product.image_url,
        "category_id": category,
        "source": product.source,
        "source_id": product.source_id,
        "synced_at": synced_at,
        "raw": Jsonb(product.raw),
    }

    with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
        existing = cursor.execute(_FIND, params).fetchone()

    if existing is None:
        (product_id,) = connection.execute(_INSERT, params).fetchone()
        _record_price(connection, product_id, product.price, product.source, synced_at)
        return product_id, LoadResult.INSERTED

    # Keep stored values the source doesn't have (it never clears a field), and every value an
    # admin set (T089).
    admin_fields = set(existing["admin_fields"])
    for column in _FIELDS:
        if column in admin_fields or (column != "barcode" and params[column] is None):
            params[column] = existing[column]
    changed = any(params[column] != existing[column] for column in _FIELDS)
    connection.execute(_UPDATE, {**params, "id": existing["id"], "changed": changed})
    price = None if "price" in admin_fields else product.price
    price_changed = _record_price(connection, existing["id"], price, product.source, synced_at)
    return existing["id"], (
        LoadResult.UPDATED if changed or price_changed else LoadResult.UNCHANGED
    )


def _record_price(
    connection: psycopg.Connection,
    product_id: int,
    amount: Decimal | None,
    source: str,
    observed_at: datetime,
) -> bool:
    """Add `amount` as the product's current price unless it already is; True if added."""
    if amount is None:
        return False
    current = connection.execute(_CURRENT_PRICE, (product_id,)).fetchone()
    if current is not None and current[0] == amount:
        return False
    connection.execute(
        "INSERT INTO prices (product_id, amount, source, observed_at) VALUES (%s, %s, %s, %s)",
        (product_id, amount, source, observed_at),
    )
    return True


def load_products(
    connection: psycopg.Connection,
    products: list[CleanProduct],
    synced_at: datetime,
    errors: list[str] | None = None,
) -> dict[str, int]:
    """Upsert each product in its own savepoint, so a database error on one (logged, and added
    to `errors` if given) doesn't stop the rest. Returns how many were inserted, updated,
    unchanged, and failed. The caller commits."""
    counts = {result.value: 0 for result in LoadResult} | {"failed": 0}
    for product in products:
        try:
            with connection.transaction():
                _, result = upsert_product(connection, product, synced_at)
        except psycopg.Error as exc:
            counts["failed"] += 1
            message = f"Couldn't save {product.barcode} {product.name}: {exc}"
            logger.error("%s", message)
            if errors is not None:
                errors.append(message)
            continue
        counts[result.value] += 1
    return counts
