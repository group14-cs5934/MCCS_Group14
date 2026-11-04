"""Store staff (migrations 016 and 019, app/api/staff.py); these skip without TEST_DATABASE_URL.

Staff have one of their store's roles, which says what they may do there. These use each store's
starting roles: "Worker" edits stock; "Manager" can do everything, including adding and removing
staff. Admins can do everything at every store. Custom roles themselves are tested in
test_store_roles.py; who may call which endpoint, for every permission, in
test_permissions_audit.py. These check what each change does.
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


def role_id(connection: psycopg.Connection, store_id: int, name: str) -> int:
    """The ID of the store's role with this name."""
    (found,) = connection.execute(
        "SELECT id FROM store_roles WHERE store_id = %s AND name = %s", (store_id, name)
    ).fetchone()
    return found


@pytest.fixture
def team(connection: psycopg.Connection, stores: dict[str, int]) -> dict[str, int]:
    """The stores, with the manager and worker at Quantico, and OTHER a worker at Camp Lejeune."""
    users = UserRepository(connection)
    quantico, lejeune = stores["Quantico MCX"], stores["Camp Lejeune MCX"]
    users.update(MANAGER.id, role="staff", store_role_id=role_id(connection, quantico, "Manager"))
    users.update(WORKER.id, role="staff", store_role_id=role_id(connection, quantico, "Worker"))
    users.update(OTHER.id, role="staff", store_role_id=role_id(connection, lejeune, "Worker"))
    connection.commit()
    return stores


def account(
    connection: psycopg.Connection, person: TokenUser
) -> tuple[str, int | None, str | None]:
    """The person's role, store, and role at that store."""
    return connection.execute(
        "SELECT u.role, u.store_id, r.name FROM users AS u "
        "LEFT JOIN store_roles AS r ON r.id = u.store_role_id WHERE u.id = %s",
        (person.id,),
    ).fetchone()


def latest_audit(connection: psycopg.Connection) -> tuple:
    return connection.execute(
        "SELECT admin_email, action, target_id, changes FROM admin_audit_log ORDER BY id DESC"
    ).fetchone()


# --- The database rules ---


def test_staff_must_have_a_store_and_a_role_and_nobody_else_can(connection, stores) -> None:
    quantico, lejeune = stores["Quantico MCX"], stores["Camp Lejeune MCX"]
    lejeune_worker = role_id(connection, lejeune, "Worker")

    for sql, values in [
        ("UPDATE users SET role = 'staff' WHERE id = %s", ()),  # staff without a store
        ("UPDATE users SET store_id = %s WHERE id = %s", (quantico,)),  # a store for a user
        # A role at another store than their own.
        (
            "UPDATE users SET role = 'staff', store_id = %s, store_role_id = %s WHERE id = %s",
            (quantico, lejeune_worker),
        ),
    ]:
        with pytest.raises((psycopg.errors.CheckViolation, psycopg.errors.ForeignKeyViolation)):
            connection.execute(sql, (*values, SHOPPER.id))
        connection.rollback()


def test_every_new_store_starts_with_a_manager_and_a_worker_role(connection, stores) -> None:
    # Also when a script adds the store straight to the database.
    (scripted,) = connection.execute(
        "INSERT INTO store_locations (name, slug) VALUES ('Okinawa', 'okinawa') RETURNING id"
    ).fetchone()

    for store_id in (stores["Quantico MCX"], scripted):
        roles = connection.execute(
            "SELECT name, permissions FROM store_roles WHERE store_id = %s ORDER BY name",
            (store_id,),
        ).fetchall()
        assert roles == [
            (
                "Manager",
                ["edit_stock", "view_staff", "manage_staff", "manage_roles", "edit_store_info"],
            ),
            ("Worker", ["edit_stock"]),
        ]


# --- Admins assign roles ---


def test_admins_make_people_staff_with_a_store_role(client, signed_in, team, connection):
    quantico = team["Quantico MCX"]
    manager_role = role_id(connection, quantico, "Manager")

    response = client.patch(
        f"/admin/users/{SHOPPER.id}", json={"role": "staff", "store_role_id": manager_role}
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["role"], body["store_id"], body["store_role"]["name"]) == (
        "staff",
        quantico,
        "Manager",
    )
    changes = latest_audit(connection)[3]
    assert changes["store_id"] == {"from": None, "to": quantico}
    assert changes["store_role"] == {"from": None, "to": "Manager"}
    signed_in.user = SHOPPER
    me = client.get("/me").json()  # on their next request
    assert me["store_id"] == quantico
    assert "manage_staff" in me["store_role"]["permissions"]


def test_staff_need_a_store_role_and_only_staff_have_one(client, team, connection) -> None:
    worker_role = role_id(connection, team["Quantico MCX"], "Worker")

    no_role = client.patch(f"/admin/users/{SHOPPER.id}", json={"role": "staff"})
    role_for_admin = client.patch(
        f"/admin/users/{SHOPPER.id}", json={"role": "admin", "store_role_id": worker_role}
    )
    unknown_role = client.patch(
        f"/admin/users/{SHOPPER.id}", json={"role": "staff", "store_role_id": 999_999}
    )
    too_big = client.patch(
        f"/admin/users/{SHOPPER.id}", json={"role": "staff", "store_role_id": 2**31}
    )
    old_store_id = client.patch(
        f"/admin/users/{SHOPPER.id}", json={"role": "staff", "store_id": team["Quantico MCX"]}
    )

    assert too_big.status_code == 422  # beyond a database ID, so not a database error
    assert old_store_id.status_code == 422  # the store comes from the role now
    assert no_role.status_code == 422 and no_role.json()["code"] == "store_role_required"
    assert role_for_admin.status_code == 422
    assert role_for_admin.json()["code"] == "store_role_not_allowed"
    assert unknown_role.status_code == 404
    assert unknown_role.json()["code"] == "store_role_not_found"
    assert account(connection, SHOPPER) == ("user", None, None)


def test_admins_move_staff_between_stores_and_any_other_role_leaves_the_store(
    client, team, connection
) -> None:
    lejeune = team["Camp Lejeune MCX"]
    moved = client.patch(
        f"/admin/users/{WORKER.id}", json={"store_role_id": role_id(connection, lejeune, "Manager")}
    )
    assert account(connection, WORKER) == ("staff", lejeune, "Manager")

    promoted = client.patch(f"/admin/users/{WORKER.id}", json={"role": "admin"})

    assert moved.status_code == promoted.status_code == 200
    assert account(connection, WORKER) == ("admin", None, None)


def test_admins_cant_make_themselves_staff(client, team, connection) -> None:
    response = client.patch(
        f"/admin/users/{ADMIN.id}",
        json={
            "role": "staff",
            "store_role_id": role_id(connection, team["Quantico MCX"], "Worker"),
        },
    )

    assert response.status_code == 409
    assert response.json()["code"] == "cannot_change_own_account"


# --- Stock, for roles that may edit it ---


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


def test_a_role_that_cant_edit_stock_cant_see_or_set_it(client, signed_in, team, connection):
    product_id = add_product(connection)
    quantico = team["Quantico MCX"]
    # Workers at Quantico lose stock editing.
    connection.execute(
        "UPDATE store_roles SET permissions = '{}' WHERE id = %s",
        (role_id(connection, quantico, "Worker"),),
    )
    connection.commit()
    signed_in.user = WORKER

    listed = client.get(f"/staff/stores/{quantico}/stock")
    changed = client.put(f"/staff/stores/{quantico}/stock/{product_id}", json={"in_stock": True})

    for response in (listed, changed):
        assert response.status_code == 403
        assert response.json()["code"] == "missing_permission"


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


# --- Store details, for roles that may edit them ---


def test_staff_who_may_edit_store_info_change_its_hours(client, signed_in, team, connection):
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    response = client.patch(f"/staff/stores/{quantico}", json={"hours": "Mon–Fri 9–5"})
    renaming = client.patch(f"/staff/stores/{quantico}", json={"name": "Mine"})
    signed_in.user = WORKER
    as_worker = client.patch(f"/staff/stores/{quantico}", json={"hours": "Never"})

    assert response.status_code == 200 and response.json()["hours"] == "Mon–Fri 9–5"
    assert client.get(f"/locations/{quantico}").json()["hours"] == "Mon–Fri 9–5"
    email, action, _, changes = latest_audit(connection)
    assert (email, action) == (MANAGER.email, "store.update")
    assert changes == {"hours": {"from": None, "to": "Mon–Fri 9–5"}}
    assert renaming.status_code == 422  # the name stays with admins
    assert as_worker.status_code == 403 and as_worker.json()["code"] == "missing_permission"


# --- Staff, for roles that may manage them ---


def test_a_manager_adds_someone_by_email_with_a_role(client, signed_in, team, connection):
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    response = client.post(
        f"/staff/stores/{quantico}/staff",
        json={"email": " shopper@example.COM ", "role_id": role_id(connection, quantico, "Worker")},
    )

    assert response.status_code == 201
    assert account(connection, SHOPPER) == ("staff", quantico, "Worker")
    email, action, target, changes = latest_audit(connection)
    assert (email, action, target) == (MANAGER.email, "user.update", str(SHOPPER.id))
    assert changes["role"] == {"from": "user", "to": "staff"}
    assert changes["store_role"] == {"from": None, "to": "Worker"}
    staff = client.get(f"/staff/stores/{quantico}/staff").json()
    assert [(person["email"], person["store_role"]["name"]) for person in staff] == [
        ("manager@example.com", "Manager"),
        ("Shopper@Example.com", "Worker"),
        ("worker@example.com", "Worker"),
    ]


@pytest.mark.parametrize(
    ("email", "status", "code"),
    [
        ("nobody@example.com", 404, "user_not_found"),  # hasn't signed up
        ("other@example.com", 409, "already_staff"),  # works at another store
        ("admin@example.com", 409, "already_staff"),
    ],
)
def test_a_manager_can_only_add_regular_users(
    client, signed_in, team, connection, email, status, code
) -> None:
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    response = client.post(
        f"/staff/stores/{quantico}/staff",
        json={"email": email, "role_id": role_id(connection, quantico, "Worker")},
    )

    assert response.status_code == status
    assert response.json()["code"] == code


def test_staff_can_only_be_given_their_own_stores_roles(client, signed_in, team, connection):
    signed_in.user = MANAGER

    response = client.post(
        f"/staff/stores/{team['Quantico MCX']}/staff",
        json={
            "email": SHOPPER.email,
            "role_id": role_id(connection, team["Camp Lejeune MCX"], "Worker"),
        },
    )

    assert response.status_code == 404 and response.json()["code"] == "store_role_not_found"
    assert account(connection, SHOPPER) == ("user", None, None)


def test_a_deactivated_account_cant_be_added(client, signed_in, team, connection) -> None:
    client.patch(f"/admin/users/{SHOPPER.id}", json={"active": False})
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    response = client.post(
        f"/staff/stores/{quantico}/staff",
        json={"email": SHOPPER.email, "role_id": role_id(connection, quantico, "Worker")},
    )

    assert response.status_code == 409 and response.json()["code"] == "account_deactivated"


def test_a_manager_changes_someones_role(client, signed_in, team, connection) -> None:
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    response = client.patch(
        f"/staff/stores/{quantico}/staff/{WORKER.id}",
        json={"role_id": role_id(connection, quantico, "Manager")},
    )
    themselves = client.patch(
        f"/staff/stores/{quantico}/staff/{MANAGER.id}",
        json={"role_id": role_id(connection, quantico, "Worker")},
    )

    assert response.status_code == 200 and response.json()["store_role"]["name"] == "Manager"
    assert latest_audit(connection)[3] == {"store_role": {"from": "Worker", "to": "Manager"}}
    assert themselves.status_code == 409
    assert themselves.json()["code"] == "cannot_change_own_account"
    signed_in.user = WORKER  # now a manager, on their next request
    assert client.get(f"/staff/stores/{quantico}/staff").status_code == 200


def test_a_manager_removes_someone_who_then_loses_access(
    client, signed_in, team, connection
) -> None:
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    response = client.delete(f"/staff/stores/{quantico}/staff/{WORKER.id}")

    assert response.status_code == 204
    assert account(connection, WORKER) == ("user", None, None)
    signed_in.user = WORKER
    assert client.get(f"/staff/stores/{quantico}/stock").status_code == 403


def test_a_manager_cant_remove_themselves_or_other_stores_staff(
    client, signed_in, team, connection
) -> None:
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    themselves = client.delete(f"/staff/stores/{quantico}/staff/{MANAGER.id}")
    other_store = client.delete(f"/staff/stores/{quantico}/staff/{OTHER.id}")

    assert themselves.status_code == 409
    assert other_store.status_code == 404 and other_store.json()["code"] == "staff_not_found"
    assert account(connection, OTHER) == ("staff", team["Camp Lejeune MCX"], "Worker")


def test_staff_cant_hand_out_or_take_away_roles_that_can_do_more_than_theirs(
    client, signed_in, team, connection
) -> None:
    """A "Shift lead" may manage staff and stock, but not roles or the store's details."""
    quantico = team["Quantico MCX"]
    (lead_role,) = connection.execute(
        "INSERT INTO store_roles (store_id, name, permissions) "
        "VALUES (%s, 'Shift lead', '{manage_staff,edit_stock}') RETURNING id",
        (quantico,),
    ).fetchone()
    UserRepository(connection).update(SHOPPER.id, role="staff", store_role_id=lead_role)
    connection.commit()
    manager_role = role_id(connection, quantico, "Manager")
    worker_role = role_id(connection, quantico, "Worker")
    signed_in.user = SHOPPER

    promote_worker = client.patch(
        f"/staff/stores/{quantico}/staff/{WORKER.id}", json={"role_id": manager_role}
    )
    demote_manager = client.patch(
        f"/staff/stores/{quantico}/staff/{MANAGER.id}", json={"role_id": worker_role}
    )
    remove_manager = client.delete(f"/staff/stores/{quantico}/staff/{MANAGER.id}")
    remove_worker = client.delete(f"/staff/stores/{quantico}/staff/{WORKER.id}")

    for refused in (promote_worker, demote_manager, remove_manager):
        assert refused.status_code == 403
        assert refused.json()["code"] == "beyond_your_permissions"
    assert remove_worker.status_code == 204  # Worker can't do more than a Shift lead
    assert account(connection, MANAGER) == ("staff", quantico, "Manager")


def test_admins_remove_anyone(client, team, connection) -> None:
    response = client.delete(f"/staff/stores/{team['Quantico MCX']}/staff/{MANAGER.id}")

    assert response.status_code == 204
    assert account(connection, MANAGER) == ("user", None, None)


# --- Stores going away ---


def test_deleting_a_store_makes_its_staff_regular_users(client, team, connection) -> None:
    response = client.delete(f"/admin/stores/{team['Quantico MCX']}")

    assert response.status_code == 204
    assert account(connection, MANAGER) == ("user", None, None)
    assert account(connection, WORKER) == ("user", None, None)
    assert account(connection, OTHER) == ("staff", team["Camp Lejeune MCX"], "Worker")
    assert latest_audit(connection)[3]["staff"] == {"from": 2, "to": 0}
    remaining = connection.execute(
        "SELECT count(*) FROM store_roles WHERE store_id = %s", (team["Quantico MCX"],)
    )
    assert remaining.fetchone() == (0,)  # its roles go with it
