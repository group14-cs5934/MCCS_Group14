"""Restock alerts (migration 020, app/api/restock.py); these skip without TEST_DATABASE_URL.

Uses test_store_staff.py's stores and people: MANAGER is Quantico's Manager (who has the restock
permissions from the start), WORKER a Worker there (who doesn't). Who may call which endpoint is
in test_permissions_audit.py; the numbers themselves in test_restock_stats.py.
"""

import psycopg
import pytest

from scripts.migrate import MIGRATIONS_DIR
from tests import test_store_staff as store_staff
from tests.factories import add_product
from tests.test_store_staff import MANAGER, SHOPPER, WORKER, latest_audit

# test_store_staff.py's fixtures, so tests here can use them by name.
client, signed_in = store_staff.client, store_staff.signed_in
stores, team = store_staff.stores, store_staff.team


def set_stock(connection, product_id: int, store_id: int, in_stock: bool, quantity: int | None):
    connection.execute(
        "INSERT INTO product_stock (product_id, store_id, in_stock, quantity) "
        "VALUES (%s, %s, %s, %s) ON CONFLICT (product_id, store_id) "
        "DO UPDATE SET in_stock = EXCLUDED.in_stock, quantity = EXCLUDED.quantity",
        (product_id, store_id, in_stock, quantity),
    )
    connection.commit()


def add_named_product(connection, name: str, barcode: str) -> int:
    (product_id,) = connection.execute(
        "INSERT INTO products (barcode, name) VALUES (%s, %s) RETURNING id", (barcode, name)
    ).fetchone()
    connection.commit()
    return product_id


@pytest.fixture
def shelf(connection, team) -> dict[str, int]:
    """At Quantico: chips out of stock, soda low (3, default reorder point 5), water fine (40),
    and gum with an unknown quantity."""
    quantico = team["Quantico MCX"]
    products = {
        "chips": add_product(connection),
        "soda": add_named_product(connection, "Cola 12 oz", "012000001291"),
        "water": add_named_product(connection, "Spring Water", "012000001307"),
        "gum": add_named_product(connection, "Mint Gum", "012000001314"),
    }
    set_stock(connection, products["chips"], quantico, False, 0)
    set_stock(connection, products["soda"], quantico, True, 3)
    set_stock(connection, products["water"], quantico, True, 40)
    set_stock(connection, products["gum"], quantico, True, None)
    return products


# --- The stock history and the activity counts ---


def test_every_stock_change_is_recorded_however_its_made(client, signed_in, team, connection):
    product_id = add_product(connection)
    quantico = team["Quantico MCX"]
    set_stock(connection, product_id, quantico, True, 10)  # e.g. the product monitor
    set_stock(connection, product_id, quantico, True, 10)  # no change: nothing recorded
    signed_in.user = WORKER
    client.put(f"/staff/stores/{quantico}/stock/{product_id}", json={"in_stock": False})

    events = connection.execute(
        "SELECT in_stock, quantity FROM stock_events WHERE product_id = %s ORDER BY id",
        (product_id,),
    ).fetchall()

    assert events == [(True, 10), (False, None)]


def test_views_and_scans_are_counted_per_store_and_day(client, team, connection) -> None:
    product_id = add_product(connection)
    connection.commit()
    quantico = team["Quantico MCX"]
    client.headers.clear()  # no sign-in needed

    for body in (
        {"kind": "view", "store_id": quantico},
        {"kind": "view", "store_id": quantico},
        {"kind": "scan", "store_id": quantico},
        {"kind": "view"},  # no store picked
    ):
        assert client.post(f"/products/{product_id}/activity", json=body).status_code == 204
    unknown_product = client.post("/products/999999/activity", json={"kind": "view"})
    unknown_store = client.post(
        f"/products/{product_id}/activity", json={"kind": "view", "store_id": 999_999}
    )

    rows = connection.execute(
        "SELECT store_id, views, scans FROM product_activity WHERE product_id = %s "
        "ORDER BY store_id NULLS LAST",
        (product_id,),
    ).fetchall()
    assert rows == [(quantico, 2, 1), (None, 1, 0)]
    assert unknown_product.status_code == 404
    assert unknown_store.status_code == 404 and unknown_store.json()["code"] == "store_not_found"


# --- What's low or out ---


def test_the_badge_counts_whats_out_and_low(client, signed_in, shelf, team) -> None:
    signed_in.user = MANAGER

    response = client.get(f"/staff/stores/{team['Quantico MCX']}/restock/summary")

    assert response.status_code == 200
    assert response.json() == {"out": 1, "low": 1, "open_requests": 0, "default_reorder_point": 5}


def test_the_list_puts_out_first_then_the_most_popular(client, signed_in, shelf, team, connection):
    quantico = team["Quantico MCX"]
    cola = add_named_product(connection, "Diet Cola", "012000001321")
    set_stock(connection, cola, quantico, True, 2)
    # Diet Cola is viewed far more than anything else at Quantico, so it's popular.
    connection.execute(
        "INSERT INTO product_activity (product_id, store_id, views, scans) "
        "VALUES (%s, %s, 40, 10), (%s, %s, 1, 0)",
        (cola, quantico, shelf["soda"], quantico),
    )
    connection.commit()
    signed_in.user = MANAGER

    items = client.get(f"/staff/stores/{quantico}/restock").json()
    only_low = client.get(f"/staff/stores/{quantico}/restock", params={"status": "low"}).json()

    assert [(i["product"]["name"], i["status"], i["stats"]["popular"]) for i in items] == [
        ("Sample Chips", "out", False),
        ("Diet Cola", "low", True),
        ("Cola 12 oz", "low", False),
    ]
    assert items[1]["stats"]["views_30d"] == 40 and items[1]["stats"]["scans_30d"] == 10
    assert items[1]["advice"] == "Popular: consider ordering extra."
    assert [i["product"]["name"] for i in only_low] == ["Diet Cola", "Cola 12 oz"]


def test_running_out_shows_in_the_stats(client, signed_in, shelf, team, connection) -> None:
    quantico = team["Quantico MCX"]
    for in_stock, quantity in [(True, 20), (True, 8), (False, 0), (True, 3)]:
        set_stock(connection, shelf["soda"], quantico, in_stock, quantity)
    signed_in.user = MANAGER

    soda = next(
        item
        for item in client.get(f"/staff/stores/{quantico}/restock").json()
        if item["product"]["id"] == shelf["soda"]
    )

    assert soda["stats"]["stockouts_30d"] == 1
    assert soda["stats"]["sold_per_day"] is not None and soda["stats"]["sold_per_day"] > 0


def test_a_products_own_reorder_point_wins_over_the_stores(client, signed_in, shelf, team):
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER
    url = f"/staff/stores/{quantico}/restock"

    own = client.put(f"{url}/{shelf['water']}/reorder-point", json={"reorder_point": 50})
    after_own = client.get(f"{url}/summary").json()
    default = client.put(f"{url}/settings", json={"default_reorder_point": 2})
    back = client.put(f"{url}/{shelf['water']}/reorder-point", json={"reorder_point": None})

    assert own.json() == {"reorder_point": 50, "reorder_point_is_default": False}
    assert (after_own["out"], after_own["low"]) == (1, 2)  # water (40 <= 50) is low now
    assert default.json()["low"] == 1  # soda (3) isn't low at 2, water still is at 50
    assert back.json() == {"reorder_point": 2, "reorder_point_is_default": True}


# --- Reorder requests ---


def test_a_request_is_recorded_and_closes_once_restocked(
    client, signed_in, shelf, team, connection
) -> None:
    quantico = team["Quantico MCX"]
    url = f"/staff/stores/{quantico}/restock/{shelf['soda']}/requests"
    signed_in.user = MANAGER

    created = client.post(url, json={"quantity": 24, "note": " Before Friday "})
    twice = client.post(url, json={"quantity": 30})
    listed = client.get(f"/staff/stores/{quantico}/restock").json()
    set_stock(connection, shelf["soda"], quantico, True, 27)  # the delivery came in
    open_after = client.get(f"/staff/stores/{quantico}/restock/requests").json()
    every = client.get(
        f"/staff/stores/{quantico}/restock/requests", params={"status": "all"}
    ).json()

    assert created.status_code == 201
    assert {key: created.json()[key] for key in ("quantity", "note", "status", "requested_by")} == {
        "quantity": 24,
        "note": "Before Friday",
        "status": "open",
        "requested_by": MANAGER.email,
    }
    email, action, _, changes = latest_audit(connection)
    assert (email, action, changes["quantity"]) == (MANAGER.email, "restock.request", 24)
    assert twice.status_code == 409 and twice.json()["code"] == "restock_already_requested"
    soda = next(item for item in listed if item["product"]["id"] == shelf["soda"])
    assert soda["last_request"]["status"] == "open"
    assert open_after == []
    assert [(r["status"], r["closed_at"] is not None) for r in every] == [("restocked", True)]


def test_an_open_request_can_be_cancelled(client, signed_in, shelf, team) -> None:
    quantico = team["Quantico MCX"]
    url = f"/staff/stores/{quantico}/restock/{shelf['chips']}/requests"
    signed_in.user = MANAGER
    client.post(url, json={"quantity": 12})

    cancelled = client.delete(f"{url}/open")
    again = client.delete(f"{url}/open")
    new = client.post(url, json={"quantity": 18})

    assert cancelled.status_code == 204
    assert again.status_code == 404 and again.json()["code"] == "no_open_request"
    assert new.status_code == 201  # cancelling frees the product for a new request


def test_workers_dont_see_restock_alerts_until_their_role_allows_it(
    client, signed_in, shelf, team, connection
) -> None:
    quantico = team["Quantico MCX"]
    signed_in.user = WORKER
    before = client.get(f"/staff/stores/{quantico}/restock/summary")
    connection.execute(
        "UPDATE store_roles SET permissions = '{edit_stock,view_restock}' "
        "WHERE store_id = %s AND name = 'Worker'",
        (quantico,),
    )
    connection.commit()

    after = client.get(f"/staff/stores/{quantico}/restock/summary")
    request = client.post(
        f"/staff/stores/{quantico}/restock/{shelf['chips']}/requests", json={"quantity": 5}
    )

    assert before.status_code == 403 and before.json()["code"] == "missing_permission"
    assert after.status_code == 200
    assert request.status_code == 403  # seeing isn't requesting


# --- The migration ---


def test_roles_that_could_do_everything_get_the_restock_permissions(connection, stores) -> None:
    quantico = stores["Quantico MCX"]
    connection.execute(
        "INSERT INTO store_roles (store_id, name, permissions) VALUES "
        "(%s, 'Owner', '{edit_stock,view_staff,manage_staff,manage_roles,edit_store_info}'), "
        "(%s, 'Cashier', '{edit_stock}')",
        (quantico, quantico),
    )
    migration = (MIGRATIONS_DIR / "020_add_restock_alerts.sql").read_text(encoding="utf-8")

    connection.execute(migration)  # again, as for a store that had these roles before 020

    roles = dict(
        connection.execute(
            "SELECT name, permissions FROM store_roles WHERE store_id = %s", (quantico,)
        ).fetchall()
    )
    assert roles["Owner"][-2:] == ["view_restock", "request_restock"]
    assert roles["Cashier"] == ["edit_stock"]
    assert roles["Manager"].count("view_restock") == 1  # not added twice


def test_a_closed_request_needs_a_closing_time(connection, shelf, team) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        connection.execute(
            "INSERT INTO restock_requests (product_id, store_id, quantity, status) "
            "VALUES (%s, %s, 1, 'cancelled')",
            (shelf["chips"], team["Quantico MCX"]),
        )


def test_shoppers_get_nothing_from_the_restock_endpoints(client, signed_in, team) -> None:
    signed_in.user = SHOPPER

    response = client.get(f"/staff/stores/{team['Quantico MCX']}/restock")

    assert response.status_code == 403 and response.json()["code"] == "forbidden"


def test_only_low_out_or_not_yet_stocked_products_can_be_requested(
    client, signed_in, shelf, team, connection
) -> None:
    quantico = team["Quantico MCX"]
    new_product = add_named_product(connection, "New Snack", "012000001338")  # not carried yet
    signed_in.user = MANAGER
    url = f"/staff/stores/{quantico}/restock"

    plenty = client.post(f"{url}/{shelf['water']}/requests", json={"quantity": 5})
    unknown_count = client.post(f"{url}/{shelf['gum']}/requests", json={"quantity": 5})
    not_carried = client.post(f"{url}/{new_product}/requests", json={"quantity": 5})
    set_stock(connection, new_product, quantico, True, 12)  # it arrives

    assert plenty.status_code == 409 and plenty.json()["code"] == "not_low"
    assert unknown_count.status_code == 201
    assert not_carried.status_code == 201
    statuses = client.get(f"{url}/requests", params={"status": "all"}).json()
    assert {r["product"]["name"]: r["status"] for r in statuses}["New Snack"] == "restocked"


def test_reorder_point_changes_are_audited(client, signed_in, shelf, team, connection) -> None:
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    client.put(
        f"/staff/stores/{quantico}/restock/{shelf['soda']}/reorder-point",
        json={"reorder_point": 12},
    )
    product_change = latest_audit(connection)
    client.put(f"/staff/stores/{quantico}/restock/settings", json={"default_reorder_point": 8})
    store_change = latest_audit(connection)

    assert product_change[1] == "restock.reorder_point"
    assert product_change[3] == {f"store {quantico} reorder point": {"from": 5, "to": 12}}
    assert (store_change[1], store_change[3]) == (
        "store.update",
        {"default_reorder_point": {"from": 5, "to": 8}},
    )


def test_stock_from_before_the_migration_starts_its_history(connection, team) -> None:
    product_id = add_product(connection)
    quantico = team["Quantico MCX"]
    set_stock(connection, product_id, quantico, False, 0)
    connection.execute("DELETE FROM stock_events")  # as before migration 020

    connection.execute((MIGRATIONS_DIR / "020_add_restock_alerts.sql").read_text(encoding="utf-8"))
    connection.execute((MIGRATIONS_DIR / "020_add_restock_alerts.sql").read_text(encoding="utf-8"))

    events = connection.execute(
        "SELECT e.in_stock, e.changed_at = ps.updated_at FROM stock_events AS e "
        "JOIN product_stock AS ps USING (product_id, store_id) WHERE e.product_id = %s",
        (product_id,),
    ).fetchall()
    assert events == [(False, True)]  # once, as of its last update
