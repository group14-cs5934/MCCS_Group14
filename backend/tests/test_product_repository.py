from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app
from app.repositories import ProductRepository, Products
from app.schemas import ProductRead
from tests.factories import BARCODE, add_price, add_product


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


@pytest.mark.parametrize(
    "barcode", ["", "abc", "0360002914", "036000291452\x00", "０３６０００２９１４５２"]
)
def test_get_by_barcode_returns_none_for_a_malformed_barcode(connection, barcode) -> None:
    add_product(connection)

    assert ProductRepository(connection).get_by_barcode(barcode) is None


@pytest.fixture
def catalog(connection) -> ProductRepository:
    """A repository over three products: two coffees (one in "coffee") and a snack."""
    [(coffee_id,), (snacks_id,)] = connection.execute(
        "INSERT INTO categories (name, slug) VALUES ('Coffee', 'coffee'), ('Snacks', 'snacks') "
        "RETURNING id"
    ).fetchall()
    with connection.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO products (barcode, name, category_id) VALUES (%s, %s, %s)",
            [
                ("012000000010", "Ground Coffee", coffee_id),
                ("012000000027", "Instant Coffee Sticks", None),
                ("012000000034", "Potato Chips", snacks_id),
            ],
        )
    return ProductRepository(connection)


def test_search_found_by_name(catalog) -> None:
    found = catalog.search("coffee")

    assert sorted(product.name for product in found) == ["Ground Coffee", "Instant Coffee Sticks"]
    assert all(isinstance(product, ProductRead) for product in found)


def test_search_found_by_category_includes_category_and_price(connection, catalog) -> None:
    [product] = catalog.search(category="snacks")
    add_price(connection, product.id, "2.99", "2026-10-01")

    [product] = catalog.search(category="snacks")
    assert product.name == "Potato Chips"
    assert product.category is not None and product.category.slug == "snacks"
    assert product.price is not None and product.price.amount == Decimal("2.99")


def test_search_trims_the_query_and_ignores_category_case(catalog) -> None:
    assert [p.name for p in catalog.search("  coffee  ", category=" Coffee ")] == ["Ground Coffee"]


@pytest.mark.parametrize(
    ("query", "category"),
    [("tea", None), ("xqzvplmw", None), ("", "no-such-category"), ("chips", "coffee")],
)
def test_search_not_found_returns_an_empty_list(catalog, query, category) -> None:
    assert catalog.search(query, category) == []


@pytest.mark.parametrize(
    ("query", "category"), [("", None), ("   ", None), ("", ""), ("  ", "  "), ("\x00", None)]
)
def test_empty_search_returns_an_empty_list(catalog, query, category) -> None:
    assert catalog.search(query, category) == []


def test_search_limit_and_offset(catalog) -> None:
    everything = [product.name for product in catalog.search("coffee")]

    assert [product.name for product in catalog.search("coffee", limit=1)] == everything[:1]
    assert [product.name for product in catalog.search("coffee", offset=1)] == everything[1:]
    assert catalog.search("coffee", offset=5) == []


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
