"""Helpers that insert rows into a test database (use with the db_url / connection fixtures)."""

from datetime import UTC, datetime
from decimal import Decimal

import psycopg

BARCODE = "036000291452"


def add_product(
    connection: psycopg.Connection, category_slug: str | None = None, barcode: str = BARCODE
) -> int:
    """Insert "Sample Chips" (optionally in a new category with this slug); return its ID."""
    category_id = None
    if category_slug:
        (category_id,) = connection.execute(
            "INSERT INTO categories (name, slug) VALUES ('Snacks', %s) RETURNING id",
            (category_slug,),
        ).fetchone()
    (product_id,) = connection.execute(
        """
        INSERT INTO products (barcode, name, size, image_url, category_id)
        VALUES (%s, 'Sample Chips', '184g', 'https://example.com/chips.jpg', %s)
        RETURNING id
        """,
        (barcode, category_id),
    ).fetchone()
    return product_id


def add_price(connection: psycopg.Connection, product_id: int, amount: str, observed: str) -> None:
    """Record a price for the product, seen on the given ISO date (UTC)."""
    connection.execute(
        "INSERT INTO prices (product_id, amount, observed_at) VALUES (%s, %s, %s)",
        (product_id, Decimal(amount), datetime.fromisoformat(observed).replace(tzinfo=UTC)),
    )
