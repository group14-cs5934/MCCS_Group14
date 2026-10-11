from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app
from app.repositories import ProductRepository, Products
from app.schemas import ProductRead

BARCODE = "036000291452"


@pytest.fixture
def connection(db_url: str) -> Iterator[psycopg.Connection]:
    with psycopg.connect(db_url) as connection:
        yield connection


def add_product(connection: psycopg.Connection, category_slug: str | None = None) -> int:
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
        (BARCODE, category_id),
    ).fetchone()
    return product_id


def add_price(connection: psycopg.Connection, product_id: int, amount: str, observed: str) -> None:
    connection.execute(
        "INSERT INTO prices (product_id, amount, observed_at) VALUES (%s, %s, %s)",
        (product_id, Decimal(amount), datetime.fromisoformat(observed).replace(tzinfo=UTC)),
    )


def test_get_by_id_returns_the_product_with_category_and_latest_price(connection) -> None:
    product_id = add_product(connection, category_slug="snacks")
    add_price(connection, product_id, "3.29", "2026-09-01")
    add_price(connection, product_id, "3.49", "2026-10-01")
    add_price(connection, product_id, "2.99", "2026-08-01")  # added last, but older

    product = ProductRepository(connection).get_by_id(product_id)

    assert isinstance(product, ProductRead)
    assert (product.id, product.barcode, product.name) == (product_id, BARCODE, "Sample Chips")
    assert str(product.image_url) == "https://example.com/chips.jpg"
    assert product.category is not None and product.category.slug == "snacks"
    assert product.price is not None
    assert (product.price.amount, product.price.currency) == (Decimal("3.49"), "USD")
    assert product.brand is None


def test_get_by_id_without_category_or_prices(connection) -> None:
    product_id = add_product(connection)

    product = ProductRepository(connection).get_by_id(product_id)

    assert product is not None
    assert product.category is None
    assert product.price is None


def test_get_by_id_returns_none_for_an_unknown_id(connection) -> None:
    assert ProductRepository(connection).get_by_id(999) is None


def test_get_by_barcode(connection) -> None:
    product_id = add_product(connection)
    products = ProductRepository(connection)

    found = products.get_by_barcode(BARCODE)
    assert found is not None and found.id == product_id
    assert products.get_by_barcode("012345678905") is None


def test_routes_get_a_repository_through_depends(db_url: str, connection) -> None:
    product_id = add_product(connection, category_slug="snacks")
    add_price(connection, product_id, "3.49", "2026-10-01")
    connection.commit()  # so the app's own connection can see the rows

    app = create_app(load_settings(_env_file=None, database_url=db_url))

    @app.get("/test/products/{product_id}")
    def get_product(product_id: int, products: Products) -> ProductRead | None:
        return products.get_by_id(product_id)

    with TestClient(app) as client:
        body = client.get(f"/test/products/{product_id}").json()

    assert body["name"] == "Sample Chips"
    assert body["category"]["slug"] == "snacks"
    assert body["price"]["amount"] == "3.49"
