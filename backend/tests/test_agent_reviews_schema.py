"""Agent review tables from migration 017 (skipped without TEST_DATABASE_URL).

T052.6: jobs/product-monitor saves reviews from stores' product pages to agent_reviews, and each
page's average rating and review count to agent_review_summaries. Checks the rules the tables
enforce themselves: each review saved once per product per source, stars on a 0-5 scale, no empty
reviews, and no dependence on the catalog.
"""

import psycopg
import pytest

PRODUCT = "starbucks-veranda-blend-k-cup-pods-32-count"
TABLES = ["agent_reviews", "agent_review_summaries"]


def add_agent_review(
    connection, product=PRODUCT, source="navy-exchange", key="a" * 64, stars=4.5, body="Tasty."
):
    connection.execute(
        "INSERT INTO agent_reviews (product, source, source_url, review_key, stars, body) "
        "VALUES (%s, %s, 'https://example.com/p', %s, %s, %s)",
        (product, source, key, stars, body),
    )


def count(connection: psycopg.Connection, table: str) -> int:
    (rows,) = connection.execute(f"SELECT count(*) FROM {table}").fetchone()  # table is a constant
    return rows


@pytest.mark.parametrize("table", TABLES)
def test_row_level_security_is_on(connection, table) -> None:
    (enabled,) = connection.execute(
        "SELECT relrowsecurity FROM pg_class WHERE oid = %s::regclass", (table,)
    ).fetchone()
    assert enabled


@pytest.mark.parametrize("table", TABLES)
def test_table_has_no_foreign_keys(connection, table) -> None:
    """Reviews are collected whether or not the product is in the catalog."""
    (foreign_keys,) = connection.execute(
        "SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND conrelid = %s::regclass",
        (table,),
    ).fetchone()
    assert foreign_keys == 0


def test_review_of_a_product_not_in_the_catalog_is_stored(connection) -> None:
    add_agent_review(connection)
    assert count(connection, "agent_reviews") == 1
    assert count(connection, "products") == 0


def test_same_review_is_saved_once_per_product_per_source(connection) -> None:
    add_agent_review(connection)
    with pytest.raises(psycopg.errors.UniqueViolation):
        add_agent_review(connection)


def test_same_text_on_another_product_or_source_is_a_different_review(connection) -> None:
    add_agent_review(connection)
    add_agent_review(connection, product="another-product")
    add_agent_review(connection, source="other-store")
    assert count(connection, "agent_reviews") == 3


@pytest.mark.parametrize(
    ("stars", "body"),
    [(5.5, "Too many stars."), (-1, "Too few stars."), (4, "   ")],
)
def test_bad_reviews_are_rejected(connection, stars, body) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        add_agent_review(connection, stars=stars, body=body)


def test_one_summary_per_product_per_source(connection) -> None:
    insert = (
        "INSERT INTO agent_review_summaries "
        "(product, source, source_url, average_stars, review_count) "
        "VALUES (%s, 'navy-exchange', 'https://example.com/p', 4.25, 120)"
    )
    connection.execute(insert, (PRODUCT,))
    with pytest.raises(psycopg.errors.UniqueViolation):
        connection.execute(insert, (PRODUCT,))
