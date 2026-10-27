"""Store staff roles (migration 016, app/api/staff.py); these skip without TEST_DATABASE_URL.

Workers edit their store's stock; managers also add and remove its workers; admins do both at
every store and are the only ones who make managers. Who may call which endpoint, for every
role, is in test_permissions_audit.py; these check what each change does.
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
from tests.factories import add_product

ADMIN = TokenUser(id=UUID("a0000000-0000-4000-8000-000000000001"), email="admin@example.com")
MANAGER = TokenUser(id=UUID("c0000000-0000-4000-8000-000000000001"), email="manager@example.com")
WORKER = TokenUser(id=UUID("c0000000-0000-4000-8000-000000000002"), email="worker@example.com")
SHOPPER = TokenUser(id=UUID("b0000000-0000-4000-8000-000000000003"), email="Shopper@Example.com")
OTHER = TokenUser(id=UUID("c0000000-0000-4000-8000-000000000004"), email="other@example.com")


class SignedIn:
    """Who the test client's requests come from; change `user` to switch."""

    user: TokenUser = ADMIN


@pytest.fixture
def signed_in() -> SignedIn:
    return SignedIn()


@pytest.fixture
def client(db_url: str, signed_in: SignedIn) -> Iterator[TestClient]:
    app = create_app(load_settings(_env_file=None, database_url=db_url))
    app.dependency_overrides[get_token_user] = lambda: signed_in.user
    with TestClient(app) as client:
        yield client


@pytest.fixture
def stores(client: TestClient, connection: psycopg.Connection) -> dict[str, int]:
    """Everyone signed up (all regular users but the admin), and two stores the admin added."""
    users = UserRepository(connection)
    for person in (ADMIN, MANAGER, WORKER, SHOPPER, OTHER):
        users.get_or_create(person.id, person.email)
    users.update(ADMIN.id, role="admin")
    connection.commit()
    return {
        name: client.post("/admin/stores", json={"name": name}).json()["id"]
        for name in ("Quantico MCX", "Camp Lejeune MCX")
    }


@pytest.fixture
def team(connection: psycopg.Connection, stores: dict[str, int]) -> dict[str, int]:
    """The stores, with the manager and worker at Quantico, and OTHER at Camp Lejeune."""
    users = UserRepository(connection)
    users.update(MANAGER.id, role="manager", store_id=stores["Quantico MCX"])
    users.update(WORKER.id, role="worker", store_id=stores["Quantico MCX"])
    users.update(OTHER.id, role="worker", store_id=stores["Camp Lejeune MCX"])
    connection.commit()
    return stores


def account(connection: psycopg.Connection, person: TokenUser) -> tuple[str, int | None]:
    return connection.execute(
        "SELECT role, store_id FROM users WHERE id = %s", (person.id,)
    ).fetchone()


def latest_audit(connection: psycopg.Connection) -> tuple:
    return connection.execute(
        "SELECT admin_email, action, target_id, changes FROM admin_audit_log ORDER BY id DESC"
    ).fetchone()


# --- The database rule ---


def test_staff_must_have_a_store_and_nobody_else_can(db_url: str, connection) -> None:
    users = UserRepository(connection)
    users.get_or_create(SHOPPER.id, SHOPPER.email)
    connection.commit()

    for sql in (
        "UPDATE users SET role = 'worker' WHERE id = %s",  # staff without a store
        "UPDATE users SET store_id = 1 WHERE id = %s",  # a store for a regular user
    ):
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(sql, (SHOPPER.id,))
        connection.rollback()


# --- Admins assign roles ---


def test_admins_make_managers_and_workers_at_a_store(client, signed_in, team, connection):
    quantico = team["Quantico MCX"]

    response = client.patch(
        f"/admin/users/{SHOPPER.id}", json={"role": "manager", "store_id": quantico}
    )

    assert response.status_code == 200
    assert (response.json()["role"], response.json()["store_id"]) == ("manager", quantico)
    assert latest_audit(connection)[3]["store_id"] == {"from": None, "to": quantico}
    signed_in.user = SHOPPER
    assert client.get("/me").json()["store_id"] == quantico  # on their next request


def test_staff_need_a_store_and_only_staff_have_one(client, team) -> None:
    no_store = client.patch(f"/admin/users/{SHOPPER.id}", json={"role": "worker"})
    store_for_admin = client.patch(
        f"/admin/users/{SHOPPER.id}", json={"role": "admin", "store_id": team["Quantico MCX"]}
    )
    unknown_store = client.patch(
        f"/admin/users/{SHOPPER.id}", json={"role": "worker", "store_id": 999_999}
    )

    too_big = client.patch(f"/admin/users/{SHOPPER.id}", json={"role": "worker", "store_id": 2**31})

    assert too_big.status_code == 422  # beyond a database ID, so not a database error
    assert no_store.status_code == 422 and no_store.json()["code"] == "store_required"
    assert store_for_admin.status_code == 422
    assert store_for_admin.json()["code"] == "store_not_allowed"
    assert unknown_store.status_code == 404 and unknown_store.json()["code"] == "store_not_found"


def test_admins_move_staff_between_stores_and_any_other_role_leaves_the_store(
    client, team, connection
) -> None:
    moved = client.patch(f"/admin/users/{WORKER.id}", json={"store_id": team["Camp Lejeune MCX"]})
    assert account(connection, WORKER) == ("worker", team["Camp Lejeune MCX"])

    promoted = client.patch(f"/admin/users/{WORKER.id}", json={"role": "admin"})

    assert moved.status_code == promoted.status_code == 200
    assert account(connection, WORKER) == ("admin", None)


def test_admins_cant_make_themselves_staff(client, team) -> None:
    response = client.patch(
        f"/admin/users/{ADMIN.id}", json={"role": "manager", "store_id": team["Quantico MCX"]}
    )

    assert response.status_code == 409
    assert response.json()["code"] == "cannot_change_own_account"


# --- Workers edit their store's stock ---


def test_a_worker_sets_stock_at_their_store_and_the_app_shows_it(
    client, signed_in, team, connection
) -> None:
    product_id = add_product(connection)
    connection.commit()
    quantico = team["Quantico MCX"]
    signed_in.user = WORKER

    response = client.put(
        f"/staff/stores/{quantico}/stock/{product_id}",
        json={"in_stock": True, "quantity": 12, "aisle": "Aisle 7"},
    )

    assert response.status_code == 200
    assert response.json()["admin_set_at"] is not None  # automatic updates leave it alone
    shown = client.get(f"/products/{product_id}/availability").json()["stores"]
    assert {row["store"]["name"]: row["in_stock"] for row in shown} == {
        "Quantico MCX": True,
        "Camp Lejeune MCX": False,
    }
    email, action, target, changes = latest_audit(connection)
    assert (email, action, target) == (WORKER.email, "stock.set", str(product_id))
    assert changes["Quantico MCX quantity"] == {"from": None, "to": 12}


def test_a_worker_cant_set_stock_at_another_store(client, signed_in, team, connection) -> None:
    product_id = add_product(connection)
    connection.commit()
    signed_in.user = WORKER

    response = client.put(
        f"/staff/stores/{team['Camp Lejeune MCX']}/stock/{product_id}", json={"in_stock": True}
    )

    assert response.status_code == 403
    assert response.json()["code"] == "not_your_store"
    assert connection.execute("SELECT count(*) FROM product_stock").fetchone() == (0,)


def test_a_worker_hands_stock_back_to_automatic_updates(client, signed_in, team, connection):
    product_id = add_product(connection)
    connection.commit()
    path = f"/staff/stores/{team['Quantico MCX']}/stock/{product_id}"
    signed_in.user = WORKER
    client.put(path, json={"in_stock": False})

    handed_back = client.delete(path)
    again = client.delete(path)

    assert handed_back.status_code == 204
    assert again.status_code == 404 and again.json()["code"] == "admin_stock_not_found"


def test_staff_find_products_by_name_or_barcode_stocked_or_not(
    client, signed_in, team, connection
) -> None:
    chips = add_product(connection)  # "Sample Chips", 036000291452
    connection.execute("INSERT INTO products (barcode, name) VALUES ('012000171741', 'Diet Pepsi')")
    connection.commit()
    quantico = team["Quantico MCX"]
    signed_in.user = WORKER
    client.put(f"/staff/stores/{quantico}/stock/{chips}", json={"in_stock": True, "quantity": 3})

    everything = client.get(f"/staff/stores/{quantico}/stock").json()
    by_name = client.get(f"/staff/stores/{quantico}/stock", params={"q": "pepsi"}).json()
    by_barcode = client.get(f"/staff/stores/{quantico}/stock", params={"q": "036000291452"}).json()

    assert [(row["product"]["name"], row["in_stock"], row["quantity"]) for row in everything] == [
        ("Diet Pepsi", False, None),  # no record at this store yet, so it can be stocked
        ("Sample Chips", True, 3),
    ]
    assert [row["product"]["name"] for row in by_name] == ["Diet Pepsi"]
    assert [row["product"]["id"] for row in by_barcode] == [chips]


# --- Managers manage their store's workers ---


def test_a_manager_adds_a_worker_by_email(client, signed_in, team, connection) -> None:
    signed_in.user = MANAGER

    response = client.post(
        f"/staff/stores/{team['Quantico MCX']}/staff", json={"email": " shopper@example.COM "}
    )

    assert response.status_code == 201
    assert account(connection, SHOPPER) == ("worker", team["Quantico MCX"])
    email, action, target, changes = latest_audit(connection)
    assert (email, action, target) == (MANAGER.email, "user.update", str(SHOPPER.id))
    assert changes["role"] == {"from": "user", "to": "worker"}
    staff = client.get(f"/staff/stores/{team['Quantico MCX']}/staff").json()
    assert [(person["email"], person["role"]) for person in staff] == [
        ("manager@example.com", "manager"),
        ("Shopper@Example.com", "worker"),
        ("worker@example.com", "worker"),
    ]


@pytest.mark.parametrize(
    ("email", "status", "code"),
    [
        ("nobody@example.com", 404, "user_not_found"),  # hasn't signed up
        ("other@example.com", 409, "already_staff"),  # works at another store
        ("admin@example.com", 409, "already_staff"),
    ],
)
def test_a_manager_can_only_add_regular_users(client, signed_in, team, email, status, code) -> None:
    signed_in.user = MANAGER

    response = client.post(f"/staff/stores/{team['Quantico MCX']}/staff", json={"email": email})

    assert response.status_code == status
    assert response.json()["code"] == code


def test_a_deactivated_account_cant_be_added(client, signed_in, team) -> None:
    client.patch(f"/admin/users/{SHOPPER.id}", json={"active": False})
    signed_in.user = MANAGER

    response = client.post(
        f"/staff/stores/{team['Quantico MCX']}/staff", json={"email": SHOPPER.email}
    )

    assert response.status_code == 409 and response.json()["code"] == "account_deactivated"


def test_a_manager_removes_a_worker_who_then_loses_access(
    client, signed_in, team, connection
) -> None:
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    response = client.delete(f"/staff/stores/{quantico}/staff/{WORKER.id}")

    assert response.status_code == 204
    assert account(connection, WORKER) == ("user", None)
    signed_in.user = WORKER
    assert client.get(f"/staff/stores/{quantico}/stock").status_code == 403


def test_a_manager_cant_remove_managers_themselves_or_other_stores_staff(
    client, signed_in, team, connection
) -> None:
    users = UserRepository(connection)
    users.update(SHOPPER.id, role="manager", store_id=team["Quantico MCX"])
    connection.commit()
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    other_manager = client.delete(f"/staff/stores/{quantico}/staff/{SHOPPER.id}")
    themselves = client.delete(f"/staff/stores/{quantico}/staff/{MANAGER.id}")
    other_store = client.delete(f"/staff/stores/{quantico}/staff/{OTHER.id}")

    assert other_manager.status_code == 403 and other_manager.json()["code"] == "admins_only"
    assert themselves.status_code == 409
    assert other_store.status_code == 404 and other_store.json()["code"] == "staff_not_found"
    assert account(connection, SHOPPER) == ("manager", quantico)


def test_admins_remove_managers_too(client, team, connection) -> None:
    response = client.delete(f"/staff/stores/{team['Quantico MCX']}/staff/{MANAGER.id}")

    assert response.status_code == 204
    assert account(connection, MANAGER) == ("user", None)


# --- Stores going away ---


def test_deleting_a_store_makes_its_staff_regular_users(client, team, connection) -> None:
    response = client.delete(f"/admin/stores/{team['Quantico MCX']}")

    assert response.status_code == 204
    assert account(connection, MANAGER) == ("user", None)
    assert account(connection, WORKER) == ("user", None)
    assert account(connection, OTHER) == ("worker", team["Camp Lejeune MCX"])
    assert latest_audit(connection)[3]["staff"] == {"from": 2, "to": 0}
