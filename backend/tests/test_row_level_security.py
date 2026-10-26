"""Row level security: apps can't read or change rows directly (skipped without TEST_DATABASE_URL).

T084 acceptance: when a user tries to edit another user's review directly in the database, the
change is blocked.

On Supabase, an app (or anyone with its publishable key or a signed-in user's token) can send SQL
to public tables through the REST API, as a non-owner role. These tests stand in for that client
with a role that has every table privilege, as if access had been opened up by mistake, and check
that row level security still blocks it. The backend connects as the tables' owner, which row
level security doesn't apply to, so the API keeps working (every other test shows that).
"""

from collections.abc import Iterator
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql

from tests.factories import add_product, add_user

# A non-owner role standing in for a Supabase client (like its anon or authenticated role).
CLIENT_ROLE = "rls_test_client"


def tables(connection: psycopg.Connection) -> dict[str, bool]:
    """Every table in the test schema, and whether row level security is on for it."""
    rows = connection.execute(
        """
        SELECT c.relname, c.relrowsecurity
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind = 'r'
        """
    ).fetchall()
    return dict(rows)


def test_every_table_has_row_level_security(connection) -> None:
    # A new migration that adds a table without row level security fails here.
    found = tables(connection)

    assert {"products", "reviews", "users"} <= set(found)
    assert [name for name, enabled in sorted(found.items()) if not enabled] == []


@pytest.fixture
def client_role(connection: psycopg.Connection) -> str:
    """CLIENT_ROLE, with every privilege on every table in the test schema (worst case)."""
    try:
        connection.execute(
            sql.SQL(
                "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = {name}) THEN "
                "CREATE ROLE {role} NOLOGIN; END IF; END $$"
            ).format(name=sql.Literal(CLIENT_ROLE), role=sql.Identifier(CLIENT_ROLE))
        )
        schema = sql.Identifier(connection.execute("SELECT current_schema()").fetchone()[0])
        role = sql.Identifier(CLIENT_ROLE)
        connection.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(schema, role))
        connection.execute(
            sql.SQL("GRANT ALL ON ALL TABLES IN SCHEMA {} TO {}").format(schema, role)
        )
        connection.execute(
            sql.SQL("GRANT ALL ON ALL SEQUENCES IN SCHEMA {} TO {}").format(schema, role)
        )
        connection.commit()
    except psycopg.errors.InsufficientPrivilege:
        pytest.skip("creating a test role needs a superuser (CI's Postgres is one)")
    return CLIENT_ROLE


@pytest.fixture
def data(connection: psycopg.Connection) -> dict:
    """A product with a price, and a review by Alice."""
    product_id = add_product(connection)
    connection.execute("INSERT INTO prices (product_id, amount) VALUES (%s, 2.49)", (product_id,))
    alice, mallory = add_user(connection), add_user(connection)
    (review_id,) = connection.execute(
        "INSERT INTO reviews (product_id, user_id, body) VALUES (%s, %s, 'Great chips') "
        "RETURNING id",
        (product_id, alice),
    ).fetchone()
    connection.commit()
    return {"product_id": product_id, "review_id": review_id, "alice": alice, "mallory": mallory}


@pytest.fixture
def as_client(
    connection: psycopg.Connection, client_role: str, data: dict
) -> Iterator[psycopg.Cursor]:
    """A cursor acting as the client role, after `data` is added as the owner. Everything it does
    is rolled back afterwards."""
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL("SET ROLE {}").format(sql.Identifier(client_role)))
        try:
            yield cursor
        finally:
            connection.rollback()
            cursor.execute("RESET ROLE")


def test_editing_another_users_review_directly_is_blocked(as_client, connection, data) -> None:
    as_client.execute(
        "UPDATE reviews SET body = 'Hacked', hidden_at = NULL WHERE id = %s", (data["review_id"],)
    )

    assert as_client.rowcount == 0  # row level security hides the row, so nothing is updated
    connection.rollback()
    assert connection.execute(
        "SELECT body FROM reviews WHERE id = %s", (data["review_id"],)
    ).fetchone() == ("Great chips",)


def test_deleting_another_users_review_directly_is_blocked(as_client, connection, data) -> None:
    as_client.execute("DELETE FROM reviews WHERE id = %s", (data["review_id"],))

    assert as_client.rowcount == 0
    connection.rollback()
    assert connection.execute("SELECT count(*) FROM reviews").fetchone() == (1,)


def test_writing_a_review_as_someone_else_directly_is_blocked(as_client, data) -> None:
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        as_client.execute(
            "INSERT INTO reviews (product_id, user_id, body) VALUES (%s, %s, 'Fake')",
            (data["product_id"], data["alice"]),
        )


def test_reading_reviews_users_and_the_audit_log_directly_returns_nothing(as_client, data) -> None:
    for table in ("reviews", "ratings", "users", "admin_audit_log"):
        as_client.execute(sql.SQL("SELECT * FROM {}").format(sql.Identifier(table)))
        assert as_client.fetchall() == [], table


def test_promoting_yourself_to_admin_directly_is_blocked(as_client, connection, data) -> None:
    as_client.execute("UPDATE users SET role = 'admin' WHERE id = %s", (data["mallory"],))

    assert as_client.rowcount == 0
    connection.rollback()
    assert connection.execute(
        "SELECT role FROM users WHERE id = %s", (data["mallory"],)
    ).fetchone() == ("user",)


def test_changing_products_and_prices_directly_is_blocked(as_client, connection, data) -> None:
    product = (data["product_id"],)
    as_client.execute("UPDATE products SET name = 'Free stuff' WHERE id = %s", product)
    renamed = as_client.rowcount
    as_client.execute("UPDATE prices SET amount = 0.01 WHERE product_id = %s", product)
    repriced = as_client.rowcount
    as_client.execute("DELETE FROM categories")
    as_client.execute("SELECT * FROM products")
    visible = as_client.fetchall()

    assert (renamed, repriced, visible) == (0, 0, [])
    connection.rollback()
    assert connection.execute(
        "SELECT p.name, pr.amount::text FROM products p JOIN prices pr ON pr.product_id = p.id"
    ).fetchone() == ("Sample Chips", "2.49")


def test_adding_a_product_directly_is_blocked(as_client) -> None:
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        as_client.execute(
            "INSERT INTO products (barcode, name) VALUES (%s, 'Sneaky')", (str(uuid4().int)[:12],)
        )
