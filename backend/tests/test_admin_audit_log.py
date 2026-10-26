"""The admin audit log against a real database (skipped without TEST_DATABASE_URL).

T083 acceptance: when an admin makes any change, the log records who, what, and when. Each admin
endpoint that changes something has a test here, and test_every_admin_change_is_audited fails if
a new one is added without one, so no admin change can go unlogged.
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.auth import TokenUser, get_token_user
from app.core.config import load_settings
from app.core.database import DbConnection
from app.main import create_app
from app.repositories import AuditLogRepository, UserRepository
from app.repositories.audit_log import get_audit_log_repository
from tests.conftest import VALID_DATABASE_URL, VALID_SUPABASE_URL
from tests.factories import add_price, add_product

ADMIN = TokenUser(id=UUID("a0000000-0000-4000-8000-000000000001"), email="admin@example.com")
ALICE = TokenUser(id=UUID("b0000000-0000-4000-8000-000000000002"), email="alice@example.com")

# Every admin endpoint that changes something, each tested below.
AUDITED_ROUTES = {
    ("POST", "/admin/products"),
    ("PATCH", "/admin/products/{product_id}"),
    ("DELETE", "/admin/products/{product_id}"),
    ("PATCH", "/admin/users/{user_id}"),
    ("PATCH", "/admin/reviews/{review_id}"),
    ("DELETE", "/admin/reviews/{review_id}"),
    ("PUT", "/admin/products/{product_id}/stock/{store_id}"),
    ("DELETE", "/admin/products/{product_id}/stock/{store_id}"),
    ("POST", "/admin/stores"),
    ("PATCH", "/admin/stores/{store_id}"),
    ("DELETE", "/admin/stores/{store_id}"),
}


def test_every_admin_change_is_audited() -> None:
    # Doesn't need a database: it reads the app's routes, the same way test_admin_access does.
    app = create_app(
        load_settings(
            _env_file=None, database_url=VALID_DATABASE_URL, supabase_url=VALID_SUPABASE_URL
        )
    )
    changing_routes = {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.startswith("/admin")
        for method in operations
        if method != "get"
    }

    missing = changing_routes - AUDITED_ROUTES
    assert not missing, f"admin routes with no audit log test (add one here): {sorted(missing)}"


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
    for user in (ADMIN, ALICE):
        users.get_or_create(user.id, user.email)
    users.update(ADMIN.id, role="admin")
    connection.commit()

    app = create_app(load_settings(_env_file=None, database_url=db_url))
    with TestClient(app) as client:
        session = Session(client)
        app.dependency_overrides[get_token_user] = lambda: session.user
        yield session


@pytest.fixture
def client(session: Session) -> TestClient:
    return session.client


def log(connection: psycopg.Connection) -> list[dict]:
    """Every audit log entry, oldest first."""
    connection.commit()  # end this connection's snapshot, so it sees what the API committed
    entries = AuditLogRepository(connection).list_entries(limit=100)
    return [entry.model_dump() for entry in reversed(entries)]


def assert_logged(entry: dict, action: str, target_type: str, target_id: object) -> None:
    """Who (the admin), what (action and target), and when (just now)."""
    assert (entry["admin_id"], entry["admin_email"]) == (ADMIN.id, ADMIN.email)
    assert (entry["action"], entry["target_type"]) == (action, target_type)
    assert entry["target_id"] == str(target_id)
    assert abs(datetime.now(UTC) - entry["created_at"]) < timedelta(minutes=1)


# --- Products ---


def test_creating_a_product_is_logged(client, connection) -> None:
    body = {"barcode": "049000418347", "name": "Coke", "size": "16.9 fl oz", "price": "1.95"}
    product = client.post("/admin/products", json=body).json()

    [entry] = log(connection)
    assert_logged(entry, "product.create", "product", product["id"])
    assert entry["changes"] == {
        "barcode": {"from": None, "to": "049000418347"},
        "name": {"from": None, "to": "Coke"},
        "size": {"from": None, "to": "16.9 fl oz"},
        "price": {"from": None, "to": "1.95"},  # an exact string, not a float
        # The fields the admin set, which the product sync now leaves alone (T089).
        "admin_fields": {"from": None, "to": ["barcode", "name", "price", "size"]},
    }


def test_editing_a_product_logs_only_what_changed(client, connection) -> None:
    product_id = add_product(connection)  # Sample Chips, 184g, no price
    connection.commit()

    change = {"name": "Classic Chips", "size": "184g", "price": "2.49"}
    client.patch(f"/admin/products/{product_id}", json=change)

    [entry] = log(connection)
    assert_logged(entry, "product.update", "product", product_id)
    assert entry["changes"] == {
        "name": {"from": "Sample Chips", "to": "Classic Chips"},
        "price": {"from": None, "to": "2.49"},
        # Every field sent is now protected from the sync, size included (T089).
        "admin_fields": {"from": None, "to": ["name", "price", "size"]},
    }  # size was sent but didn't change


def test_an_edit_that_changes_nothing_is_still_logged(client, connection) -> None:
    product_id = add_product(connection)
    connection.commit()
    client.patch(f"/admin/products/{product_id}", json={"name": "Sample Chips"})

    client.patch(f"/admin/products/{product_id}", json={"name": "Sample Chips"})  # again

    first, second = log(connection)
    # The first edit only protected the name from the sync (T089); the second changed nothing.
    assert first["changes"] == {"admin_fields": {"from": None, "to": ["name"]}}
    assert_logged(second, "product.update", "product", product_id)
    assert second["changes"] == {}


def test_deleting_a_product_logs_what_was_deleted(client, connection) -> None:
    product_id = add_product(connection)
    add_price(connection, product_id, "2.49", "2026-10-01")
    add_price(connection, product_id, "2.99", "2026-10-02")
    connection.execute(
        "INSERT INTO ratings (product_id, user_id, stars) VALUES (%s, %s, 4)",
        (product_id, ALICE.id),
    )
    connection.commit()

    client.delete(f"/admin/products/{product_id}")

    [entry] = log(connection)
    assert_logged(entry, "product.delete", "product", product_id)
    assert entry["changes"]["name"] == {"from": "Sample Chips", "to": None}
    assert entry["changes"]["barcode"] == {"from": "036000291452", "to": None}
    assert entry["changes"]["price"] == {"from": "2.99", "to": None}
    # What went with it. No reviews, so that count isn't listed.
    assert entry["changes"]["prices"] == {"from": 2, "to": 0}
    assert entry["changes"]["ratings"] == {"from": 1, "to": 0}
    assert "reviews" not in entry["changes"]


def test_saving_the_price_a_product_already_has_adds_no_price_or_change(client, connection) -> None:
    product_id = add_product(connection)
    add_price(connection, product_id, "2.49", "2026-10-01")
    connection.commit()

    client.patch(f"/admin/products/{product_id}", json={"price": "2.49"})

    connection.commit()
    (prices,) = connection.execute(
        "SELECT count(*) FROM prices WHERE product_id = %s", (product_id,)
    ).fetchone()
    assert prices == 1
    [entry] = log(connection)
    # No new price, but the price is now protected from the sync (T089).
    assert entry["changes"] == {"admin_fields": {"from": None, "to": ["price"]}}


# --- Users ---


def test_changing_a_users_role_and_status_is_logged(client, connection) -> None:
    client.patch(f"/admin/users/{ALICE.id}", json={"role": "admin", "active": False})

    [entry] = log(connection)
    assert_logged(entry, "user.update", "user", ALICE.id)
    assert entry["changes"] == {
        "role": {"from": "user", "to": "admin"},
        "active": {"from": True, "to": False},
    }


# --- Reviews ---


@pytest.fixture
def review_id(session: Session, connection: psycopg.Connection) -> int:
    product_id = add_product(connection)
    connection.commit()
    response = session.as_user(ALICE).post(
        f"/products/{product_id}/reviews", json={"title": "Meh", "body": "Not for me."}
    )
    session.user = ADMIN
    return response.json()["id"]


def test_hiding_and_showing_a_review_are_logged(client, connection, review_id) -> None:
    client.patch(f"/admin/reviews/{review_id}", json={"hidden": True})
    client.patch(f"/admin/reviews/{review_id}", json={"hidden": False})

    hide, show = log(connection)
    assert_logged(hide, "review.hide", "review", review_id)
    assert hide["changes"] == {"hidden": {"from": False, "to": True}}
    assert_logged(show, "review.show", "review", review_id)
    assert show["changes"] == {"hidden": {"from": True, "to": False}}


def test_deleting_a_review_logs_what_it_said_and_who_wrote_it(
    client, connection, review_id
) -> None:
    client.delete(f"/admin/reviews/{review_id}")

    [entry] = log(connection)
    assert_logged(entry, "review.delete", "review", review_id)
    assert entry["changes"]["author_email"] == {"from": "alice@example.com", "to": None}
    assert entry["changes"]["body"] == {"from": "Not for me.", "to": None}
    assert entry["changes"]["title"] == {"from": "Meh", "to": None}


# --- Only real changes are logged, and never without their entry ---


def test_refused_and_failed_changes_are_not_logged(session, connection) -> None:
    add_product(connection)  # takes barcode 036000291452
    connection.commit()
    client = session.client

    client.post("/admin/products", json={"barcode": "036000291452", "name": "Copy"})  # 409
    client.patch("/admin/products/999", json={"name": "Nothing"})  # 404
    client.delete("/admin/reviews/999")  # 404
    client.patch(f"/admin/users/{ADMIN.id}", json={"role": "user"})  # 409: can't demote self
    client.patch(f"/admin/users/{ALICE.id}", json={})  # 422
    session.as_user(ALICE).delete("/admin/products/1")  # 403: not an admin

    assert log(connection) == []


class BrokenAuditLog(AuditLogRepository):
    """Uses the request's connection like the real one, but fails when asked to record."""

    def record(self, **entry) -> None:
        raise RuntimeError("the audit log can't be written")


def broken_audit_log(db: DbConnection) -> BrokenAuditLog:
    return BrokenAuditLog(db)


def test_a_change_isnt_saved_if_its_log_entry_cant_be(session, connection) -> None:
    # The entry is written in the same transaction as the change, so if writing it fails, the
    # change is rolled back too: nothing an admin does can happen without being logged.
    app = session.client.app
    app.dependency_overrides[get_audit_log_repository] = broken_audit_log
    failing = TestClient(app, raise_server_exceptions=False)  # return the 500, don't raise

    response = failing.post("/admin/products", json={"barcode": "049000418347", "name": "Coke"})
    app.dependency_overrides.pop(get_audit_log_repository)

    assert response.status_code == 500
    assert session.client.get("/products/barcode/049000418347").status_code == 404
    assert log(connection) == []


def test_log_keeps_who_it_was_after_the_admins_account_is_deleted(client, connection) -> None:
    client.patch(f"/admin/users/{ALICE.id}", json={"role": "admin"})

    connection.execute("DELETE FROM users WHERE id = %s", (ADMIN.id,))
    connection.commit()

    [entry] = log(connection)
    assert (entry["admin_id"], entry["admin_email"]) == (None, ADMIN.email)


# --- Reading the log ---


def test_admins_read_the_log_newest_first_and_filter_it(client, connection) -> None:
    first = client.post("/admin/products", json={"barcode": "049000418347", "name": "A"}).json()
    second = client.post("/admin/products", json={"barcode": "012000171741", "name": "B"}).json()
    client.patch(f"/admin/products/{first['id']}", json={"name": "A2"})
    client.patch(f"/admin/users/{ALICE.id}", json={"role": "admin"})

    everything = client.get("/admin/audit-log").json()
    one_product = client.get(
        "/admin/audit-log", params={"target_type": "product", "target_id": first["id"]}
    ).json()
    creates = client.get("/admin/audit-log", params={"action": "product.create"}).json()
    by_admin = client.get("/admin/audit-log", params={"admin_id": str(ADMIN.id)}).json()
    page = client.get("/admin/audit-log", params={"limit": 1, "offset": 1}).json()

    assert [e["action"] for e in everything] == [
        "user.update",
        "product.update",
        "product.create",
        "product.create",
    ]
    assert [e["action"] for e in one_product] == ["product.update", "product.create"]
    assert [e["target_id"] for e in creates] == [str(second["id"]), str(first["id"])]
    assert len(by_admin) == 4
    assert [e["action"] for e in page] == ["product.update"]
    assert everything[0]["admin_email"] == ADMIN.email


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"admin_id": "not-a-uuid"}])
def test_bad_log_filters_are_422(client, params) -> None:
    assert client.get("/admin/audit-log", params=params).status_code == 422


def test_regular_users_cant_read_the_log(session) -> None:
    assert session.as_user(ALICE).get("/admin/audit-log").status_code == 403
