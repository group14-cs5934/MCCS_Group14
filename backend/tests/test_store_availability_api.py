"""Store locations and product availability against a real database (needs TEST_DATABASE_URL).

T074 acceptance: when I request availability for a product, I get each store with its in-stock
status. When the product does not exist, a 404 is returned.
"""

from collections.abc import Iterator
from datetime import UTC, datetime

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app
from tests.factories import add_product

UPDATED = datetime(2026, 10, 20, 8, 0, tzinfo=UTC)


@pytest.fixture
def client(db_url: str) -> Iterator[TestClient]:
    with TestClient(create_app(load_settings(_env_file=None, database_url=db_url))) as client:
        yield client


def add_store(
    connection: psycopg.Connection, name: str, slug: str, address=None, hours=None
) -> int:
    (store_id,) = connection.execute(
        "INSERT INTO store_locations (name, slug, address, hours) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        (name, slug, address, hours),
    ).fetchone()
    return store_id


def add_stock(connection, product_id, store_id, in_stock, quantity=None, aisle=None) -> None:
    connection.execute(
        """
        INSERT INTO product_stock (product_id, store_id, in_stock, quantity, aisle, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (product_id, store_id, in_stock, quantity, aisle, UPDATED),
    )


@pytest.fixture
def stores(connection: psycopg.Connection) -> dict[str, int]:
    ids = {
        "lejeune": add_store(
            connection, "Camp Lejeune MCX", "camp-lejeune-mcx", "Bldg. 1231", "Daily 9 AM–9 PM"
        ),
        "new-river": add_store(connection, "New River MCX", "new-river-mcx"),
        "pendleton": add_store(connection, "Camp Pendleton MCX", "camp-pendleton-mcx"),
    }
    connection.commit()
    return ids


def test_locations_lists_every_store_by_name(client, stores) -> None:
    response = client.get("/locations")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": stores["lejeune"],
            "name": "Camp Lejeune MCX",
            "slug": "camp-lejeune-mcx",
            "address": "Bldg. 1231",
            "hours": "Daily 9 AM–9 PM",
        },
        {
            "id": stores["pendleton"],
            "name": "Camp Pendleton MCX",
            "slug": "camp-pendleton-mcx",
            "address": None,
            "hours": None,
        },
        {
            "id": stores["new-river"],
            "name": "New River MCX",
            "slug": "new-river-mcx",
            "address": None,
            "hours": None,
        },
    ]


# T080 acceptance (API side): opening a store shows its address and hours.
def test_one_store_with_its_address_and_hours(client, stores) -> None:
    response = client.get(f"/locations/{stores['lejeune']}")

    assert response.status_code == 200
    assert response.json() == {
        "id": stores["lejeune"],
        "name": "Camp Lejeune MCX",
        "slug": "camp-lejeune-mcx",
        "address": "Bldg. 1231",
        "hours": "Daily 9 AM–9 PM",
    }


@pytest.mark.parametrize("store_id", [999_999, 2**31])
def test_unknown_store_is_404(client, stores, store_id) -> None:
    response = client.get(f"/locations/{store_id}")

    assert response.status_code == 404
    assert response.json()["code"] == "store_not_found"


def test_availability_includes_each_stores_hours(client, connection, stores) -> None:
    product_id = add_product(connection)
    connection.commit()

    rows = client.get(f"/products/{product_id}/availability").json()["stores"]

    hours = {row["store"]["name"]: row["store"]["hours"] for row in rows}
    assert hours["Camp Lejeune MCX"] == "Daily 9 AM–9 PM"
    assert hours["New River MCX"] is None


def test_no_stores_gives_an_empty_list(client, db_url) -> None:
    assert client.get("/locations").json() == []


def test_availability_lists_each_store_with_its_in_stock_status(client, connection, stores) -> None:
    product_id = add_product(connection)
    add_stock(connection, product_id, stores["new-river"], True, quantity=12, aisle="Aisle 7")
    add_stock(connection, product_id, stores["lejeune"], False, quantity=0)
    connection.commit()

    response = client.get(f"/products/{product_id}/availability")

    assert response.status_code == 200
    body = response.json()
    assert body["product_id"] == product_id
    assert [
        (s["store"]["name"], s["in_stock"], s["quantity"], s["aisle"]) for s in body["stores"]
    ] == [
        ("New River MCX", True, 12, "Aisle 7"),  # in stock first
        ("Camp Lejeune MCX", False, 0, None),
        ("Camp Pendleton MCX", False, None, None),  # no record for this store
    ]
    assert body["stores"][0]["updated_at"] == "2026-10-20T08:00:00Z"
    assert body["stores"][2]["updated_at"] is None


def test_another_products_stock_doesnt_count(client, connection, stores) -> None:
    product_id = add_product(connection)
    other_id = add_product(connection, barcode="012000171741")
    add_stock(connection, other_id, stores["lejeune"], True, quantity=3)
    connection.commit()

    body = client.get(f"/products/{product_id}/availability").json()

    assert [s["in_stock"] for s in body["stores"]] == [False, False, False]


def test_product_with_no_stores_has_an_empty_list(client, connection) -> None:
    product_id = add_product(connection)
    connection.commit()

    assert client.get(f"/products/{product_id}/availability").json() == {
        "product_id": product_id,
        "stores": [],
    }


@pytest.mark.parametrize("unknown_id", [999, 2**31])  # 2**31 is past Postgres's INTEGER max
def test_availability_of_an_unknown_product_is_404(client, stores, unknown_id) -> None:
    response = client.get(f"/products/{unknown_id}/availability")

    assert response.status_code == 404
    assert response.json() == {"code": "product_not_found", "message": "Product not found"}


def test_availability_needs_no_sign_in(client, connection, stores) -> None:
    product_id = add_product(connection)
    connection.commit()

    assert client.get(f"/products/{product_id}/availability").status_code == 200
