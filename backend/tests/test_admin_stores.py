"""Admin store and stock management (T094); database tests skip without TEST_DATABASE_URL.

T094 acceptance: when an admin marks a product out of stock at a store, the app shows it as out of
stock there. "The app" is checked through the endpoint its product page reads,
GET /products/{id}/availability. Automatic stock updates (the product monitor, and the simulated
stock script's --reset) must leave stock an admin set alone; the monitor's query is run from its
own file (jobs/product-monitor).
"""

import ast
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.auth import TokenUser, get_token_user
from app.core.config import load_settings
from app.main import create_app
from app.repositories import UserRepository
from scripts.generate_store_stock import generate
from tests.factories import add_product

ADMIN = TokenUser(id=UUID("a0000000-0000-4000-8000-000000000001"), email="admin@example.com")
MONITOR = Path(__file__).resolve().parents[2] / "jobs" / "product-monitor" / "product-monitor.py"


@pytest.fixture
def client(db_url: str, connection: psycopg.Connection) -> Iterator[TestClient]:
    users = UserRepository(connection)
    users.get_or_create(ADMIN.id, ADMIN.email)
    users.update(ADMIN.id, role="admin")
    connection.commit()
    app = create_app(load_settings(_env_file=None, database_url=db_url))
    app.dependency_overrides[get_token_user] = lambda: ADMIN
    with TestClient(app) as client:
        yield client


@pytest.fixture
def setup(client: TestClient, connection: psycopg.Connection) -> dict:
    """A product, two stores, and the product in stock at both (as automatic updates set it)."""
    product_id = add_product(connection)
    lejeune = client.post("/admin/stores", json={"name": "Camp Lejeune MCX"}).json()
    quantico = client.post("/admin/stores", json={"name": "Quantico MCX"}).json()
    for store in (lejeune, quantico):
        connection.execute(
            "INSERT INTO product_stock (product_id, store_id, in_stock, quantity, aisle) "
            "VALUES (%s, %s, TRUE, 12, 'Aisle 7')",
            (product_id, store["id"]),
        )
    connection.commit()
    return {"product_id": product_id, "lejeune": lejeune, "quantico": quantico}


def shown_in_app(client: TestClient, product_id: int) -> dict[str, dict]:
    """Each store's stock as the app's product page gets it, by store slug."""
    availability = client.get(f"/products/{product_id}/availability").json()
    return {row["store"]["slug"]: row for row in availability["stores"]}


def stock_row(connection: psycopg.Connection, product_id: int, store_id: int) -> dict | None:
    connection.commit()
    with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
        return cursor.execute(
            "SELECT in_stock, quantity, aisle, admin_set_at FROM product_stock "
            "WHERE product_id = %s AND store_id = %s",
            (product_id, store_id),
        ).fetchone()


def last_audit_entry(connection: psycopg.Connection) -> dict:
    connection.commit()
    with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
        return cursor.execute(
            "SELECT admin_id, action, target_type, target_id, changes FROM admin_audit_log "
            "ORDER BY id DESC LIMIT 1"
        ).fetchone()


def set_stock(client: TestClient, setup: dict, store: str, body: dict):
    return client.put(
        f"/admin/products/{setup['product_id']}/stock/{setup[store]['id']}", json=body
    )


# --- The acceptance criterion ---


def test_marked_out_of_stock_at_a_store_shows_out_of_stock_there(client, setup) -> None:
    response = set_stock(client, setup, "lejeune", {"in_stock": False})

    assert response.status_code == 200
    shown = shown_in_app(client, setup["product_id"])
    assert shown["camp-lejeune-mcx"]["in_stock"] is False
    assert shown["camp-lejeune-mcx"]["quantity"] is None  # no longer known
    assert shown["quantico-mcx"]["in_stock"] is True  # other stores unchanged
    assert shown["quantico-mcx"]["quantity"] == 12


def test_a_store_with_no_record_can_be_set(client, setup, connection) -> None:
    product_id = add_product(connection, barcode="012000171741")
    connection.commit()

    client.put(
        f"/admin/products/{product_id}/stock/{setup['quantico']['id']}",
        json={"in_stock": True, "quantity": 3},
    )

    assert shown_in_app(client, product_id)["quantico-mcx"]["quantity"] == 3


def test_quantity_and_aisle_and_an_aisle_not_sent_is_kept(client, setup, connection) -> None:
    set_stock(client, setup, "lejeune", {"in_stock": True, "quantity": 5, "aisle": "Aisle 2"})
    set_stock(client, setup, "lejeune", {"in_stock": True, "quantity": 4})  # aisle not sent

    row = stock_row(connection, setup["product_id"], setup["lejeune"]["id"])
    assert (row["in_stock"], row["quantity"], row["aisle"]) == (True, 4, "Aisle 2")


@pytest.mark.parametrize(
    "body",
    [
        {"in_stock": False, "quantity": 3},  # contradicts in_stock
        {"in_stock": True, "quantity": 0},
        {"in_stock": "no"},  # only true or false
        {"quantity": 2},  # in_stock is required
        {"in_stock": True, "quantity": -1},
        {"in_stock": True, "shelf": "top"},  # unknown field
    ],
)
def test_invalid_stock_is_422(client, setup, body) -> None:
    assert set_stock(client, setup, "lejeune", body).status_code == 422


def test_unknown_product_or_store_is_404(client, setup) -> None:
    store_id = setup["lejeune"]["id"]

    no_product = client.put(f"/admin/products/999/stock/{store_id}", json={"in_stock": False})
    no_store = client.put(
        f"/admin/products/{setup['product_id']}/stock/999", json={"in_stock": False}
    )

    assert no_product.json()["code"] == "product_not_found"
    assert no_store.json()["code"] == "store_not_found"


def test_admins_see_which_stores_an_admin_set(client, setup) -> None:
    set_stock(client, setup, "lejeune", {"in_stock": False})

    stock = client.get(f"/admin/products/{setup['product_id']}/stock").json()

    set_by_admin = {
        row["store"]["slug"]: row["admin_set_at"] is not None for row in stock["stores"]
    }
    assert set_by_admin == {"camp-lejeune-mcx": True, "quantico-mcx": False}
    # The public availability doesn't say who set it.
    assert "admin_set_at" not in shown_in_app(client, setup["product_id"])["camp-lejeune-mcx"]


# --- Automatic updates leave it alone ---


def monitor_query(name: str) -> str:
    """A SQL constant from the monitor's own file, read without importing it."""
    tree = ast.parse(MONITOR.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == name:
            return ast.literal_eval(node.value)
    raise AssertionError(f"{name} isn't in {MONITOR}")


def monitor_saves_stock(connection, product_id: int, store_slug: str, in_stock: bool) -> int:
    """What the monitor does after reading a store's page; returns rows written."""
    connection.commit()
    cursor = connection.execute(
        monitor_query("UPSERT_STOCK"),
        {
            "product_id": product_id,
            "store": store_slug,
            "in_stock": in_stock,
            "quantity": 20 if in_stock else 0,
            "updated_at": datetime.now(UTC).isoformat(),  # text, as the monitor sends it
        },
    )
    written = cursor.rowcount
    connection.commit()
    return written


def test_monitor_doesnt_undo_an_admins_out_of_stock(client, setup, connection) -> None:
    set_stock(client, setup, "lejeune", {"in_stock": False})

    written = monitor_saves_stock(connection, setup["product_id"], "camp-lejeune-mcx", True)

    assert written == 0
    assert shown_in_app(client, setup["product_id"])["camp-lejeune-mcx"]["in_stock"] is False
    # The monitor tells "an admin set it" apart from "no such store" with this query.
    assert connection.execute(monitor_query("STORE_EXISTS"), ("camp-lejeune-mcx",)).fetchone()


def test_monitor_still_updates_stores_no_admin_set(client, setup, connection) -> None:
    set_stock(client, setup, "lejeune", {"in_stock": False})

    monitor_saves_stock(connection, setup["product_id"], "quantico-mcx", False)

    assert shown_in_app(client, setup["product_id"])["quantico-mcx"]["in_stock"] is False


def test_simulated_stock_reset_keeps_an_admins_stock(client, setup, connection) -> None:
    set_stock(client, setup, "lejeune", {"in_stock": False})

    generate(connection, reset=True)
    connection.commit()

    row = stock_row(connection, setup["product_id"], setup["lejeune"]["id"])
    assert (row["in_stock"], row["admin_set_at"] is not None) == (False, True)


def test_removing_the_admins_setting_hands_the_store_back(client, setup, connection) -> None:
    set_stock(client, setup, "lejeune", {"in_stock": False, "aisle": "Aisle 3"})
    path = f"/admin/products/{setup['product_id']}/stock/{setup['lejeune']['id']}"

    assert client.delete(path).status_code == 204
    # The values stay (the app still shows out of stock) until the monitor's next update.
    row = stock_row(connection, setup["product_id"], setup["lejeune"]["id"])
    assert (row["in_stock"], row["aisle"], row["admin_set_at"]) == (False, "Aisle 3", None)
    assert monitor_saves_stock(connection, setup["product_id"], "camp-lejeune-mcx", True) == 1
    assert shown_in_app(client, setup["product_id"])["camp-lejeune-mcx"]["in_stock"] is True

    # Only an admin's setting can be removed this way.
    again = client.delete(path)
    assert (again.status_code, again.json()["code"]) == (404, "admin_stock_not_found")


# --- Stores ---


def test_adding_a_store_makes_a_slug_and_it_appears_in_the_app(client) -> None:
    response = client.post(
        "/admin/stores", json={"name": " Camp Pendleton MCX ", "address": "Bldg. 1"}
    )

    assert response.status_code == 201
    assert (response.json()["slug"], response.json()["name"]) == (
        "camp-pendleton-mcx",
        "Camp Pendleton MCX",
    )
    assert "camp-pendleton-mcx" in [store["slug"] for store in client.get("/locations").json()]


def test_store_slug_rules(client, setup) -> None:
    taken = client.post("/admin/stores", json={"name": "Camp Lejeune MCX"})
    no_letters = client.post("/admin/stores", json={"name": "!!!"})
    bad_slug = client.post("/admin/stores", json={"name": "Okinawa", "slug": "Not A Slug"})
    renamed_to_taken = client.patch(
        f"/admin/stores/{setup['quantico']['id']}", json={"slug": "camp-lejeune-mcx"}
    )

    assert (taken.status_code, taken.json()["code"]) == (409, "slug_taken")
    assert (no_letters.status_code, no_letters.json()["code"]) == (422, "slug_required")
    assert bad_slug.status_code == 422
    assert renamed_to_taken.status_code == 409


def test_a_slug_made_from_a_long_name_fits_the_slug_limit(client) -> None:
    store = client.post("/admin/stores", json={"name": "Marine Corps Exchange " * 9}).json()

    assert len(store["slug"]) <= 100
    assert not store["slug"].endswith("-")
    renamed = client.patch(f"/admin/stores/{store['id']}", json={"slug": store["slug"]})
    assert renamed.status_code == 200  # an admin can send it back as is


def test_editing_a_store_changes_only_what_was_sent(client, setup) -> None:
    store_id = setup["quantico"]["id"]

    response = client.patch(f"/admin/stores/{store_id}", json={"address": "Bldg. 2"})

    assert response.json() == {
        "id": store_id,
        "name": "Quantico MCX",
        "slug": "quantico-mcx",
        "address": "Bldg. 2",
    }


@pytest.mark.parametrize("body", [{}, {"name": None}, {"name": ""}, {"phone": "555"}])
def test_invalid_store_edits_are_422(client, setup, body) -> None:
    assert client.patch(f"/admin/stores/{setup['quantico']['id']}", json=body).status_code == 422


def test_deleting_a_store_removes_it_and_its_stock_from_the_app(client, setup, connection):
    response = client.delete(f"/admin/stores/{setup['lejeune']['id']}")

    assert response.status_code == 204
    assert set(shown_in_app(client, setup["product_id"])) == {"quantico-mcx"}
    assert stock_row(connection, setup["product_id"], setup["lejeune"]["id"]) is None


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
def test_unknown_store_is_404(client, method) -> None:
    response = client.request(method, "/admin/stores/999", json={"name": "Nowhere"})

    assert (response.status_code, response.json()["code"]) == (404, "store_not_found")


# --- Audit log (T083) ---


def test_setting_stock_is_logged_by_store(client, setup, connection) -> None:
    set_stock(client, setup, "lejeune", {"in_stock": False})

    entry = last_audit_entry(connection)
    assert (entry["admin_id"], entry["action"], entry["target_type"]) == (
        ADMIN.id,
        "stock.set",
        "product",
    )
    assert entry["target_id"] == str(setup["product_id"])
    assert entry["changes"] == {
        "Camp Lejeune MCX in_stock": {"from": True, "to": False},
        "Camp Lejeune MCX quantity": {"from": 12, "to": None},
    }


def test_removing_stock_is_logged(client, setup, connection) -> None:
    set_stock(client, setup, "lejeune", {"in_stock": False})

    client.delete(f"/admin/products/{setup['product_id']}/stock/{setup['lejeune']['id']}")

    entry = last_audit_entry(connection)
    assert entry["action"] == "stock.clear"
    assert entry["changes"] == {"Camp Lejeune MCX set_by_admin": {"from": True, "to": None}}


def test_store_changes_are_logged(client, setup, connection) -> None:
    store_id = setup["quantico"]["id"]
    created = last_audit_entry(connection)  # setup added Quantico last

    client.patch(f"/admin/stores/{store_id}", json={"name": "MCB Quantico MCX"})
    updated = last_audit_entry(connection)
    client.delete(f"/admin/stores/{store_id}")
    deleted = last_audit_entry(connection)

    assert (created["action"], created["changes"]["slug"]) == (
        "store.create",
        {"from": None, "to": "quantico-mcx"},
    )
    assert (updated["action"], updated["changes"]) == (
        "store.update",
        {"name": {"from": "Quantico MCX", "to": "MCB Quantico MCX"}},
    )
    assert deleted["action"] == "store.delete"
    assert deleted["target_id"] == str(store_id)
    assert deleted["changes"]["stock_records"] == {"from": 1, "to": 0}
