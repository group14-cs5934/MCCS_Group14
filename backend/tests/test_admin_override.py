"""Admin edits survive the product sync (T089); database tests skip without TEST_DATABASE_URL.

T089 acceptance: when an admin edits a product, the next sync does not overwrite that edit.

An admin edits through the API, then the sync saves the source's version of the product with
upsert_product, exactly as the nightly job does. The product monitor's price query is run from its
own file (jobs/product-monitor), so it's tested as it really is.
"""

import ast
from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.auth import TokenUser, get_token_user
from app.core.config import load_settings
from app.ingest.load import upsert_product
from app.ingest.transform import CleanProduct
from app.main import create_app
from app.repositories import UserRepository
from tests.factories import add_product

ADMIN = TokenUser(id=UUID("a0000000-0000-4000-8000-000000000001"), email="admin@example.com")
MONITOR = Path(__file__).resolve().parents[2] / "jobs" / "product-monitor" / "product-monitor.py"


def from_source(**changes) -> CleanProduct:
    """The source's version of Sample Chips (barcode 036000291452), as the sync gets it."""
    fields = {
        "source": "upcitemdb",
        "source_id": "036000291452",
        "barcode": "036000291452",
        "name": "Sample Chips (Source Name)",
        "description": "Description from the source.",
        "size": "200g",
        "image_url": "https://example.com/source.jpg",
        "category": None,
        "price": Decimal("4.99"),
        "raw": {},
    }
    return CleanProduct(**{**fields, **changes})


def sync(connection: psycopg.Connection, product: CleanProduct) -> None:
    """One sync of this product, committed, as the nightly job does it."""
    connection.commit()  # see what the API committed
    upsert_product(connection, product, datetime.now(UTC))
    connection.commit()


def stored(connection: psycopg.Connection, product_id: int) -> dict:
    connection.commit()
    with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
        return cursor.execute(
            """
            SELECT p.barcode, p.name, p.description, p.size, p.image_url, p.admin_fields,
                (SELECT amount::text FROM prices WHERE product_id = p.id
                 ORDER BY observed_at DESC, id DESC LIMIT 1) AS price
            FROM products p WHERE p.id = %s
            """,
            (product_id,),
        ).fetchone()


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
def product_id(connection: psycopg.Connection) -> int:
    product_id = add_product(connection)  # Sample Chips, 184g, no description, no price
    connection.commit()
    return product_id


# --- The acceptance criterion ---


def test_next_sync_keeps_the_admins_edit(client, connection, product_id) -> None:
    client.patch(f"/admin/products/{product_id}", json={"name": "Classic Chips", "price": "2.49"})

    sync(connection, from_source())

    product = stored(connection, product_id)
    # The admin's edits stay...
    assert (product["name"], product["price"]) == ("Classic Chips", "2.49")
    # ...and the sync still fills in everything the admin didn't touch.
    assert product["description"] == "Description from the source."
    assert product["size"] == "200g"
    assert product["image_url"] == "https://example.com/source.jpg"


def test_edits_stay_through_every_later_sync(client, connection, product_id) -> None:
    client.patch(f"/admin/products/{product_id}", json={"size": "184g"})

    for name in ("First Sync Name", "Second Sync Name"):
        sync(connection, from_source(name=name))

    product = stored(connection, product_id)
    assert (product["size"], product["name"]) == ("184g", "Second Sync Name")


def test_products_no_admin_touched_still_sync_normally(connection, product_id) -> None:
    sync(connection, from_source())

    product = stored(connection, product_id)
    assert (product["name"], product["size"], product["price"]) == (
        "Sample Chips (Source Name)",
        "200g",
        "4.99",
    )
    assert product["admin_fields"] == []


def test_a_product_an_admin_created_keeps_every_field_they_gave(client, connection) -> None:
    created = client.post(
        "/admin/products",
        json={"barcode": "036000291452", "name": "Admin Chips", "size": "150g", "price": "1.99"},
    ).json()
    assert created["admin_fields"] == ["barcode", "name", "price", "size"]

    sync(connection, from_source())

    product = stored(connection, created["id"])
    assert (product["name"], product["size"], product["price"]) == ("Admin Chips", "150g", "1.99")
    assert product["description"] == "Description from the source."  # the admin left it empty


def test_an_admin_set_barcode_isnt_replaced(client, connection, product_id) -> None:
    sync(connection, from_source())  # links the product to its source record
    client.patch(f"/admin/products/{product_id}", json={"barcode": "012000171741"})

    sync(connection, from_source())  # found by its source ID, with the old barcode

    assert stored(connection, product_id)["barcode"] == "012000171741"


# --- Handing fields back to the sync ---


def test_resume_sync_hands_chosen_fields_back(client, connection, product_id) -> None:
    client.patch(f"/admin/products/{product_id}", json={"name": "Classic Chips", "size": "184g"})

    response = client.patch(f"/admin/products/{product_id}", json={"resume_sync": ["name"]})
    sync(connection, from_source())

    assert response.json()["admin_fields"] == ["size"]
    product = stored(connection, product_id)
    assert (product["name"], product["size"]) == ("Sample Chips (Source Name)", "184g")


def test_resume_sync_true_hands_every_field_back(client, connection, product_id) -> None:
    client.patch(f"/admin/products/{product_id}", json={"name": "Classic Chips", "price": "2.49"})

    client.patch(f"/admin/products/{product_id}", json={"resume_sync": True})
    sync(connection, from_source())

    product = stored(connection, product_id)
    assert (product["name"], product["price"], product["admin_fields"]) == (
        "Sample Chips (Source Name)",
        "4.99",
        [],
    )


def test_handing_fields_back_is_in_the_audit_log(client, connection, product_id) -> None:
    client.patch(f"/admin/products/{product_id}", json={"name": "Classic Chips"})

    client.patch(f"/admin/products/{product_id}", json={"resume_sync": True})

    connection.commit()
    (changes,) = connection.execute(
        "SELECT changes FROM admin_audit_log ORDER BY id DESC LIMIT 1"
    ).fetchone()
    assert changes == {"admin_fields": {"from": ["name"], "to": None}}


@pytest.mark.parametrize(
    "body", [{"resume_sync": False}, {"resume_sync": ["stock"]}, {"resume_sync": "name"}]
)
def test_invalid_resume_sync_is_422(client, product_id, body) -> None:
    assert client.patch(f"/admin/products/{product_id}", json=body).status_code == 422


def test_only_admins_see_which_fields_are_protected(client, product_id) -> None:
    client.patch(f"/admin/products/{product_id}", json={"name": "Classic Chips"})

    listed = client.get("/admin/products").json()
    public = client.get(f"/products/{product_id}").json()

    assert listed[0]["admin_fields"] == ["name"]
    assert "admin_fields" not in public


# --- The product monitor's prices ---


def monitor_query(name: str) -> str:
    """A SQL constant from the monitor's own file, read without importing it (it needs its own
    packages)."""
    tree = ast.parse(MONITOR.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == name:
            return ast.literal_eval(node.value)
    raise AssertionError(f"{name} isn't in {MONITOR}")


def monitor_saves_price(connection: psycopg.Connection, product_id: int, amount: str) -> None:
    connection.commit()
    connection.execute(
        monitor_query("INSERT_PRICE"),
        {
            "product_id": product_id,
            "amount": Decimal(amount),
            "currency": "USD",
            "source": "mccs-online",
            # Text, as the monitor sends it (its run_at), not a datetime.
            "observed_at": datetime.now(UTC).isoformat(),
        },
    )
    connection.commit()


def test_monitor_doesnt_replace_a_price_an_admin_set(client, connection, product_id) -> None:
    client.patch(f"/admin/products/{product_id}", json={"price": "2.49"})

    monitor_saves_price(connection, product_id, "3.99")

    assert stored(connection, product_id)["price"] == "2.49"


def test_monitor_still_records_prices_otherwise(connection, product_id) -> None:
    monitor_saves_price(connection, product_id, "3.99")

    assert stored(connection, product_id)["price"] == "3.99"
