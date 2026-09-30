from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas import BrandCreate, CategoryCreate, PriceCreate, ProductCreate, ProductRead


@pytest.mark.parametrize(
    "barcode",
    [
        "73513537",  # EAN-8
        "036000291452",  # UPC-A
        "4006381333931",  # EAN-13
        "00012345600012",  # GTIN-14
    ],
)
def test_valid_barcodes_are_accepted(barcode):
    assert ProductCreate(barcode=barcode, name="Item").barcode == barcode


@pytest.mark.parametrize(
    ("barcode", "reason"),
    [
        ("036000291453", "check digit"),
        ("12345", "8, 12, 13, or 14 digits"),
        ("03600029145A", "8, 12, 13, or 14 digits"),
        ("", "8, 12, 13, or 14 digits"),
    ],
)
def test_invalid_barcodes_are_rejected(barcode, reason):
    with pytest.raises(ValidationError, match=reason):
        ProductCreate(barcode=barcode, name="Item")


def test_price_is_exact_decimal_serialized_as_string():
    price = PriceCreate(product_id=1, amount="3.49")

    assert price.amount == Decimal("3.49")
    assert price.currency == "USD"
    assert price.model_dump(mode="json")["amount"] == "3.49"


@pytest.mark.parametrize("amount", ["0", "-1.00", "3.499", "abc"])
def test_invalid_price_amounts_are_rejected(amount):
    with pytest.raises(ValidationError):
        PriceCreate(product_id=1, amount=amount)


@pytest.mark.parametrize("currency", ["usd", "US", "DOLLARS"])
def test_currency_must_be_iso_code(currency):
    with pytest.raises(ValidationError):
        PriceCreate(product_id=1, amount="1.00", currency=currency)


@pytest.mark.parametrize("slug", ["Chips", "chips snacks", "chips--snacks", "-chips"])
def test_category_slug_must_be_lowercase_words_with_hyphens(slug):
    with pytest.raises(ValidationError):
        CategoryCreate(name="Chips", slug=slug)


def test_product_read_builds_from_database_objects():
    """from_attributes lets routes return ORM rows directly (used from T017 on)."""
    now = datetime(2026, 10, 1, tzinfo=UTC)
    row = SimpleNamespace(
        id=7,
        barcode="036000291452",
        name="Lay's Sour Cream & Onion",
        description=None,
        size="184g",
        image_url=None,
        brand_id=2,
        category_id=3,
        brand=SimpleNamespace(id=2, name="Lay's"),
        category=SimpleNamespace(
            id=3, name="Chips & Snacks", slug="chips-snacks", description=None
        ),
        price=SimpleNamespace(
            id=11,
            product_id=7,
            amount=Decimal("3.49"),
            currency="USD",
            source="MCCS",
            observed_at=now,
        ),
        created_at=now,
        updated_at=now,
    )

    product = ProductRead.model_validate(row)

    assert product.brand is not None and product.brand.name == "Lay's"
    assert product.category is not None and product.category.slug == "chips-snacks"
    assert product.price is not None and product.price.amount == Decimal("3.49")
    assert product.model_dump(mode="json")["price"]["amount"] == "3.49"


def test_brand_name_is_required_and_trimmed():
    assert BrandCreate(name="  Lay's  ").name == "Lay's"
    with pytest.raises(ValidationError):
        BrandCreate(name="   ")
