"""Source columns on products from migration 007 (skipped without TEST_DATABASE_URL).

T046 acceptance: when a product is imported, its source ID and last-synced time are stored. Also
checks that a source ID names only one product per source, that a source ID can't be stored
without its source, and that the API returns the source fields with the product.
"""

from datetime import UTC, datetime

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.core.config import load_settings
from app.main import create_app
from tests.factories import add_product

SYNCED = datetime(2026, 10, 20, 3, 0, tzinfo=UTC)


def mark_imported(
    connection: psycopg.Connection, product_id: int, source: str | None, source_id: str | None
) -> None:
    connection.execute(
        """
        UPDATE products SET source = %s, source_id = %s, last_synced_at = %s, raw_payload = %s
        WHERE id = %s
        """,
        (source, source_id, SYNCED, Jsonb({"ean": source_id}), product_id),
    )


def test_imported_product_keeps_its_source_id_and_sync_time(connection) -> None:
    product_id = add_product(connection)
    mark_imported(connection, product_id, "upcitemdb", "0036000291452")
    connection.commit()

    row = connection.execute(
        "SELECT source, source_id, last_synced_at, raw_payload FROM products WHERE id = %s",
        (product_id,),
    ).fetchone()
    assert row == ("upcitemdb", "0036000291452", SYNCED, {"ean": "0036000291452"})


def test_hand_added_products_leave_the_source_empty(connection) -> None:
    first = add_product(connection)
    second = add_product(connection, barcode="012000001291")  # two products, no source: allowed
    connection.commit()

    rows = connection.execute(
        "SELECT source, source_id, last_synced_at FROM products WHERE id IN (%s, %s)",
        (first, second),
    ).fetchall()
    assert rows == [(None, None, None), (None, None, None)]


def test_a_source_id_names_one_product_per_source(connection) -> None:
    first = add_product(connection)
    second = add_product(connection, barcode="012000001291")
    mark_imported(connection, first, "upcitemdb", "123")
    mark_imported(connection, second, "openfoodfacts", "123")  # another source: fine
    connection.commit()

    with pytest.raises(psycopg.errors.UniqueViolation):
        mark_imported(connection, second, "upcitemdb", "123")


@pytest.mark.parametrize(("source", "source_id"), [("upcitemdb", None), (None, "123")])
def test_source_and_source_id_are_set_together(connection, source, source_id) -> None:
    product_id = add_product(connection)

    with pytest.raises(psycopg.errors.CheckViolation):
        mark_imported(connection, product_id, source, source_id)


def test_api_returns_the_source_fields(db_url, connection) -> None:
    product_id = add_product(connection)
    mark_imported(connection, product_id, "upcitemdb", "0036000291452")
    connection.commit()

    with TestClient(create_app(load_settings(_env_file=None, database_url=db_url))) as client:
        body = client.get(f"/products/{product_id}").json()

    assert body["source"] == "upcitemdb"
    assert body["source_id"] == "0036000291452"
    assert body["last_synced_at"] == "2026-10-20T03:00:00Z"
    assert "raw_payload" not in body  # kept for debugging, never sent to the app
