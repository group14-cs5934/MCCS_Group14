"""Unit tests for GET /products/{id} and GET /products/barcode/{code}.

T019 acceptance: when the test suite runs, both found and not-found lookup cases pass.
T031 acceptance: a known barcode returns the matching product; an unknown barcode returns 404.
T044 acceptance: when a scanned barcode is unknown, the response tells the app to offer retry and
manual search.
T033 acceptance: found, not-found, and empty-search cases pass (search is in
test_product_search_unit.py).

The product repository is replaced with an in-memory fake, so these run anywhere without
Postgres. test_product_lookup.py runs the same endpoint against a real database.
"""

import pytest
from fastapi.testclient import TestClient

from app.repositories.products import get_product_repository
from tests.fakes import LAYS, OATLY, FakeProducts


@pytest.fixture
def products() -> FakeProducts:
    return FakeProducts(LAYS, OATLY)


@pytest.fixture
def client(make_client, products: FakeProducts) -> TestClient:
    client = make_client()
    client.app.dependency_overrides[get_product_repository] = lambda: products
    return client


def test_found_returns_200_with_the_full_product(client, products) -> None:
    response = client.get("/products/7")

    assert response.status_code == 200
    # The exact JSON shape the mobile app's Product type (mobile/src/types/product.ts) expects.
    assert response.json() == {
        "id": 7,
        "barcode": "036000291452",
        "name": "Lay's Sour Cream & Onion",
        "description": None,
        "size": "184g",
        "image_url": "https://example.com/lays.jpg",
        "brand_id": None,
        "category_id": 3,
        "brand": None,
        "category": {
            "id": 3,
            "name": "Chips & Snacks",
            "slug": "chips-snacks",
            "description": None,
        },
        "price": {
            "id": 11,
            "product_id": 7,
            "amount": "3.49",
            "currency": "USD",
            "source": "MCCS",
            "observed_at": "2026-10-01T09:30:00Z",
        },
        "created_at": "2026-09-30T12:00:00Z",
        "updated_at": "2026-09-30T12:00:00Z",
    }
    assert products.requested_ids == [7]


def test_found_without_category_or_price_returns_nulls(client) -> None:
    product = client.get("/products/8").json()

    assert product["name"] == "Oatly Oat Milk"
    assert product["category"] is None
    assert product["price"] is None


def test_not_found_returns_404(client, products) -> None:
    response = client.get("/products/999")

    assert response.status_code == 404
    assert response.json() == {"code": "product_not_found", "message": "Product not found"}
    assert products.requested_ids == [999]


@pytest.mark.parametrize("product_id", ["abc", "-1", "1.5", "7abc", " 7"])
def test_malformed_id_returns_404_without_a_lookup(client, products, product_id) -> None:
    response = client.get(f"/products/{product_id}")

    assert response.status_code == 404
    assert products.requested_ids == []


def test_docs_show_the_path_and_its_404(client) -> None:
    operation = client.app.openapi()["paths"]["/products/{product_id}"]["get"]

    assert "404" in operation["responses"]
    assert operation["parameters"][0]["schema"]["type"] == "integer"


def test_known_barcode_returns_the_matching_product(client, products) -> None:
    response = client.get("/products/barcode/036000291452")

    assert response.status_code == 200
    # Same body as looking the product up by ID.
    assert response.json() == client.get("/products/7").json()
    assert products.requested_barcodes == ["036000291452"]


def test_barcode_lookup_returns_the_right_product(client) -> None:
    product = client.get("/products/barcode/7394376616501").json()

    assert (product["id"], product["name"]) == (8, "Oatly Oat Milk")


def test_unknown_barcode_returns_404_offering_retry_and_manual_search(client, products) -> None:
    response = client.get("/products/barcode/012345678905")

    assert response.status_code == 404
    assert response.json() == {
        "code": "product_not_found",
        "message": "Product not found",
        "actions": ["retry_scan", "manual_search"],
    }
    assert products.requested_barcodes == ["012345678905"]


@pytest.mark.parametrize("code", ["03600029145", "abc"])  # a partial read, and not digits at all
def test_unreadable_barcode_also_offers_retry_and_manual_search(client, code) -> None:
    response = client.get(f"/products/barcode/{code}")

    assert response.status_code == 404
    assert response.json()["actions"] == ["retry_scan", "manual_search"]


def test_unknown_product_id_offers_no_actions(client) -> None:
    # Only a scan can be retried; a missing ID (e.g. a deleted product) is a plain 404.
    assert "actions" not in client.get("/products/999").json()


@pytest.mark.parametrize("path", ["/products/barcode/", "/products/barcode"])
def test_empty_barcode_returns_404(client, products, path) -> None:
    response = client.get(path)

    # No route matches an empty code, so it's the generic 404 and nothing is looked up.
    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": "Not Found"}
    assert products.requested_barcodes == []
    assert products.requested_ids == []


def test_blank_barcode_is_not_found(client, products) -> None:
    response = client.get("/products/barcode/%20")

    assert response.status_code == 404
    assert response.json() == {
        "code": "product_not_found",
        "message": "Product not found",
        "actions": ["retry_scan", "manual_search"],
    }


def test_barcode_route_is_not_mistaken_for_an_id(client, products) -> None:
    client.get("/products/barcode/036000291452")

    assert products.requested_ids == []


def test_docs_show_the_barcode_path_and_its_404(client) -> None:
    schema = client.app.openapi()
    operation = schema["paths"]["/products/barcode/{code}"]["get"]

    assert "404" in operation["responses"]
    assert "actions" in operation["responses"]["404"]["description"]
    assert operation["parameters"][0]["schema"]["type"] == "string"
    actions = schema["components"]["schemas"]["ErrorAction"]
    assert actions["enum"] == ["retry_scan", "manual_search"]
