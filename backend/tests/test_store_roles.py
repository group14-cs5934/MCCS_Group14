"""Custom store roles (migration 019, app/api/store_roles.py); database tests skip without
TEST_DATABASE_URL.

Each store names its own roles and ticks what each may do. Staff who may manage roles can't make
or change one to do more than they can. Moving existing workers and managers onto the starting
roles is checked here too. Uses the stores, people, and helpers from test_store_staff.py.
"""

import os
from collections.abc import Iterator
from urllib.parse import quote
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql

from app.repositories import UserRepository
from app.schemas import PERMISSIONS, StoreRoleCreate
from scripts.migrate import MIGRATIONS_DIR
from tests import test_store_staff as store_staff
from tests.test_store_staff import (
    MANAGER,
    OTHER,
    SHOPPER,
    WORKER,
    account,
    latest_audit,
    role_id,
)

# test_store_staff.py's fixtures, so tests here can use them by name.
client, signed_in = store_staff.client, store_staff.signed_in
stores, team = store_staff.stores, store_staff.team

EVERY_PERMISSION = [p.key for p in PERMISSIONS]


def roles_url(store_id: int) -> str:
    return f"/staff/stores/{store_id}/roles"


# --- The permission list ---


def test_unknown_permissions_are_refused_and_each_is_kept_once_in_list_order() -> None:
    role = StoreRoleCreate(name=" Buyer ", permissions=["manage_roles", "edit_stock", "edit_stock"])

    assert (role.name, role.permissions) == ("Buyer", ["edit_stock", "manage_roles"])
    with pytest.raises(ValueError):
        StoreRoleCreate(name="Buyer", permissions=["order_restock"])
    with pytest.raises(ValueError):
        StoreRoleCreate(name=" ", permissions=[])


def test_the_app_gets_every_permission_with_its_label(client, signed_in, team) -> None:
    signed_in.user = SHOPPER  # any signed-in user

    response = client.get("/staff/permissions")

    assert response.status_code == 200
    assert [p["key"] for p in response.json()] == EVERY_PERMISSION
    assert all(p["label"] and p["description"] for p in response.json())


# --- Seeing and managing roles ---


def test_any_staff_member_sees_their_stores_roles_and_who_has_them(client, signed_in, team):
    signed_in.user = WORKER

    response = client.get(roles_url(team["Quantico MCX"]))

    assert response.status_code == 200
    assert [(r["name"], r["permissions"], r["member_count"]) for r in response.json()] == [
        ("Manager", EVERY_PERMISSION, 1),
        ("Worker", ["edit_stock"], 1),
    ]


def test_a_manager_adds_a_role_and_gives_it_to_someone(client, signed_in, team, connection):
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER

    created = client.post(
        roles_url(quantico), json={"name": "Stocker", "permissions": ["edit_stock"]}
    )
    added = client.post(
        f"/staff/stores/{quantico}/staff",
        json={"email": SHOPPER.email, "role_id": created.json()["id"]},
    )

    assert created.status_code == 201
    assert created.json() | {"id": 0} == {
        "id": 0,
        "store_id": quantico,
        "name": "Stocker",
        "permissions": ["edit_stock"],
        "member_count": 0,
    }
    assert added.status_code == 201
    assert account(connection, SHOPPER) == ("staff", quantico, "Stocker")
    signed_in.user = SHOPPER
    assert client.get(f"/staff/stores/{quantico}/stock").status_code == 200
    staff = client.get(f"/staff/stores/{quantico}/staff")
    assert staff.status_code == 403 and staff.json()["code"] == "missing_permission"


def test_role_names_are_unique_at_each_store_ignoring_case(client, signed_in, team) -> None:
    signed_in.user = MANAGER
    quantico, lejeune = team["Quantico MCX"], team["Camp Lejeune MCX"]

    taken = client.post(roles_url(quantico), json={"name": " worker ", "permissions": []})
    elsewhere = client.post(roles_url(quantico), json={"name": "Cashier", "permissions": []})
    signed_in.user = OTHER  # a Worker at Camp Lejeune can't add roles there
    not_allowed = client.post(roles_url(lejeune), json={"name": "Cashier", "permissions": []})

    assert taken.status_code == 409 and taken.json()["code"] == "role_name_taken"
    assert elsewhere.status_code == 201
    assert not_allowed.status_code == 403
    assert not_allowed.json()["code"] == "missing_permission"


def test_changing_a_role_changes_what_its_people_can_do(client, signed_in, team, connection):
    quantico = team["Quantico MCX"]
    worker_role = role_id(connection, quantico, "Worker")
    signed_in.user = MANAGER

    response = client.patch(
        f"{roles_url(quantico)}/{worker_role}",
        json={"name": "Associate", "permissions": ["edit_stock", "view_staff"]},
    )

    assert response.status_code == 200
    assert response.json()["permissions"] == ["edit_stock", "view_staff"]
    email, action, target, changes = latest_audit(connection)
    assert (email, action, target) == (MANAGER.email, "store_role.update", str(worker_role))
    assert changes["name"] == {"from": "Worker", "to": "Associate"}
    signed_in.user = WORKER  # on their next request
    assert client.get(f"/staff/stores/{quantico}/staff").status_code == 200
    me = client.get("/me").json()
    assert me["store_role"]["name"] == "Associate"


def test_a_role_someone_has_cant_be_deleted(client, signed_in, team, connection) -> None:
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER
    unused = client.post(roles_url(quantico), json={"name": "Cashier", "permissions": []}).json()

    in_use = client.delete(f"{roles_url(quantico)}/{role_id(connection, quantico, 'Worker')}")
    deleted = client.delete(f"{roles_url(quantico)}/{unused['id']}")
    again = client.delete(f"{roles_url(quantico)}/{unused['id']}")

    assert in_use.status_code == 409 and in_use.json()["code"] == "role_in_use"
    assert deleted.status_code == 204
    assert latest_audit(connection)[1] == "store_role.delete"
    assert again.status_code == 404 and again.json()["code"] == "store_role_not_found"


def test_another_stores_roles_cant_be_changed_through_this_one(client, signed_in, team, connection):
    quantico, lejeune = team["Quantico MCX"], team["Camp Lejeune MCX"]
    signed_in.user = MANAGER

    response = client.patch(
        f"{roles_url(quantico)}/{role_id(connection, lejeune, 'Worker')}",
        json={"permissions": EVERY_PERMISSION},
    )

    assert response.status_code == 404 and response.json()["code"] == "store_role_not_found"


def test_nobody_can_make_a_role_do_more_than_they_can(client, signed_in, team, connection):
    """A "Supervisor" may manage roles and edit stock, and nothing else."""
    quantico = team["Quantico MCX"]
    signed_in.user = MANAGER
    supervisor = client.post(
        roles_url(quantico),
        json={"name": "Supervisor", "permissions": ["edit_stock", "manage_roles"]},
    ).json()
    UserRepository(connection).update(SHOPPER.id, role="staff", store_role_id=supervisor["id"])
    connection.commit()
    signed_in.user = SHOPPER
    manager_role = role_id(connection, quantico, "Manager")
    worker_role = role_id(connection, quantico, "Worker")

    more = client.post(roles_url(quantico), json={"name": "Lead", "permissions": ["manage_staff"]})
    own_role_more = client.patch(
        f"{roles_url(quantico)}/{supervisor['id']}",
        json={"permissions": ["edit_stock", "manage_roles", "edit_store_info"]},
    )
    weaken_manager = client.patch(f"{roles_url(quantico)}/{manager_role}", json={"permissions": []})
    delete_manager = client.delete(f"{roles_url(quantico)}/{manager_role}")
    same_or_less = client.post(
        roles_url(quantico), json={"name": "Stocker", "permissions": ["edit_stock"]}
    )
    rename_worker = client.patch(f"{roles_url(quantico)}/{worker_role}", json={"name": "Crew"})

    for refused in (more, own_role_more, weaken_manager, delete_manager):
        assert refused.status_code == 403
        assert refused.json()["code"] == "beyond_your_permissions"
    assert same_or_less.status_code == 201
    assert rename_worker.status_code == 200
    manager_permissions = connection.execute(
        "SELECT permissions FROM store_roles WHERE id = %s", (manager_role,)
    ).fetchone()
    assert manager_permissions == (EVERY_PERMISSION,)


def test_permissions_the_api_doesnt_know_are_ignored(client, signed_in, team, connection):
    # E.g. one that was removed from PERMISSIONS after a store gave it to a role.
    quantico = team["Quantico MCX"]
    connection.execute(
        "UPDATE store_roles SET permissions = '{edit_stock,retired_permission}' WHERE id = %s",
        (role_id(connection, quantico, "Worker"),),
    )
    connection.commit()
    signed_in.user = WORKER

    me = client.get("/me").json()

    assert me["store_role"]["permissions"] == ["edit_stock"]


# --- Moving the fixed roles of migration 016 onto custom ones ---


@pytest.fixture
def schema_before_019() -> Iterator[psycopg.Connection]:
    """A connection to a throwaway schema with every migration before 019 applied."""
    base_url = os.environ.get("TEST_DATABASE_URL")
    if not base_url:
        if os.environ.get("CI"):
            pytest.fail("TEST_DATABASE_URL isn't set, so CI would silently skip database tests")
        pytest.skip("set TEST_DATABASE_URL to run database tests")
    schema_name = f"test_{uuid4().hex[:12]}"
    schema = sql.Identifier(schema_name)
    separator = "&" if "?" in base_url else "?"
    search_path = quote(f"-c search_path={schema_name},public,extensions")
    with psycopg.connect(base_url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(schema))
    try:
        with psycopg.connect(f"{base_url}{separator}options={search_path}") as connection:
            for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
                if migration.name >= "019":
                    break
                connection.execute(migration.read_text(encoding="utf-8"))
            connection.commit()
            yield connection
    finally:
        with psycopg.connect(base_url, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(schema))


def test_existing_managers_and_workers_keep_their_access(schema_before_019) -> None:
    connection = schema_before_019
    (store_id,) = connection.execute(
        "INSERT INTO store_locations (name, slug) VALUES ('Quantico MCX', 'quantico') RETURNING id"
    ).fetchone()
    for person, role, store in [
        (MANAGER, "manager", store_id),
        (WORKER, "worker", store_id),
        (SHOPPER, "user", None),
    ]:
        connection.execute(
            "INSERT INTO users (id, email, role, store_id) VALUES (%s, %s, %s, %s)",
            (person.id, person.email, role, store),
        )
    migration = (MIGRATIONS_DIR / "019_add_custom_store_roles.sql").read_text(encoding="utf-8")

    connection.execute(migration)
    connection.execute(migration)  # safe to run more than once

    assert account(connection, MANAGER) == ("staff", store_id, "Manager")
    assert account(connection, WORKER) == ("staff", store_id, "Worker")
    assert account(connection, SHOPPER) == ("user", None, None)
    roles = connection.execute(
        "SELECT name, permissions FROM store_roles WHERE store_id = %s ORDER BY name", (store_id,)
    ).fetchall()
    assert roles == [("Manager", EVERY_PERMISSION), ("Worker", ["edit_stock"])]
