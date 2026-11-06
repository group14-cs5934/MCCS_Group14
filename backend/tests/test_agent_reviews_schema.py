"""Agent review tables from migrations 017, 018 and 022 (skipped without TEST_DATABASE_URL).

jobs/product-monitor reads the catalog products that have a product_page_url (T052.7), saves
reviews from those pages to agent_reviews, each page's average rating and review count to
agent_source_ratings, and one AI-written overall review per product to agent_review_summaries
(T052.6). Checks the rules the tables enforce themselves: each review saved once per product per
source, stars on a 0-5 scale, no empty reviews, one overall review per product, and every row
belonging to a catalog product. The job's own queries are run from its file, so they're tested as
they really are.
"""

import ast
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import pytest

from tests.factories import add_product

TABLES = ["agent_reviews", "agent_source_ratings", "agent_review_summaries"]
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
MONITOR = Path(__file__).resolve().parents[2] / "jobs" / "product-monitor" / "product-monitor.py"
PAGE = "https://www.mynavyexchange.com/sample-chips/123"


def monitor_query(name: str) -> str:
    """A SQL constant from the monitor's own file, read without importing it (it needs its own
    packages)."""
    tree = ast.parse(MONITOR.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == name:
            return ast.literal_eval(node.value)
    raise AssertionError(f"{name} isn't in {MONITOR}")


@pytest.fixture
def product_id(connection) -> int:
    return add_product(connection)


def add_agent_review(
    connection, product_id, source="mynavyexchange.com", key="a" * 64, stars=4.5, body="Tasty."
):
    connection.execute(
        "INSERT INTO agent_reviews (product_id, source, source_url, review_key, stars, body) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (product_id, source, PAGE, key, stars, body),
    )


def add_overall_review(connection, product_id, text="Shoppers like the flavor.") -> None:
    connection.execute(
        "INSERT INTO agent_review_summaries (product_id, overall_review, review_count, model) "
        "VALUES (%s, %s, 8, 'test-model')",
        (product_id, text),
    )


def count(connection: psycopg.Connection, table: str) -> int:
    (rows,) = connection.execute(f"SELECT count(*) FROM {table}").fetchone()  # table is a constant
    return rows


# --- products.product_page_url ---


def test_product_page_url_is_optional_and_https_only(connection, product_id) -> None:
    connection.execute(
        "UPDATE products SET product_page_url = %s WHERE id = %s", (PAGE, product_id)
    )
    connection.execute("UPDATE products SET product_page_url = NULL WHERE id = %s", (product_id,))
    with pytest.raises(psycopg.errors.CheckViolation):
        connection.execute(
            "UPDATE products SET product_page_url = 'http://example.com/p' WHERE id = %s",
            (product_id,),
        )


def test_monitor_reads_only_products_with_a_page(connection, product_id) -> None:
    other = add_product(connection, barcode="012345678905")
    connection.execute(
        "UPDATE products SET product_page_url = %s WHERE id = %s", (PAGE, product_id)
    )
    rows = connection.execute(monitor_query("SELECT_PRODUCTS")).fetchall()
    assert rows == [(product_id, "Sample Chips", "184g", PAGE)]
    assert other not in [row[0] for row in rows]


# --- The agent tables ---


@pytest.mark.parametrize("table", TABLES)
def test_row_level_security_is_on(connection, table) -> None:
    (enabled,) = connection.execute(
        "SELECT relrowsecurity FROM pg_class WHERE oid = %s::regclass", (table,)
    ).fetchone()
    assert enabled


@pytest.mark.parametrize("table", TABLES)
def test_rows_go_when_their_product_is_deleted(connection, product_id, table) -> None:
    add_agent_review(connection, product_id)
    connection.execute(
        "INSERT INTO agent_source_ratings (product_id, source, source_url, review_count) "
        "VALUES (%s, 'mynavyexchange.com', %s, 120)",
        (product_id, PAGE),
    )
    add_overall_review(connection, product_id)
    connection.execute("DELETE FROM products WHERE id = %s", (product_id,))
    assert count(connection, table) == 0


def test_review_of_a_product_not_in_the_catalog_is_rejected(connection) -> None:
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        add_agent_review(connection, 999999)


def test_same_review_is_saved_once_per_product_per_source(connection, product_id) -> None:
    add_agent_review(connection, product_id)
    with pytest.raises(psycopg.errors.UniqueViolation):
        add_agent_review(connection, product_id)


def test_same_text_on_another_product_or_source_is_a_different_review(
    connection, product_id
) -> None:
    add_agent_review(connection, product_id)
    add_agent_review(connection, add_product(connection, barcode="012345678905"))
    add_agent_review(connection, product_id, source="target.com")
    assert count(connection, "agent_reviews") == 3


@pytest.mark.parametrize(
    ("stars", "body"),
    [(5.5, "Too many stars."), (-1, "Too few stars."), (4, "   ")],
)
def test_bad_reviews_are_rejected(connection, product_id, stars, body) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        add_agent_review(connection, product_id, stars=stars, body=body)


def test_one_rating_per_product_per_source(connection, product_id) -> None:
    insert = (
        "INSERT INTO agent_source_ratings "
        "(product_id, source, source_url, average_stars, review_count) "
        "VALUES (%s, %s, %s, 4.25, 120)"
    )
    connection.execute(insert, (product_id, "mynavyexchange.com", PAGE))
    connection.execute(insert, (product_id, "target.com", PAGE))
    with pytest.raises(psycopg.errors.UniqueViolation):
        connection.execute(insert, (product_id, "mynavyexchange.com", PAGE))


def test_one_overall_review_per_product(connection, product_id) -> None:
    add_overall_review(connection, product_id)
    with pytest.raises(psycopg.errors.UniqueViolation):
        add_overall_review(connection, product_id)


def test_empty_overall_review_is_rejected(connection, product_id) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        add_overall_review(connection, product_id, text="   ")


# --- The monitor's writes ---


def test_monitor_queries_save_and_count_a_products_reviews(connection, product_id) -> None:
    now = datetime.now(UTC).isoformat()  # text, as the monitor sends its run_at
    review = {
        "product_id": product_id,
        "source": "mynavyexchange.com",
        "source_url": PAGE,
        "review_key": "b" * 64,
        "stars": 4,
        "title": None,
        "body": "Crunchy.",
        "reviewed_on": None,
        "first_seen_at": now,
    }
    assert connection.execute(monitor_query("INSERT_AGENT_REVIEW"), review).rowcount == 1
    # Seen again on the next run: skipped.
    assert connection.execute(monitor_query("INSERT_AGENT_REVIEW"), review).rowcount == 0

    rating = {
        "product_id": product_id,
        "source": "mynavyexchange.com",
        "source_url": PAGE,
        "product_name": "Sample Chips",
        "average_stars": 4.5,
        "review_count": 10,
        "updated_at": now,
    }
    connection.execute(monitor_query("UPSERT_SOURCE_RATING"), rating)
    connection.execute(monitor_query("UPSERT_SOURCE_RATING"), {**rating, "review_count": 11})

    key = {"product_id": product_id}
    assert connection.execute(monitor_query("COUNT_PRODUCT_REVIEWS"), key).fetchone() == (1, None)
    overall = {
        **key,
        "overall_review": "Shoppers like the crunch.",
        "review_count": 1,
        "model": "test-model",
        "generated_at": now,
    }
    connection.execute(monitor_query("UPSERT_OVERALL_REVIEW"), overall)
    connection.execute(monitor_query("UPSERT_OVERALL_REVIEW"), overall)
    assert connection.execute(monitor_query("COUNT_PRODUCT_REVIEWS"), key).fetchone() == (1, 1)

    reviews = connection.execute(
        monitor_query("SELECT_PRODUCT_REVIEWS"), {**key, "limit": 10}
    ).fetchall()
    assert [row[-1] for row in reviews] == ["Crunchy."]
    ratings = connection.execute(monitor_query("SELECT_PRODUCT_RATINGS"), key).fetchall()
    assert [row[-1] for row in ratings] == [11]


# --- Migrations ---


def test_migration_022_moves_old_tables_onto_products(connection, product_id) -> None:
    """A database migrated up to 018 with rows under the old text IDs, like Supabase: 022 deletes
    those rows, which can't be linked to a product, and links the tables to products."""
    connection.execute("DROP TABLE agent_reviews, agent_source_ratings, agent_review_summaries")
    for migration in ("017_create_agent_reviews.sql", "018_add_agent_overall_reviews.sql"):
        connection.execute((MIGRATIONS / migration).read_text("utf-8"))
    connection.execute(
        "INSERT INTO agent_reviews (product, source, source_url, review_key, body) "
        "VALUES ('starbucks-veranda', 'navy-exchange', %s, %s, 'Smooth.')",
        (PAGE, "c" * 64),
    )
    connection.execute(
        "INSERT INTO agent_source_ratings (product, source, source_url, review_count) "
        "VALUES ('starbucks-veranda', 'navy-exchange', %s, 928)",
        (PAGE,),
    )
    connection.execute(
        "INSERT INTO agent_review_summaries (product, overall_review, review_count, model) "
        "VALUES ('starbucks-veranda', 'Smooth and mild.', 1, 'test-model')"
    )

    connection.execute((MIGRATIONS / "022_add_product_page_urls.sql").read_text("utf-8"))

    for table in TABLES:
        assert count(connection, table) == 0
    # The new shape works: one of each row for a catalog product.
    add_agent_review(connection, product_id)
    add_overall_review(connection, product_id)
    with pytest.raises(psycopg.errors.UniqueViolation):
        add_agent_review(connection, product_id)


@pytest.mark.parametrize(
    "migration", ["018_add_agent_overall_reviews.sql", "022_add_product_page_urls.sql"]
)
def test_migration_can_run_again_without_losing_rows(connection, product_id, migration) -> None:
    """Migrations must be safe to rerun: 018 mustn't rename the new table away, and 022 mustn't
    delete reviews already linked to products."""
    add_agent_review(connection, product_id)
    add_overall_review(connection, product_id)
    connection.execute((MIGRATIONS / migration).read_text("utf-8"))
    assert count(connection, "agent_reviews") == 1
    assert count(connection, "agent_review_summaries") == 1
