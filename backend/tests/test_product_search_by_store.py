"""Search filtered by store and in-stock status, against a real database (needs
TEST_DATABASE_URL).

T075 acceptance: when I filter by a store and "in stock", only products in stock at that store
are returned.
"""

from collections.abc import Iterator

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app

LEJEUNE, NEW_RIVER = "camp-lejeune-mcx", "new-river-mcx"

# name -> {store slug: in stock?}; a store missing from the dict doesn't carry the product.
CATALOG = {
    "Doritos Nacho Cheese Chips": {LEJEUNE: True, NEW_RIVER: False},
    "Lay's Classic Potato Chips": {LEJEUNE: False, NEW_RIVER: True},
    "Pringles Original Chips": {LEJEUNE: True},
    "Ruffles Cheddar Chips": {},
    "Folgers Classic Roast Coffee": {LEJEUNE: True, NEW_RIVER: True},
}
BARCODES = ["036000291452", "012000001291", "012000100109", "012000171741", "012000171864"]


@pytest.fixture
def client(db_url: str, connection: psycopg.Connection) -> Iterator[TestClient]:
    store_ids = {
        slug: connection.execute(
            "INSERT INTO store_locations (name, slug) VALUES (%s, %s) RETURNING id", (slug, slug)
        ).fetchone()[0]
        for slug in (LEJEUNE, NEW_RIVER)
    }
    for barcode, (name, stock) in zip(BARCODES, CATALOG.items(), strict=True):
        (product_id,) = connection.execute(
            "INSERT INTO products (barcode, name) VALUES (%s, %s) RETURNING id", (barcode, name)
        ).fetchone()
        for slug, in_stock in stock.items():
            connection.execute(
                "INSERT INTO product_stock (product_id, store_id, in_stock) VALUES (%s, %s, %s)",
                (product_id, store_ids[slug], in_stock),
            )
    connection.commit()
    with TestClient(create_app(load_settings(_env_file=None, database_url=db_url))) as client:
        yield client


def names(client: TestClient, **params) -> list[str]:
    response = client.get("/products/search", params=params)
    assert response.status_code == 200
    return sorted(product["name"] for product in response.json())


def test_store_and_in_stock_return_only_products_in_stock_there(client) -> None:
    assert names(client, q="chips", store=LEJEUNE, in_stock="true") == [
        "Doritos Nacho Cheese Chips",
        "Pringles Original Chips",
    ]
    assert names(client, q="chips", store=NEW_RIVER, in_stock="true") == [
        "Lay's Classic Potato Chips"
    ]


def test_store_alone_returns_what_it_carries_in_or_out_of_stock(client) -> None:
    assert names(client, q="chips", store=NEW_RIVER) == [
        "Doritos Nacho Cheese Chips",
        "Lay's Classic Potato Chips",
    ]


def test_in_stock_alone_means_in_stock_at_any_store(client) -> None:
    assert names(client, q="chips", in_stock="true") == [
        "Doritos Nacho Cheese Chips",
        "Lay's Classic Potato Chips",
        "Pringles Original Chips",
    ]


def test_without_store_filters_every_match_is_returned(client) -> None:
    assert len(names(client, q="chips")) == 4


def test_store_filter_works_without_a_query_to_browse(client) -> None:
    assert names(client, store=NEW_RIVER, in_stock="true") == [
        "Folgers Classic Roast Coffee",
        "Lay's Classic Potato Chips",
    ]


def test_unknown_store_gives_no_results(client) -> None:
    assert names(client, q="chips", store="camp-nowhere-mcx") == []


def test_store_slug_is_case_insensitive(client) -> None:
    assert names(client, q="chips", store="NEW-RIVER-MCX", in_stock="true") == [
        "Lay's Classic Potato Chips"
    ]


def test_in_stock_false_doesnt_filter(client) -> None:
    assert names(client, q="chips", store=NEW_RIVER, in_stock="false") == names(
        client, q="chips", store=NEW_RIVER
    )


def test_in_stock_that_isnt_a_boolean_is_422(client) -> None:
    assert (
        client.get("/products/search", params={"q": "chips", "in_stock": "maybe"}).status_code
        == 422
    )
