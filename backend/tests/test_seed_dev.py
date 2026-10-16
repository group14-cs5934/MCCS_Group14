"""The development seed's sample catalog (scripts/seed_dev.py, data from the T022 spike).

T043 acceptance: when I scan a product in the catalog, its product page shows the correct name and
price. The database tests here check the API half: each seeded product is found by the barcode
the app sends after a scan, with its name and price. The app half (scan -> request -> page) is
mobile/__tests__/scan-to-product.test.tsx.
"""

import json
from collections.abc import Iterator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.config import load_settings
from app.main import create_app
from scripts.seed_dev import SAMPLE_CATALOG_FILE, catalog_product, seed_sample_catalog

SAMPLE_ITEMS = json.loads(SAMPLE_CATALOG_FILE.read_text(encoding="utf-8"))
PEPSI_20OZ = next(item for item in SAMPLE_ITEMS if item["ean"] == "0012000001291")


def test_every_sample_product_is_valid() -> None:
    entries = [catalog_product(item) for item in SAMPLE_ITEMS]

    assert len(entries) == len(SAMPLE_ITEMS) > 0
    barcodes = [entry.product.barcode for entry in entries]
    assert len(set(barcodes)) == len(barcodes)


def test_sample_product_is_stored_the_way_the_app_scans_it() -> None:
    product, category, price = catalog_product(
        {
            **PEPSI_20OZ,
            "title": "Diet  Pepsi\nCola",
            "images": ["http://example.com/a.jpg", "https://example.com/b.jpg"],
            "lowest_recorded_price": 1.5,
        }
    )

    # The source's EAN-13 0012000001291 is stored as the UPC-A printed on the bottle.
    assert product.barcode == "012000001291"
    assert product.name == "Diet Pepsi Cola"
    assert str(product.image_url) == "https://example.com/b.jpg"  # phones block http images
    assert category == "Soda"
    assert price == Decimal("1.50")


def test_sample_product_without_price_or_https_photo() -> None:
    product, _, price = catalog_product(
        {**PEPSI_20OZ, "images": ["http://example.com/a.jpg"], "lowest_recorded_price": 0}
    )

    assert product.image_url is None
    assert price is None


@pytest.fixture
def client(db_url: str) -> Iterator[TestClient]:
    app = create_app(load_settings(_env_file=None, database_url=db_url))
    with TestClient(app) as client:
        yield client


def test_each_seeded_product_is_found_by_its_scanned_barcode(client, connection) -> None:
    with connection.cursor() as cursor:
        assert seed_sample_catalog(cursor) == len(SAMPLE_ITEMS)
    connection.commit()

    for item in SAMPLE_ITEMS:
        expected = catalog_product(item)
        # Android reads a UPC-A barcode as 12 digits; the source lists it as a 13-digit EAN.
        for code in {expected.product.barcode, item["ean"]}:
            response = client.get(f"/products/barcode/{code}")

            assert response.status_code == 200, code
            product = response.json()
            assert product["name"] == expected.product.name
            if expected.price is None:
                assert product["price"] is None
            else:
                assert Decimal(product["price"]["amount"]) == expected.price
                assert product["price"]["source"] == "UPCitemdb"


def test_seeding_again_adds_nothing(connection) -> None:
    with connection.cursor() as cursor:
        seed_sample_catalog(cursor)
        assert seed_sample_catalog(cursor) == 0
        cursor.execute("SELECT count(*) FROM products")
        assert cursor.fetchone() == (len(SAMPLE_ITEMS),)
