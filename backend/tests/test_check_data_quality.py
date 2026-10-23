"""The post-sync spot check (T076). Database tests are skipped without TEST_DATABASE_URL.

T076 acceptance: when the full import finishes, spot checks of 20 products show correct names,
prices, and images. The real run's report is in docs/data-quality/.
"""

import urllib.error
from decimal import Decimal

import pytest

from scripts import check_data_quality
from scripts.check_data_quality import check_product
from scripts.seed_dev import SAMPLE_CATALOG_FILE
from scripts.sync_products import main as sync

GOOD = {
    "id": 1,
    "barcode": "012000171741",
    "name": "Diet Pepsi Cola Soda- 20 fl oz Bottle",
    "size": "20 fl oz",
    "image_url": "https://example.com/pepsi.jpg",
    "category": "Soda",
    "price": Decimal("1.59"),
}


def loads_as(content_type: str):
    return lambda url: content_type


def test_good_product_passes() -> None:
    assert check_product(GOOD, loads_as("image/jpeg")).problems == []


@pytest.mark.parametrize(
    ("changes", "problem"),
    [
        ({"name": "W�sthof Knife"}, "name looks garbled"),
        ({"name": "W?sthof Knife"}, "name looks garbled"),
        ({"name": "OREO COOKIES SLEEVE PACK"}, "name is all capitals"),
        ({"price": None}, "no price"),
        ({"price": Decimal("0.01")}, "price $0.01 looks wrong"),
        ({"price": Decimal("899.00")}, "price $899.00 looks wrong"),
        ({"size": None}, "no size"),
        ({"image_url": None}, "no photo"),
        ({"image_url": "http://example.com/p.jpg"}, "photo isn't https"),
    ],
)
def test_problems_are_reported(changes, problem) -> None:
    assert problem in check_product({**GOOD, **changes}, loads_as("image/jpeg")).problems


def test_photo_that_doesnt_load_is_reported() -> None:
    def broken(url):
        raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)

    assert check_product(GOOD, broken).problems == ["photo doesn't load (HTTPError)"]


def test_photo_url_that_isnt_an_image_is_reported() -> None:
    problems = check_product(GOOD, loads_as("text/html; charset=utf-8")).problems

    assert problems == ["photo URL isn't an image (text/html; charset=utf-8)"]


def test_skipping_images_doesnt_load_them() -> None:
    assert check_product(GOOD, None).problems == []


def test_spot_check_of_an_imported_catalog(db_url, capsys) -> None:
    sync(["--file", str(SAMPLE_CATALOG_FILE)], database_url=db_url)

    status = check_data_quality.main(["--count", "20"], db_url, image_check=loads_as("image/png"))

    out = capsys.readouterr().out
    assert "Spot check of 18 imported products" in out  # all 18, fewer than asked
    assert out.count("\n| ") == 18 + 2  # a row per product, plus the header and its rule
    assert status == 1  # the sample has products without a price or size


def test_same_seed_picks_the_same_products(db_url, capsys) -> None:
    sync(["--file", str(SAMPLE_CATALOG_FILE)], database_url=db_url)

    check_data_quality.main(["--count", "5", "--skip-images"], db_url)
    first = capsys.readouterr().out
    check_data_quality.main(["--count", "5", "--skip-images"], db_url)

    assert capsys.readouterr().out == first


def test_nothing_imported_is_an_error(db_url) -> None:
    assert check_data_quality.main(["--skip-images"], db_url) == 1
