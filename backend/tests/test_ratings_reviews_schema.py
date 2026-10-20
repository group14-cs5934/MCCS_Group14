"""Ratings and reviews tables from migration 005 (skipped without TEST_DATABASE_URL).

T052 acceptance: when migrations run, ratings and reviews tables exist and link to products and
users. Also checks the rules the tables enforce themselves: 1-5 stars, one rating and one review
per user per product, no empty reviews, and rows deleted along with their product or user.
"""

from uuid import uuid4

import psycopg
import pytest

from tests.factories import add_product, add_user

TABLES = ["ratings", "reviews"]


def foreign_keys(connection: psycopg.Connection, table: str) -> dict[str, tuple[str, str, str]]:
    """{column: (referenced table, referenced column, on delete)} for the table's foreign keys."""
    rows = connection.execute(
        """
        SELECT a.attname, c.confrelid::regclass::text, ra.attname, c.confdeltype
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND c.conrelid = %s::regclass
        """,
        (table,),
    ).fetchall()
    on_delete = {"c": "cascade", "n": "set null", "r": "restrict", "a": "no action"}
    return {column: (ref, ref_column, on_delete[kind]) for column, ref, ref_column, kind in rows}


@pytest.fixture
def product_and_user(connection: psycopg.Connection):
    product_id, user_id = add_product(connection), add_user(connection)
    connection.commit()
    return product_id, user_id


def add_rating(connection, product_id, user_id, stars=4) -> None:
    connection.execute(
        "INSERT INTO ratings (product_id, user_id, stars) VALUES (%s, %s, %s)",
        (product_id, user_id, stars),
    )


def add_review(connection, product_id, user_id, body="Crunchy and not too salty.", title=None):
    connection.execute(
        "INSERT INTO reviews (product_id, user_id, title, body) VALUES (%s, %s, %s, %s)",
        (product_id, user_id, title, body),
    )


def count(connection: psycopg.Connection, table: str) -> int:
    (rows,) = connection.execute(f"SELECT count(*) FROM {table}").fetchone()  # table is a constant
    return rows


@pytest.mark.parametrize("table", TABLES)
def test_table_links_to_products_and_users(connection, table) -> None:
    assert foreign_keys(connection, table) == {
        "product_id": ("products", "id", "cascade"),
        "user_id": ("users", "id", "cascade"),
    }


@pytest.mark.parametrize("table", TABLES)
def test_row_level_security_is_on(connection, table) -> None:
    (enabled,) = connection.execute(
        "SELECT relrowsecurity FROM pg_class WHERE oid = %s::regclass", (table,)
    ).fetchone()
    assert enabled


def test_rating_and_review_are_stored_for_a_product_and_user(connection, product_and_user) -> None:
    product_id, user_id = product_and_user

    add_rating(connection, product_id, user_id, stars=5)
    add_review(connection, product_id, user_id, title="Great chips")

    ratings = connection.execute("SELECT product_id, user_id, stars FROM ratings").fetchall()
    reviews = connection.execute("SELECT product_id, user_id, title, body FROM reviews").fetchall()
    assert ratings == [(product_id, user_id, 5)]
    assert reviews == [(product_id, user_id, "Great chips", "Crunchy and not too salty.")]


@pytest.mark.parametrize("stars", [1, 5])
def test_one_to_five_stars_are_allowed(connection, product_and_user, stars) -> None:
    add_rating(connection, *product_and_user, stars=stars)


@pytest.mark.parametrize("stars", [0, 6, -1])
def test_stars_outside_one_to_five_are_rejected(connection, product_and_user, stars) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        add_rating(connection, *product_and_user, stars=stars)


@pytest.mark.parametrize(("table", "add"), [("ratings", add_rating), ("reviews", add_review)])
def test_only_one_per_user_per_product(connection, product_and_user, table, add) -> None:
    add(connection, *product_and_user)

    with pytest.raises(psycopg.errors.UniqueViolation):
        add(connection, *product_and_user)


@pytest.mark.parametrize(("table", "add"), [("ratings", add_rating), ("reviews", add_review)])
def test_other_users_and_products_can_each_have_their_own(connection, table, add) -> None:
    first, second = add_product(connection), add_product(connection, barcode="012000171741")
    alice, bob = add_user(connection), add_user(connection)

    for product_id in (first, second):
        for user_id in (alice, bob):
            add(connection, product_id, user_id)

    assert count(connection, table) == 4


def test_updating_a_rating_replaces_the_stars(connection, product_and_user) -> None:
    add_rating(connection, *product_and_user, stars=2)

    # How the ratings API (T053) will save a rating, new or changed.
    connection.execute(
        """
        INSERT INTO ratings (product_id, user_id, stars) VALUES (%s, %s, 5)
        ON CONFLICT (product_id, user_id) DO UPDATE SET stars = EXCLUDED.stars, updated_at = NOW()
        """,
        product_and_user,
    )

    assert connection.execute("SELECT stars FROM ratings").fetchall() == [(5,)]


@pytest.mark.parametrize(
    ("body", "title"),
    [
        ("", None),  # no review text
        ("   ", None),  # only spaces
        ("x" * 2001, None),  # too long
        ("Fine.", " "),  # blank title (leave it out instead)
        ("Fine.", "x" * 101),  # title too long
    ],
)
def test_empty_or_oversized_reviews_are_rejected(connection, product_and_user, body, title) -> None:
    with pytest.raises((psycopg.errors.CheckViolation, psycopg.errors.StringDataRightTruncation)):
        add_review(connection, *product_and_user, body=body, title=title)


def test_review_title_is_optional(connection, product_and_user) -> None:
    add_review(connection, *product_and_user, title=None)


@pytest.mark.parametrize(("table", "add"), [("ratings", add_rating), ("reviews", add_review)])
def test_unknown_product_or_user_is_rejected(connection, product_and_user, table, add) -> None:
    product_id, user_id = product_and_user

    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        add(connection, product_id, uuid4())
    connection.rollback()
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        add(connection, product_id + 1000, user_id)


@pytest.mark.parametrize("deleted", ["products", "users"])
def test_deleting_the_product_or_user_deletes_their_ratings_and_reviews(
    connection, product_and_user, deleted
) -> None:
    product_id, user_id = product_and_user
    add_rating(connection, product_id, user_id)
    add_review(connection, product_id, user_id)

    row_id = product_id if deleted == "products" else user_id
    connection.execute(f"DELETE FROM {deleted} WHERE id = %s", (row_id,))  # table is a constant

    assert (count(connection, "ratings"), count(connection, "reviews")) == (0, 0)
