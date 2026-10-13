"""Unit tests for GET /products/search, with no database.

T033 acceptance: when the tests run, found, not-found, and empty-search cases all pass. (The
barcode lookup's found and not-found cases are in test_product_lookup_unit.py.)

The repository is an in-memory fake, so these check the endpoint itself: what it passes to the
repository, what it returns, and which requests it rejects. Matching (typos, ranking) is tested
against Postgres in test_product_search.py and test_product_repository.py.
"""

import pytest
from fastapi.testclient import TestClient

from app.api.products import MAX_SEARCH_LIMIT
from app.repositories.products import get_product_repository
from tests.fakes import DORITOS, LAYS, OATLY, FakeProducts, Search


@pytest.fixture
def products() -> FakeProducts:
    return FakeProducts(LAYS, OATLY, DORITOS)


@pytest.fixture
def client(make_client, products: FakeProducts) -> TestClient:
    client = make_client()
    client.app.dependency_overrides[get_product_repository] = lambda: products
    return client


def search(client: TestClient, **params: object) -> list[dict]:
    response = client.get("/products/search", params=params)
    assert response.status_code == 200
    return response.json()


# Found


def test_found_returns_the_matching_products_in_full(client) -> None:
    [product] = search(client, q="oat milk")

    # The same body as GET /products/{id}, so the app can show results with its Product type.
    assert product == client.get("/products/8").json()


def test_found_in_a_category_returns_only_that_category(client) -> None:
    found = search(client, category="chips-snacks")

    assert [product["name"] for product in found] == [LAYS.name, DORITOS.name]
    assert all(product["category"]["slug"] == "chips-snacks" for product in found)


def test_found_with_name_and_category(client) -> None:
    found = search(client, q="doritos", category="chips-snacks")

    assert [product["id"] for product in found] == [DORITOS.id]


# Not found


@pytest.mark.parametrize(
    "params",
    [
        {"q": "xqzvplmw"},
        {"category": "no-such-category"},
        {"q": "oat milk", "category": "chips-snacks"},  # each matches, but not together
    ],
)
def test_not_found_returns_an_empty_list_not_404(client, params) -> None:
    response = client.get("/products/search", params=params)

    assert response.status_code == 200
    assert response.json() == []


# Empty search


@pytest.mark.parametrize("params", [{}, {"q": ""}, {"q": "   "}, {"category": ""}])
def test_empty_search_returns_an_empty_list(client, params) -> None:
    response = client.get("/products/search", params=params)

    assert response.status_code == 200
    assert response.json() == []


# What the endpoint passes on


def test_defaults_are_passed_to_the_repository(client, products) -> None:
    search(client, q="chips")

    assert products.searches == [Search("chips", None, limit=20, offset=0)]


def test_all_parameters_are_passed_to_the_repository(client, products) -> None:
    search(client, q="chips", category="chips-snacks", limit=5, offset=10)

    assert products.searches == [Search("chips", "chips-snacks", limit=5, offset=10)]


def test_search_is_not_mistaken_for_a_product_id(client, products) -> None:
    search(client, q="chips")

    assert products.requested_ids == []


# Rejected requests


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": MAX_SEARCH_LIMIT + 1},
        {"limit": "ten"},
        {"offset": -1},
        {"offset": 10_001},
        {"q": "x" * 101},
        {"category": "x" * 101},
    ],
)
def test_invalid_parameters_are_rejected_before_searching(client, products, params) -> None:
    response = client.get("/products/search", params={"q": "chips", **params})

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    [problem] = body["details"]
    assert problem["loc"] == ["query", next(iter(params))]
    assert products.searches == []


def test_largest_allowed_limit_is_accepted(client, products) -> None:
    search(client, q="chips", limit=MAX_SEARCH_LIMIT)

    assert products.searches[0].limit == MAX_SEARCH_LIMIT


def test_docs_show_search_returns_a_list_of_products(client) -> None:
    operation = client.app.openapi()["paths"]["/products/search"]["get"]

    schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert schema["type"] == "array"
    assert schema["items"] == {"$ref": "#/components/schemas/ProductRead"}
    assert {param["name"] for param in operation["parameters"]} == {
        "q",
        "category",
        "limit",
        "offset",
    }
