"""Saving imported products with de-duplication by barcode (T063), needs TEST_DATABASE_URL.

T063 acceptance: when the same product is imported twice, only one record exists and it is
updated.
"""

import logging
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

import psycopg
import pytest

from app.ingest.connectors import RawRecord
from app.ingest.load import LoadResult, load_products, upsert_product
from app.ingest.transform import CleanProduct, transform
from scripts import sync_products
from scripts.seed_dev import SAMPLE_CATALOG_FILE
from tests.factories import add_product

FIRST_SYNC = datetime(2026, 10, 20, 3, 0, tzinfo=UTC)
SECOND_SYNC = datetime(2026, 10, 21, 3, 0, tzinfo=UTC)

ITEM = {
    "ean": "0012000171741",
    "title": "Diet Pepsi Cola Soda- 20 fl oz Bottle",
    "description": "Zero calories.",
    "category": "Beverages > Soda",
    "lowest_recorded_price": 1.59,
    "images": ["https://example.com/pepsi.jpg"],
}


def imported(**changes) -> CleanProduct:
    item = {**ITEM, **changes}
    return transform(RawRecord("upcitemdb", item["ean"], item))


def products(connection: psycopg.Connection) -> list[tuple]:
    return connection.execute(
        """
        SELECT p.barcode, p.name, p.description, c.name, p.source, p.source_id, p.last_synced_at
        FROM products AS p LEFT JOIN categories AS c ON c.id = p.category_id ORDER BY p.id
        """
    ).fetchall()


def prices(connection: psycopg.Connection) -> list[tuple]:
    return connection.execute(
        "SELECT amount, source FROM prices ORDER BY observed_at, id"
    ).fetchall()


def test_new_product_is_inserted_with_its_source_details(connection) -> None:
    product_id, result = upsert_product(connection, imported(), FIRST_SYNC)

    assert result == LoadResult.INSERTED
    assert products(connection) == [
        (
            "012000171741",
            "Diet Pepsi Cola Soda- 20 fl oz Bottle",
            "Zero calories.",
            "Soda",
            "upcitemdb",
            "0012000171741",
            FIRST_SYNC,
        )
    ]
    assert prices(connection) == [(Decimal("1.59"), "upcitemdb")]
    (raw,) = connection.execute(
        "SELECT raw_payload FROM products WHERE id = %s", (product_id,)
    ).fetchone()
    assert raw == ITEM


def test_importing_the_same_product_twice_keeps_one_record_and_updates_it(connection) -> None:
    first_id, _ = upsert_product(connection, imported(), FIRST_SYNC)

    second_id, result = upsert_product(
        connection, imported(title="Diet Pepsi 20 oz", lowest_recorded_price=1.79), SECOND_SYNC
    )

    assert second_id == first_id
    assert result == LoadResult.UPDATED
    rows = products(connection)
    assert len(rows) == 1
    assert (rows[0][1], rows[0][6]) == ("Diet Pepsi 20 oz", SECOND_SYNC)
    assert prices(connection) == [(Decimal("1.59"), "upcitemdb"), (Decimal("1.79"), "upcitemdb")]


def test_reimporting_identical_data_is_unchanged_and_adds_no_price(connection) -> None:
    upsert_product(connection, imported(), FIRST_SYNC)
    (updated_at,) = connection.execute("SELECT updated_at FROM products").fetchone()

    _, result = upsert_product(connection, imported(), SECOND_SYNC)

    assert result == LoadResult.UNCHANGED
    assert len(prices(connection)) == 1
    row = connection.execute("SELECT updated_at, last_synced_at FROM products").fetchone()
    assert row == (updated_at, SECOND_SYNC)  # only the sync time moves


def test_barcode_written_another_way_is_the_same_product(connection) -> None:
    upsert_product(connection, imported(), FIRST_SYNC)  # stored as 012000171741 (UPC-A)

    # Another listing of the same product, keyed by its 14-digit GTIN.
    _, result = upsert_product(connection, imported(ean="00012000171741"), SECOND_SYNC)

    assert result == LoadResult.UPDATED  # its source ID changed
    assert len(products(connection)) == 1


def test_product_added_by_hand_is_linked_to_the_source(connection) -> None:
    hand_added = add_product(connection, barcode="012000171741")

    product_id, result = upsert_product(connection, imported(), FIRST_SYNC)

    assert (product_id, result) == (hand_added, LoadResult.UPDATED)
    assert products(connection)[0][4:6] == ("upcitemdb", "0012000171741")


def test_source_never_clears_a_stored_field(connection) -> None:
    upsert_product(connection, imported(), FIRST_SYNC)

    upsert_product(connection, imported(description="", category="", images=[]), SECOND_SYNC)

    row = connection.execute("SELECT description, image_url, category_id FROM products").fetchone()
    assert row[0] == "Zero calories."
    assert row[1] == "https://example.com/pepsi.jpg"
    assert row[2] is not None


def test_missing_price_keeps_the_last_price(connection) -> None:
    upsert_product(connection, imported(), FIRST_SYNC)

    upsert_product(connection, imported(lowest_recorded_price=0), SECOND_SYNC)

    assert prices(connection) == [(Decimal("1.59"), "upcitemdb")]


def test_one_category_per_name(connection) -> None:
    upsert_product(connection, imported(), FIRST_SYNC)
    upsert_product(
        connection, imported(ean="0012000171864", title="Diet Pepsi 12 Pack"), FIRST_SYNC
    )

    assert connection.execute("SELECT name, slug FROM categories").fetchall() == [("Soda", "soda")]


def test_one_failed_product_doesnt_stop_the_rest(connection, caplog) -> None:
    add_product(connection, barcode="012000171864")
    good = imported()
    # Its barcode belongs to another product, but its source ID points at the first one: saving
    # it would give two products the same barcode, which the database refuses.
    conflicting = replace(imported(), barcode="012000171864", name="Clash")
    later = imported(ean="0012000171956", title="Diet Pepsi 6 Pack")

    with caplog.at_level(logging.ERROR, logger="app.ingest"):
        counts = load_products(connection, [good, conflicting, later], FIRST_SYNC)

    assert counts == {"inserted": 2, "updated": 0, "unchanged": 0, "failed": 1}
    assert "Couldn't save 012000171864 Clash" in caplog.text
    assert len(products(connection)) == 3  # the hand-added one, good, and later


def test_sync_command_saves_the_catalog_and_a_second_run_changes_nothing(
    db_url, connection, caplog
) -> None:
    args = ["--file", str(SAMPLE_CATALOG_FILE)]

    with caplog.at_level(logging.INFO, logger="app.ingest"):
        assert sync_products.main(args, database_url=db_url) == 0
        assert "Saved: 18 new, 0 updated, 0 unchanged, 0 failed" in caplog.text
        caplog.clear()
        assert sync_products.main(args, database_url=db_url) == 0
        assert "Saved: 0 new, 0 updated, 18 unchanged, 0 failed" in caplog.text

    (count,) = connection.execute("SELECT count(*) FROM products").fetchone()
    assert count == 18


def test_dry_run_saves_nothing(db_url, connection) -> None:
    assert (
        sync_products.main(["--dry-run", "--file", str(SAMPLE_CATALOG_FILE)], database_url=db_url)
        == 0
    )

    assert connection.execute("SELECT count(*) FROM products").fetchone() == (0,)


@pytest.fixture(autouse=True)
def _rollback(connection):
    """Tests that call upsert_product directly leave their changes uncommitted."""
    yield
    connection.rollback()
