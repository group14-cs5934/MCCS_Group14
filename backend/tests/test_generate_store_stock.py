"""Simulated per-store stock (T077). Database tests are skipped without TEST_DATABASE_URL.

T077 acceptance: when the generator runs, every product has a stock status at each store, with a
realistic mix of in-stock and out-of-stock.
"""

import logging

import psycopg
import pytest

from scripts import generate_store_stock
from scripts.generate_store_stock import DEMO_STORES, generate, simulated_stock
from tests.factories import add_product

BARCODES = ["036000291452", "012000001291", "012000100109", "012000171741", "012000171864"]


def test_same_product_and_store_always_get_the_same_stock() -> None:
    assert simulated_stock(7, 3) == simulated_stock(7, 3)


def test_seed_changes_the_mix() -> None:
    one = [simulated_stock(product, 1, seed=1) for product in range(1, 51)]
    two = [simulated_stock(product, 1, seed=2) for product in range(1, 51)]

    assert one != two


def test_out_of_stock_has_quantity_zero_and_in_stock_has_some() -> None:
    for product_id in range(1, 300):
        stock = simulated_stock(product_id, 1)
        assert stock.in_stock == (stock.quantity > 0)  # the product_stock table's own rule


def test_a_product_is_in_the_same_aisle_at_every_store() -> None:
    assert len({simulated_stock(42, store).aisle for store in range(1, 9)}) == 1


def test_the_mix_is_realistic_across_a_big_catalog() -> None:
    stock = [simulated_stock(product, store) for product in range(1, 501) for store in range(1, 9)]
    share_in_stock = sum(s.in_stock for s in stock) / len(stock)

    assert 0.7 <= share_in_stock <= 0.95  # mostly in stock, but plenty of gaps
    quantities = [s.quantity for s in stock if s.in_stock]
    assert min(quantities) <= 4 and max(quantities) > 40  # some nearly gone, some plentiful


def test_stores_differ_in_how_often_they_run_out() -> None:
    rates = [
        sum(simulated_stock(product, store).in_stock for product in range(1, 1001)) / 1000
        for store in range(1, 9)
    ]

    assert max(rates) - min(rates) > 0.05


# --- With a database ---


@pytest.fixture
def catalog(connection: psycopg.Connection) -> list[int]:
    product_ids = [add_product(connection, barcode=barcode) for barcode in BARCODES]
    connection.commit()
    return product_ids


def stock_rows(connection: psycopg.Connection) -> list[tuple]:
    connection.commit()
    return connection.execute(
        "SELECT product_id, store_id, in_stock, quantity FROM product_stock ORDER BY 1, 2"
    ).fetchall()


def test_every_product_gets_a_status_at_each_store(connection, catalog) -> None:
    counts = generate(connection)

    rows = stock_rows(connection)
    (stores,) = connection.execute("SELECT count(*) FROM store_locations").fetchone()
    assert stores == len(DEMO_STORES)  # added because there were none
    assert len(rows) == len(catalog) * stores
    assert {(row[0], row[1]) for row in rows} == {
        (product, store)
        for product in catalog
        for (store,) in connection.execute("SELECT id FROM store_locations").fetchall()
    }
    in_stock = sum(row[2] for row in rows)
    assert 0 < in_stock < len(rows)  # a mix, not all one way
    assert counts == {"stores_added": len(DEMO_STORES), "written": len(rows), "in_stock": in_stock}


def test_existing_stores_are_used_as_they_are(connection, catalog) -> None:
    connection.execute(
        "INSERT INTO store_locations (name, slug) VALUES ('Camp Lejeune MCX', 'camp-lejeune-mcx')"
    )

    counts = generate(connection)

    assert counts["stores_added"] == 0
    assert len(stock_rows(connection)) == len(catalog)


def test_running_again_keeps_existing_rows_and_fills_new_products(connection, catalog) -> None:
    generate(connection)
    before = stock_rows(connection)
    connection.execute(
        "UPDATE product_stock SET in_stock = FALSE, quantity = 0 WHERE product_id = %s",
        (catalog[0],),
    )  # an admin marks the first product out of stock everywhere
    new_product = add_product(connection, barcode="012000171956")

    counts = generate(connection)

    after = stock_rows(connection)
    assert counts["written"] == len(DEMO_STORES)  # only the new product's rows
    assert all(not row[2] for row in after if row[0] == catalog[0])  # the admin's change stays
    assert [r for r in after if r[0] not in (catalog[0], new_product)] == [
        r for r in before if r[0] != catalog[0]
    ]


def test_reset_regenerates_every_row(connection, catalog) -> None:
    generate(connection)
    connection.execute("UPDATE product_stock SET in_stock = FALSE, quantity = 0")

    generate(connection, reset=True)

    assert any(row[2] for row in stock_rows(connection))


def test_command_reports_the_mix(db_url, connection, catalog, caplog) -> None:
    with caplog.at_level(logging.INFO, logger="app.ingest"):
        assert generate_store_stock.main([], database_url=db_url) == 0

    assert "Added 8 demo stores" in caplog.text
    assert f"Wrote {len(catalog) * 8} stock rows" in caplog.text
