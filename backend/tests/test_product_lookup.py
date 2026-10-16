"""Product lookups against a real database (skipped without TEST_DATABASE_URL).

T018 acceptance: a valid product ID returns name, price, photo URL, and category; an invalid ID
returns 404. T031 acceptance: a known barcode returns the matching product; an unknown barcode
returns 404. T043: the barcode the scanner sends finds the product however many leading zeros
it was stored with. Unit tests that need no database are in test_product_lookup_unit.py.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app
from tests.factories import BARCODE, add_price, add_product


@pytest.fixture
def client(db_url: str) -> Iterator[TestClient]:
    """Client for an app connected to the test database."""
    app = create_app(load_settings(_env_file=None, database_url=db_url))
    with TestClient(app) as client:
        yield client


def test_valid_id_returns_name_price_photo_and_category(client, connection) -> None:
    product_id = add_product(connection, category_slug="snacks")
    add_price(connection, product_id, "3.49", "2026-10-01")
    connection.commit()

    response = client.get(f"/products/{product_id}")

    assert response.status_code == 200
    product = response.json()
    assert product["id"] == product_id
    assert product["barcode"] == BARCODE
    assert product["name"] == "Sample Chips"
    assert product["image_url"] == "https://example.com/chips.jpg"
    assert product["price"]["amount"] == "3.49"
    assert product["price"]["currency"] == "USD"
    assert product["category"]["name"] == "Snacks"
    assert product["category"]["slug"] == "snacks"


def test_product_without_price_or_category_returns_nulls(client, connection) -> None:
    product_id = add_product(connection)
    connection.commit()

    product = client.get(f"/products/{product_id}").json()

    assert product["name"] == "Sample Chips"
    assert product["price"] is None
    assert product["category"] is None


@pytest.mark.parametrize("product_id", [999, 0, 2**31])  # 2**31 is past Postgres's INTEGER max
def test_unknown_id_returns_404(client, product_id) -> None:
    response = client.get(f"/products/{product_id}")

    assert response.status_code == 404
    assert response.json() == {"code": "product_not_found", "message": "Product not found"}


def test_known_barcode_returns_the_matching_product(client, connection) -> None:
    product_id = add_product(connection, category_slug="snacks")
    add_price(connection, product_id, "3.49", "2026-10-01")
    connection.commit()

    response = client.get(f"/products/barcode/{BARCODE}")

    assert response.status_code == 200
    assert response.json() == client.get(f"/products/{product_id}").json()


@pytest.mark.parametrize(
    ("stored", "sent"),
    [
        ("0012000001291", "012000001291"),  # stored as EAN-13 (as data sources give it), app scans
        ("012000001291", "0012000001291"),  # stored as UPC-A, sent as EAN-13
        ("012000001291", "00012000001291"),  # sent as GTIN-14 (case barcodes)
        ("40170725", "0000040170725"),  # EAN-8 padded to 13 digits
    ],
)
def test_barcode_matches_whatever_leading_zeros_it_was_stored_with(
    client, connection, stored, sent
) -> None:
    product_id = add_product(connection, barcode=stored)
    connection.commit()

    response = client.get(f"/products/barcode/{sent}")

    assert response.status_code == 200
    assert response.json()["id"] == product_id
    assert response.json()["barcode"] == stored


def test_exact_barcode_match_wins_over_a_zero_padded_one(client, connection) -> None:
    padded_id = add_product(connection, barcode="0012000001291")
    exact_id = add_product(connection, barcode="012000001291")
    connection.commit()

    assert client.get("/products/barcode/012000001291").json()["id"] == exact_id
    assert client.get("/products/barcode/0012000001291").json()["id"] == padded_id


@pytest.mark.parametrize(
    "code",
    [
        "012345678905",  # valid barcode, just not in the database
        "36000291452",  # BARCODE without its leading 0: 11 digits isn't a barcode length
        "1036000291452",  # BARCODE with a 1 in front: a different product
        "abc",
        "0360002914520000",  # longer than any barcode
        "036000291452%00",  # NUL byte, which Postgres can't take as text
    ],
)
def test_unknown_barcode_returns_404(client, connection, code) -> None:
    add_product(connection)
    connection.commit()

    response = client.get(f"/products/barcode/{code}")

    assert response.status_code == 404
    assert response.json() == {"code": "product_not_found", "message": "Product not found"}
