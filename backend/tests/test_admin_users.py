"""Admin user management against a real database (skipped without TEST_DATABASE_URL).

T081 acceptance: when an admin changes a user's role or deactivates them, it takes effect on the
user's next request. Unit tests that need no database are in test_admin_users_unit.py.
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

ADMIN = TokenUser(id=UUID("a0000000-0000-4000-8000-000000000001"), email="admin@example.com")
SHOPPER = TokenUser(id=UUID("b0000000-0000-4000-8000-000000000002"), email="Shopper@Example.com")


class Session:
    """A client for the app on the test database, signed in as `user` (change it to switch)."""

    def __init__(self, client: TestClient) -> None:
        self.client = client
        self.user = ADMIN

    def as_user(self, user: TokenUser) -> TestClient:
        self.user = user
        return self.client


@pytest.fixture
def session(db_url: str, connection: psycopg.Connection) -> Iterator[Session]:
    users = UserRepository(connection)
    users.get_or_create(ADMIN.id, ADMIN.email)
    users.update(ADMIN.id, role="admin")
    users.get_or_create(SHOPPER.id, SHOPPER.email)
    connection.commit()

    app = create_app(load_settings(_env_file=None, database_url=db_url))
    with TestClient(app) as client:
        session = Session(client)
        app.dependency_overrides[get_token_user] = lambda: session.user
        yield session


def stored(connection: psycopg.Connection, user: TokenUser) -> tuple:
    connection.commit()  # end this connection's snapshot, so it sees what the API committed
    return connection.execute(
        "SELECT role, deactivated_at IS NOT NULL FROM users WHERE id = %s", (user.id,)
    ).fetchone()


def test_role_change_applies_on_the_users_next_request(session, connection) -> None:
    assert session.as_user(SHOPPER).get("/admin/users").status_code == 403

    response = session.as_user(ADMIN).patch(f"/admin/users/{SHOPPER.id}", json={"role": "admin"})

    assert response.status_code == 200
    assert stored(connection, SHOPPER) == ("admin", False)
    assert session.as_user(SHOPPER).get("/admin/users").status_code == 200

    session.as_user(ADMIN).patch(f"/admin/users/{SHOPPER.id}", json={"role": "user"})
    assert session.as_user(SHOPPER).get("/admin/users").status_code == 403


def test_deactivation_applies_on_the_users_next_request(session, connection) -> None:
    assert session.as_user(SHOPPER).get("/me").status_code == 200

    session.as_user(ADMIN).patch(f"/admin/users/{SHOPPER.id}", json={"active": False})

    assert stored(connection, SHOPPER) == ("user", True)
    response = session.as_user(SHOPPER).get("/me")
    assert response.status_code == 403
    assert response.json()["code"] == "account_deactivated"
    # Every signed-in endpoint is blocked, e.g. rating a product.
    rating = session.as_user(SHOPPER).post("/products/1/ratings", json={"stars": 4})
    assert rating.status_code == 403

    session.as_user(ADMIN).patch(f"/admin/users/{SHOPPER.id}", json={"active": True})
    assert stored(connection, SHOPPER) == ("user", False)
    assert session.as_user(SHOPPER).get("/me").status_code == 200


def test_deactivating_twice_keeps_the_first_time(session, connection) -> None:
    client = session.as_user(ADMIN)
    client.patch(f"/admin/users/{SHOPPER.id}", json={"active": False})
    connection.commit()
    (first,) = connection.execute(
        "SELECT deactivated_at FROM users WHERE id = %s", (SHOPPER.id,)
    ).fetchone()

    client.patch(f"/admin/users/{SHOPPER.id}", json={"active": False})

    connection.commit()
    assert connection.execute(
        "SELECT deactivated_at FROM users WHERE id = %s", (SHOPPER.id,)
    ).fetchone() == (first,)


def test_changing_only_one_field_keeps_the_other(session, connection) -> None:
    client = session.as_user(ADMIN)
    client.patch(f"/admin/users/{SHOPPER.id}", json={"active": False})

    client.patch(f"/admin/users/{SHOPPER.id}", json={"role": "admin"})

    assert stored(connection, SHOPPER) == ("admin", True)


def test_list_is_in_join_order_and_searches_email_in_any_case(session) -> None:
    client = session.as_user(ADMIN)

    everyone = client.get("/admin/users").json()
    found = client.get("/admin/users", params={"email": "shopper@EXAMPLE"}).json()
    none = client.get("/admin/users", params={"email": "nobody"}).json()

    assert [user["email"] for user in everyone] == ["admin@example.com", "Shopper@Example.com"]
    assert [user["email"] for user in found] == ["Shopper@Example.com"]
    assert none == []


def test_list_pages_through_users(session) -> None:
    client = session.as_user(ADMIN)

    first = client.get("/admin/users", params={"limit": 1}).json()
    second = client.get("/admin/users", params={"limit": 1, "offset": 1}).json()

    assert [user["email"] for user in first + second] == [
        "admin@example.com",
        "Shopper@Example.com",
    ]


def test_search_treats_percent_and_underscore_as_plain_characters(session) -> None:
    # They're wildcards in SQL LIKE; the search must not match every email.
    assert session.as_user(ADMIN).get("/admin/users", params={"email": "%"}).json() == []


def test_unknown_user_is_404(session) -> None:
    response = session.as_user(ADMIN).patch(
        "/admin/users/c0000000-0000-4000-8000-000000000003", json={"role": "admin"}
    )

    assert response.status_code == 404
