"""Cleaning up source records into product fields (T062).

T062 acceptance: when raw data has missing prices or odd units, it is cleaned or flagged instead
of crashing the import.
"""

import logging
from decimal import Decimal

import pytest

from app.ingest.connectors import JsonFileConnector, RawRecord
from app.ingest.transform import RecordRejected, normalize_size, transform
from scripts import sync_products
from scripts.seed_dev import SAMPLE_CATALOG_FILE

GOOD = {
    "ean": "0012000171741",
    "title": "Diet Pepsi Cola Soda- 20 fl oz Bottle",
    "description": "Zero calories.\n  Crisp   taste.",
    "size": "",
    "category": "Food, Beverages & Tobacco > Beverages > Soda",
    "lowest_recorded_price": 1.59,
    "highest_recorded_price": 2.99,
    "images": ["http://example.com/plain.jpg", "https://example.com/pepsi.jpg"],
}


def clean(**changes):
    item = {**GOOD, **changes}
    return transform(RawRecord("upcitemdb", str(item.get("ean", "")), item))


def test_good_record_is_cleaned_into_product_fields() -> None:
    product = clean()

    assert product.barcode == "012000171741"  # the 12 digits on the package
    assert product.source_id == "0012000171741"  # the source's own ID is kept as is
    assert product.name == "Diet Pepsi Cola Soda- 20 fl oz Bottle"
    assert product.description == "Zero calories. Crisp taste."
    assert product.size == "20 fl oz"
    assert product.category == "Soda"
    assert product.price == Decimal("1.59")
    assert product.image_url == "https://example.com/pepsi.jpg"
    assert product.issues == ()
    assert product.raw["ean"] == "0012000171741"


@pytest.mark.parametrize("price", [None, 0, "0", "", "n/a", "NaN", -2])
def test_missing_price_is_flagged_not_a_crash(price) -> None:
    product = clean(lowest_recorded_price=price)

    assert product.price is None
    assert product.issues == ("no_price",)


def test_missing_price_field_is_flagged() -> None:
    item = {key: value for key, value in GOOD.items() if key != "lowest_recorded_price"}

    product = transform(RawRecord("upcitemdb", GOOD["ean"], item))

    assert product.price is None
    assert "no_price" in product.issues


def test_price_is_rounded_to_cents() -> None:
    assert clean(lowest_recorded_price=2.499).price == Decimal("2.50")


def test_implausible_price_is_dropped_and_flagged() -> None:
    product = clean(lowest_recorded_price=1250, highest_recorded_price=1300)

    assert product.price is None
    assert product.issues == ("price_outlier",)


def test_wide_price_spread_is_kept_but_flagged() -> None:
    product = clean(lowest_recorded_price=1.95, highest_recorded_price=99)

    assert product.price == Decimal("1.95")
    assert product.issues == ("price_spread",)


@pytest.mark.parametrize(
    ("text", "size"),
    [
        ("16.9 Ounce", "16.9 oz"),
        ("8.8 Ounces", "8.8 oz"),
        ("9.52oz", "9.52 oz"),
        ("24/16.9 oz. bottles", "16.9 oz"),
        ("20 FL OZ", "20 fl oz"),
        ("12 fl. oz", "12 fl oz"),
        ("2 Pounds", "2 lb"),
        ("3 lbs", "3 lb"),
        ("0.050 kg", "0.05 kg"),
        ("184g", "184 g"),
        ("500 ML", "500 mL"),
        ("2 Liters", "2 L"),
        ("12 count", "12 ct"),
        ("16.0 oz", "16 oz"),
    ],
)
def test_odd_units_are_normalized(text, size) -> None:
    assert normalize_size(text) == size


@pytest.mark.parametrize("text", ["One Size", "Large", "8 grain bread", "3-Inch", ""])
def test_text_without_a_size_gives_none(text) -> None:
    assert normalize_size(text) is None


def test_size_field_wins_over_the_name() -> None:
    assert clean(size="2 Liters").size == "2 L"


def test_size_is_taken_from_the_name_when_the_field_is_empty() -> None:
    assert clean(size="", title="It's Skinny Spaghetti Pasta - 9.52oz").size == "9.52 oz"


def test_unrecognized_size_is_flagged_and_the_name_is_used() -> None:
    product = clean(size="One Size", title="Cereal 8.6 oz")

    assert (product.size, product.issues) == ("8.6 oz", ("size_unrecognized",))


def test_no_size_anywhere_is_flagged() -> None:
    product = clean(title="Pasta Express")

    assert (product.size, product.issues) == (None, ("no_size",))


def test_only_https_photos_are_used() -> None:
    product = clean(images=["http://example.com/a.jpg"])

    assert (product.image_url, product.issues) == (None, ("no_image",))


@pytest.mark.parametrize("category", ["", None, " > "])
def test_missing_category_is_flagged(category) -> None:
    product = clean(category=category)

    assert (product.category, product.issues) == (None, ("no_category",))


def test_overlong_name_is_cut_at_a_word_and_flagged() -> None:
    product = clean(title="Crunchy " * 40, size="12 oz")

    assert len(product.name) <= 200
    assert product.name.endswith("Crunchy…")
    assert product.issues == ("name_truncated",)


def test_several_problems_are_all_listed() -> None:
    product = clean(lowest_recorded_price=0, images=[], category="", title="Pasta Express")

    assert set(product.issues) == {"no_price", "no_image", "no_category", "no_size"}


@pytest.mark.parametrize(
    ("ean", "reason"),
    [("0012000171742", "isn't a valid UPC/EAN"), ("12345", "isn't a valid UPC/EAN")],
)
def test_bad_barcode_is_rejected(ean, reason) -> None:
    with pytest.raises(RecordRejected, match=reason):
        clean(ean=ean)


@pytest.mark.parametrize("title", ["", "   ", None])
def test_record_without_a_name_is_rejected(title) -> None:
    with pytest.raises(RecordRejected, match="no product name"):
        clean(title=title)


def test_every_spike_record_is_cleaned_without_crashing() -> None:
    products = [transform(record) for record in JsonFileConnector(SAMPLE_CATALOG_FILE).fetch()]

    assert len(products) == 18
    assert sum(product.price is None for product in products) == 2  # the two with price 0
    assert all(
        product.image_url is None or product.image_url.startswith("https://")
        for product in products
    )


def test_sync_command_reports_rejected_and_flagged_records(tmp_path, caplog) -> None:
    path = tmp_path / "records.json"
    path.write_text(
        '[{"ean": "0012000171741", "title": "Diet Pepsi", "lowest_recorded_price": 0},'
        ' {"ean": "0012000171742", "title": "Bad check digit"}]',
        encoding="utf-8",
    )

    with caplog.at_level(logging.INFO, logger="app.ingest"):
        status = sync_products.main(["--dry-run", "--file", str(path)])

    assert status == 0
    assert "Rejected upcitemdb record 0012000171742" in caplog.text
    assert "012000171741 Diet Pepsi: no_size, no_image, no_category, no_price" in caplog.text
    assert "Cleaned 1 products (1 with issues), rejected 1" in caplog.text
