"""Unit tests for GET /products/{id} and GET /products/barcode/{code}.

T019 acceptance: when the test suite runs, both found and not-found lookup cases pass.
T031 acceptance: a known barcode returns the matching product; an unknown barcode returns 404.

The product repository is replaced with an in-memory fake, so these run anywhere without
Postgres. test_product_lookup.py runs the same endpoint against a real database.
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.repositories.products import get_product_repository
from app.schemas import CategoryRead, PriceRead, ProductRead

CREATED = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)

LAYS = ProductRead(
    id=7,
    barcode="036000291452",
    name="Lay's Sour Cream & Onion",
    size="184g",
    image_url="https://example.com/lays.jpg",
    category_id=3,
    category=CategoryRead(id=3, name="Chips & Snacks", slug="chips-snacks"),
    price=PriceRead(
        id=11,
        product_id=7,
        amount=Decimal("3.49"),
        source="MCCS",
        observed_at=datetime(2026, 10, 1, 9, 30, tzinfo=UTC),
    ),
    created_at=CREATED,
    updated_at=CREATED,
)

# A product with no category and no price yet.
OATLY = ProductRead(
    id=8, barcode="7394376616501", name="Oatly Oat Milk", created_at=CREATED, updated_at=CREATED
)


class FakeProducts:
    """Stands in for ProductRepository: serves products from memory and records lookups."""

    def __init__(self, *products: ProductRead) -> None:
        self._by_id = {product.id: product for product in products}
        self._by_barcode = {product.barcode: product for product in products}
        self.requested_ids: list[int] = []
        self.requested_barcodes: list[str] = []

    def get_by_id(self, product_id: int) -> ProductRead | None:
        self.requested_ids.append(product_id)
        return self._by_id.get(product_id)

    def get_by_barcode(self, barcode: str) -> ProductRead | None:
        self.requested_barcodes.append(barcode)
        return self._by_barcode.get(barcode)


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
    assert response.json() == {"detail": "Product not found"}
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


def test_unknown_barcode_returns_404(client, products) -> None:
    response = client.get("/products/barcode/012345678905")

    assert response.status_code == 404
    assert response.json() == {"detail": "Product not found"}
    assert products.requested_barcodes == ["012345678905"]


def test_barcode_route_is_not_mistaken_for_an_id(client, products) -> None:
    client.get("/products/barcode/036000291452")

    assert products.requested_ids == []


def test_docs_show_the_barcode_path_and_its_404(client) -> None:
    operation = client.app.openapi()["paths"]["/products/barcode/{code}"]["get"]

    assert "404" in operation["responses"]
    assert operation["parameters"][0]["schema"]["type"] == "string"
