"""Agent review tables from migrations 017 and 018 (skipped without TEST_DATABASE_URL).

T052.6: jobs/product-monitor saves reviews from stores' product pages to agent_reviews, each page's
average rating and review count to agent_source_ratings, and one AI-written overall review per
product to agent_review_summaries. Checks the rules the tables enforce themselves: each review saved
once per product per source, stars on a 0-5 scale, no empty reviews, one overall review per product,
and no dependence on the catalog.
"""

from pathlib import Path

import psycopg
import pytest

PRODUCT = "starbucks-veranda-blend-k-cup-pods-32-count"
TABLES = ["agent_reviews", "agent_source_ratings", "agent_review_summaries"]


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


def test_one_rating_per_product_per_source(connection) -> None:
    insert = (
        "INSERT INTO agent_source_ratings "
        "(product, source, source_url, average_stars, review_count) "
        "VALUES (%s, %s, 'https://example.com/p', 4.25, 120)"
    )
    connection.execute(insert, (PRODUCT, "navy-exchange"))
    connection.execute(insert, (PRODUCT, "other-store"))
    with pytest.raises(psycopg.errors.UniqueViolation):
        connection.execute(insert, (PRODUCT, "navy-exchange"))


def add_overall_review(connection, text="Shoppers like the flavor.") -> None:
    connection.execute(
        "INSERT INTO agent_review_summaries (product, overall_review, review_count, model) "
        "VALUES (%s, %s, 8, 'test-model')",
        (PRODUCT, text),
    )


def test_one_overall_review_per_product(connection) -> None:
    add_overall_review(connection)
    with pytest.raises(psycopg.errors.UniqueViolation):
        add_overall_review(connection)


def test_empty_overall_review_is_rejected(connection) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        add_overall_review(connection, text="   ")


def test_migration_018_can_run_again(connection) -> None:
    """Migrations must be safe to rerun, and this one must not rename the new table away."""
    migration = Path(__file__).resolve().parents[1] / "migrations"
    add_overall_review(connection)
    connection.execute((migration / "018_add_agent_overall_reviews.sql").read_text("utf-8"))
    assert count(connection, "agent_review_summaries") == 1
