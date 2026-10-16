"""T039: the users table and GET /me against a real database (skipped without TEST_DATABASE_URL).

Acceptance: when a user signs up, a user record with the default "user" role is created. The app
calls GET /me right after signing in, which adds the record.
"""

from collections.abc import Iterator
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.auth import TokenUser, get_token_user
from app.core.config import load_settings
from app.main import create_app
from app.repositories import UserRepository

USER_ID = UUID("8f14e45f-ceea-467f-a8f0-3b7b2b1c1f00")
EMAIL = "shopper@example.com"


def stored_users(connection: psycopg.Connection) -> list[tuple]:
    return connection.execute("SELECT id, email, role FROM users ORDER BY id").fetchall()


def test_first_call_adds_the_user_with_the_user_role(connection) -> None:
    user = UserRepository(connection).get_or_create(USER_ID, EMAIL)

    assert (user.id, user.email, user.role) == (USER_ID, EMAIL, "user")
    assert stored_users(connection) == [(USER_ID, EMAIL, "user")]


def test_later_calls_return_the_same_row_and_update_the_email(connection) -> None:
    users = UserRepository(connection)
    users.get_or_create(USER_ID, EMAIL)

    user = users.get_or_create(USER_ID, "new@example.com")

    assert user.email == "new@example.com"
    assert stored_users(connection) == [(USER_ID, "new@example.com", "user")]


def test_an_admin_stays_an_admin(connection) -> None:
    users = UserRepository(connection)
    users.get_or_create(USER_ID, EMAIL)
    connection.execute("UPDATE users SET role = 'admin' WHERE id = %s", (USER_ID,))

    assert users.get_or_create(USER_ID, EMAIL).role == "admin"


def test_unknown_roles_are_rejected(connection) -> None:
    UserRepository(connection).get_or_create(USER_ID, EMAIL)

    with pytest.raises(psycopg.errors.CheckViolation):
        connection.execute("UPDATE users SET role = 'owner' WHERE id = %s", (USER_ID,))


@pytest.fixture
def client(db_url: str) -> Iterator[TestClient]:
    """Client for an app connected to the test database, with token checks skipped."""
    app = create_app(load_settings(_env_file=None, database_url=db_url))
    app.dependency_overrides[get_token_user] = lambda: TokenUser(id=USER_ID, email=EMAIL)
    with TestClient(app) as client:
        yield client


def test_me_adds_one_user_record(client, connection) -> None:
    first = client.get("/me")
    second = client.get("/me")

    assert first.status_code == second.status_code == 200
    assert second.json() == {"id": str(USER_ID), "email": EMAIL, "role": "user"}
    assert stored_users(connection) == [(USER_ID, EMAIL, "user")]
