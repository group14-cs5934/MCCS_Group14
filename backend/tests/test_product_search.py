"""GET /products/search against a real database (skipped without TEST_DATABASE_URL).

T035 acceptance: searching "coffee" returns products with coffee in the name; searching a
category returns only products in that category; nonsense text returns an empty list, not an
error.
"""

from collections.abc import Iterator

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app
from tests.factories import add_price

# (barcode, name, category slug)
CATALOG = [
    ("012000000010", "Starbucks Pike Place Ground Coffee", "coffee-tea"),
    ("012000000027", "Folgers Classic Roast Coffee", "coffee-tea"),
    ("012000000034", "Lipton Black Tea Bags", "coffee-tea"),
    ("012000000041", "Heath Toffee Bar", "candy"),
    ("012000000058", "Coffee Crisp Chocolate Bar", "candy"),
    ("012000000065", "Lay's Classic Potato Chips", "snacks"),
    ("012000000072", "Doritos Nacho Cheese Chips", "snacks"),
    ("012000000089", "Paper Towels", None),
]
CATEGORIES = {"coffee-tea": "Coffee & Tea", "candy": "Candy", "snacks": "Snacks"}


@pytest.fixture
def client(db_url: str, connection: psycopg.Connection) -> Iterator[TestClient]:
    """Client for an app connected to the test database, which holds CATALOG."""
    category_ids = {
        slug: connection.execute(
            "INSERT INTO categories (name, slug) VALUES (%s, %s) RETURNING id", (name, slug)
        ).fetchone()[0]
        for slug, name in CATEGORIES.items()
    }
    for barcode, name, slug in CATALOG:
        connection.execute(
            "INSERT INTO products (barcode, name, category_id) VALUES (%s, %s, %s)",
            (barcode, name, category_ids.get(slug)),
        )
    connection.commit()

    app = create_app(load_settings(_env_file=None, database_url=db_url))
    with TestClient(app) as client:
        yield client


def names(response) -> list[str]:
    assert response.status_code == 200
    return [product["name"] for product in response.json()]


def test_coffee_returns_products_with_coffee_in_the_name(client) -> None:
    found = names(client.get("/products/search", params={"q": "coffee"}))

    assert sorted(found) == [
        "Coffee Crisp Chocolate Bar",
        "Folgers Classic Roast Coffee",
        "Starbucks Pike Place Ground Coffee",
    ]


def test_small_typo_still_finds_matches(client) -> None:
    found = names(client.get("/products/search", params={"q": "coffe"}))

    assert "Heath Toffee Bar" not in found
    assert len(found) == 3


def test_closest_match_comes_first(client) -> None:
    found = names(client.get("/products/search", params={"q": "classic roast coffee"}))

    assert found[0] == "Folgers Classic Roast Coffee"


def test_category_returns_only_that_categorys_products_sorted_by_name(client) -> None:
    found = names(client.get("/products/search", params={"category": "coffee-tea"}))

    assert found == [
        "Folgers Classic Roast Coffee",
        "Lipton Black Tea Bags",
        "Starbucks Pike Place Ground Coffee",
    ]


def test_name_and_category_together_must_both_match(client) -> None:
    found = names(client.get("/products/search", params={"q": "coffee", "category": "candy"}))

    assert found == ["Coffee Crisp Chocolate Bar"]


def test_results_are_full_products(client, connection) -> None:
    [(product_id,)] = connection.execute(
        "SELECT id FROM products WHERE name = 'Lay''s Classic Potato Chips'"
    ).fetchall()
    add_price(connection, product_id, "4.29", "2026-10-01")
    connection.commit()

    [product] = client.get("/products/search", params={"q": "potato"}).json()

    assert product == client.get(f"/products/{product_id}").json()
    assert product["category"]["slug"] == "snacks"
    assert product["price"]["amount"] == "4.29"


@pytest.mark.parametrize(
    "params",
    [
        {"q": "xqzvplmw"},  # nonsense
        {"q": "shampoo"},  # a real word, just not sold here
        {"category": "no-such-category"},
        {"q": "coffee", "category": "snacks"},
        {"q": ""},
        {"q": "   "},
        {},
        {"q": "coffee\x00"},  # NUL, which Postgres can't take as text
    ],
)
def test_no_match_returns_an_empty_list(client, params) -> None:
    response = client.get("/products/search", params=params)

    assert response.status_code == 200
    assert response.json() == []


def test_limit_and_offset_page_through_results(client) -> None:
    search = {"category": "coffee-tea", "limit": 2}

    first = names(client.get("/products/search", params=search))
    rest = names(client.get("/products/search", params={**search, "offset": 2}))

    assert first == ["Folgers Classic Roast Coffee", "Lipton Black Tea Bags"]
    assert rest == ["Starbucks Pike Place Ground Coffee"]


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 51}, {"offset": -1}, {"q": "x" * 101}, {"limit": "all"}]
)
def test_invalid_paging_or_long_query_is_a_validation_error(client, params) -> None:
    response = client.get("/products/search", params={"q": "coffee", **params})

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
