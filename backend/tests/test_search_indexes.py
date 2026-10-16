"""pg_trgm search support from migration 003 (skipped without TEST_DATABASE_URL).

T034 acceptance: when I search with a small typo (e.g. "coffe"), matching products are still
returned. These run the word-similarity query the search endpoint (T035) is meant to use.
"""

import psycopg
import pytest

PRODUCTS = [
    ("012000000010", "Starbucks Pike Place Ground Coffee"),
    ("012000000027", "Folgers Classic Roast Coffee"),
    ("012000000034", "Heath Toffee Bar"),
    ("012000000041", "Hershey's Milk Chocolate Bar"),
    ("012000000058", "Lay's Sour Cream & Onion Chips"),
]


@pytest.fixture
def products(connection: psycopg.Connection) -> psycopg.Connection:
    """The test database with PRODUCTS in it."""
    with connection.cursor() as cursor:
        cursor.executemany("INSERT INTO products (barcode, name) VALUES (%s, %s)", PRODUCTS)
    return connection


def search_names(connection: psycopg.Connection, table: str, query: str) -> list[str]:
    """Names in `table` containing a word close to `query`, best match first."""
    rows = connection.execute(
        f"SELECT name FROM {table} WHERE %(q)s <%% name "  # table is a constant from the test
        "ORDER BY word_similarity(%(q)s, name) DESC, name",
        {"q": query},
    ).fetchall()
    return [name for (name,) in rows]


def test_typo_still_finds_matching_products(products) -> None:
    assert search_names(products, "products", "coffe") == [
        "Folgers Classic Roast Coffee",
        "Starbucks Pike Place Ground Coffee",
    ]


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("Coffee", "Folgers Classic Roast Coffee"),  # exact word, any case
        ("chocolte", "Hershey's Milk Chocolate Bar"),  # missing letter
        ("hersheys", "Hershey's Milk Chocolate Bar"),  # missing apostrophe
        ("toffe", "Heath Toffee Bar"),
    ],
)
def test_close_spellings_find_the_product(products, query, expected) -> None:
    assert expected in search_names(products, "products", query)


def test_unrelated_words_find_nothing(products) -> None:
    assert search_names(products, "products", "shampoo") == []


def test_typo_in_a_category_name_still_matches(connection) -> None:
    connection.execute("INSERT INTO categories (name, slug) VALUES ('Snacks', 'snacks')")
    connection.execute("INSERT INTO categories (name, slug) VALUES ('Beverages', 'beverages')")

    assert search_names(connection, "categories", "snacs") == ["Snacks"]


@pytest.mark.parametrize(
    ("table", "index"),
    [("products", "products_name_trgm_idx"), ("categories", "categories_name_trgm_idx")],
)
@pytest.mark.parametrize("condition", ["%(q)s <%% name", "name ILIKE '%%' || %(q)s || '%%'"])
def test_name_searches_can_use_the_trigram_index(connection, table, index, condition) -> None:
    # With only a few rows Postgres would rather read the whole table, so turn that off to see
    # whether the index can serve the query at all.
    connection.execute("SET LOCAL enable_seqscan = off")

    plan = connection.execute(
        f"EXPLAIN SELECT id FROM {table} WHERE {condition}", {"q": "coffe"}
    ).fetchall()

    assert index in "\n".join(line for (line,) in plan)
