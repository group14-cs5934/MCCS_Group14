"""Admin product endpoints without a database: who may call them, and which payloads are
rejected before anything is looked up. test_admin_products.py covers saving changes.
"""

from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthUser, get_current_user
from app.repositories.audit_log import get_audit_log_repository
from app.repositories.products import get_product_repository
from app.schemas.admin_product import AdminProductUpdate
from tests.fakes import LAYS, FakeAuditLog, FakeProducts

ADMIN = AuthUser(id=UUID("a0000000-0000-4000-8000-000000000001"), email=None, role="admin")
SHOPPER = AuthUser(id=UUID("b0000000-0000-4000-8000-000000000002"), email=None, role="user")


@pytest.fixture
def client(make_client) -> TestClient:
    """Signed in as an admin; the product repository is a fake that has no write methods, so a
    test fails if a rejected request reaches the database."""
    client = make_client()
    client.app.dependency_overrides[get_product_repository] = lambda: FakeProducts(LAYS)
    client.app.dependency_overrides[get_current_user] = lambda: ADMIN
    client.app.dependency_overrides[get_audit_log_repository] = FakeAuditLog
    return client


@pytest.mark.parametrize(
    "body",
    [
        {"name": "No barcode"},
        {"barcode": "036000291452"},  # no name
        {"barcode": "036000291453", "name": "Bad check digit"},
        {"barcode": "036000291452", "name": "Free", "price": "0"},
        {"barcode": "036000291452", "name": "Fraction of a cent", "price": "1.999"},
        {"barcode": "036000291452", "name": "Typo", "prise": "1.00"},  # unknown field
        {"barcode": "036000291452", "name": "Bad photo", "image_url": "not a url"},
    ],
)
def test_invalid_new_products_are_422(client, body) -> None:
    response = client.post("/admin/products", json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


@pytest.mark.parametrize(
    "body",
    [
        {},  # nothing to change
        {"name": None},  # every product needs a name
        {"barcode": None},
        {"price": None},  # prices are history; there's no "no price" to set
        {"name": ""},
        {"stock": 5},  # unknown field
    ],
)
def test_invalid_edits_are_422(client, body) -> None:
    response = client.patch(f"/admin/products/{LAYS.id}", json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/admin/products"),
        ("PATCH", f"/admin/products/{LAYS.id}"),
        ("DELETE", f"/admin/products/{LAYS.id}"),
    ],
)
def test_regular_users_get_403(client, method, path) -> None:
    client.app.dependency_overrides[get_current_user] = lambda: SHOPPER

    response = client.request(method, path, json={"barcode": "036000291452", "name": "X"})

    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"


def test_signing_in_is_required(make_client) -> None:
    client = make_client()  # the real token check, and no token is sent

    assert client.delete(f"/admin/products/{LAYS.id}").status_code == 401


def test_edit_sends_only_the_fields_given() -> None:
    change = AdminProductUpdate.model_validate(
        {"name": " Classic Chips ", "size": None, "image_url": "https://example.com/a.jpg"}
    )

    assert change.product_changes() == {
        "name": "Classic Chips",
        "size": None,
        "image_url": "https://example.com/a.jpg",
    }
    assert change.price is None


def test_docs_list_the_admin_product_endpoints(client) -> None:
    paths = client.app.openapi()["paths"]

    assert {"201", "401", "403", "409", "422"} <= set(paths["/admin/products"]["post"]["responses"])
    product = paths["/admin/products/{product_id}"]
    assert {"404", "409"} <= set(product["patch"]["responses"])
    assert {"204", "404"} <= set(product["delete"]["responses"])
