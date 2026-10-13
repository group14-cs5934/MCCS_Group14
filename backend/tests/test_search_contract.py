"""The search API's real response, shared with the mobile app's tests (needs TEST_DATABASE_URL).

T049 acceptance: when I search in the app, the results match what the API returns for the same
query. This test checks that mobile/__tests__/fixtures/search-api-response.json is exactly what
GET /products/search returns for its query; mobile/__tests__/search-api-contract.test.tsx feeds
that same file to the search screen and checks it shows those results, in that order.

If the API's response changes on purpose, regenerate the file and commit it:
    UPDATE_SEARCH_FIXTURE=1 uv run pytest tests/test_search_contract.py
"""

import json
import os
from pathlib import Path

import psycopg
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app

FIXTURE = Path(__file__).resolve().parents[2] / "mobile/__tests__/fixtures/search-api-response.json"
QUERY = "coffe"  # with a typo, like a real shopper

# Fixed timestamps so the response is the same on every run.
CREATED = "2026-10-01T12:00:00Z"
PRODUCTS = [
    # (barcode, name, size, image_url, category slug, price)
    (
        "025500000015",
        "Folgers Classic Roast Ground Coffee",
        "25.9 oz",
        "https://images.example.com/folgers.jpg",
        "coffee-tea",
        "8.99",
    ),
    ("076211000016", "Starbucks Pike Place Coffee", "12 oz", None, "coffee-tea", "9.49"),
    ("012000000027", "Coffee Crisp Chocolate Bar", "50 g", None, "candy", None),
    ("012000000034", "Heath Toffee Bar", "39 g", None, "candy", "1.29"),  # must not match
]
CATEGORIES = [("Coffee & Tea", "coffee-tea"), ("Candy", "candy")]


def add_catalog(connection: psycopg.Connection) -> None:
    category_ids = {
        slug: connection.execute(
            "INSERT INTO categories (name, slug) VALUES (%s, %s) RETURNING id", (name, slug)
        ).fetchone()[0]
        for name, slug in CATEGORIES
    }
    for barcode, name, size, image_url, slug, price in PRODUCTS:
        (product_id,) = connection.execute(
            """
            INSERT INTO products (barcode, name, size, image_url, category_id, created_at,
                                  updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (barcode, name, size, image_url, category_ids[slug], CREATED, CREATED),
        ).fetchone()
        if price:
            connection.execute(
                "INSERT INTO prices (product_id, amount, source, observed_at) "
                "VALUES (%s, %s, 'MCCS', %s)",
                (product_id, price, CREATED),
            )
    connection.commit()


def test_shared_fixture_is_what_the_api_returns(db_url: str, connection) -> None:
    add_catalog(connection)
    app = create_app(load_settings(_env_file=None, database_url=db_url))
    with TestClient(app) as client:
        response = client.get("/products/search", params={"q": QUERY})
    assert response.status_code == 200
    actual = {"query": QUERY, "results": response.json()}

    if os.environ.get("UPDATE_SEARCH_FIXTURE"):
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(actual, indent=2) + "\n", encoding="utf-8", newline="\n")

    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert actual == expected, (
        "GET /products/search no longer returns what the mobile tests expect. If that's on "
        "purpose, regenerate the fixture (see this file's docstring) and check the app still "
        "shows the results correctly."
    )
    # Guard against a fixture that would make the mobile test meaningless.
    names = [product["name"] for product in actual["results"]]
    assert len(names) == 3 and "Heath Toffee Bar" not in names
