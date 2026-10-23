"""Clean up raw source records into our product fields (T062).

Real data is messy: prices are missing or 0, sizes are written "16.9 Ounce", "9.52oz", or not
at all, photos are plain http, and categories are long paths. transform() fixes what it can and
lists what it couldn't in `issues`, so one bad field never stops the import. Only a record that
can't be a product at all (no name, or a barcode that isn't a valid UPC/EAN) is rejected, with
RecordRejected.

Issues (a product can have several):
    no_price        the source has no price (missing, 0, or not a number); stored without one
    price_outlier   the price is over MAX_PRICE, almost certainly a bulk or wrong listing; dropped
    price_spread    the source's highest price is over PRICE_SPREAD times its lowest; kept, but
                    worth a look
    no_size         the size field is empty and the name has no size either
    size_unrecognized  the size field isn't a number and unit (e.g. "One Size"); the size is
                    taken from the name instead, if it has one
    no_image        no https photo (phones block plain http images)
    no_category     the source has no category
    name_truncated, description_truncated  cut to fit the database
"""

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from pydantic import ValidationError

from app.ingest.connectors import RawRecord
from app.schemas import ProductCreate

NAME_MAX_LENGTH = 200
DESCRIPTION_MAX_LENGTH = 2000
SIZE_MAX_LENGTH = 50
CATEGORY_MAX_LENGTH = 100
# A shelf price above this is a case, bulk lot, or mistake, not what a shopper pays.
MAX_PRICE = Decimal("500")
PRICE_SPREAD = 10

# Every way sources write a unit, and how we write it.
_UNITS = {
    "fl oz": ("fl oz", "fl. oz", "fl.oz", "floz", "fluid ounce", "fluid ounces"),
    "oz": ("oz", "ounce", "ounces"),
    "lb": ("lb", "lbs", "pound", "pounds"),
    "g": ("g", "gram", "grams"),
    "kg": ("kg", "kilogram", "kilograms"),
    "mL": ("ml", "milliliter", "milliliters", "millilitre", "millilitres"),
    "L": ("l", "liter", "liters", "litre", "litres"),
    "ct": ("ct", "count"),
}
_UNIT_NAMES = {alias: unit for unit, aliases in _UNITS.items() for alias in aliases}
# Longest first, so "fl oz" wins over "oz" and "lbs" over "lb".
_UNIT_PATTERN = "|".join(
    re.escape(alias).replace(r"\ ", r"\s*") for alias in sorted(_UNIT_NAMES, key=len, reverse=True)
)
# A number and a unit, e.g. "16.9 Ounce", "9.52oz", "20 fl oz". The unit must end the word, so
# "8 grain" isn't read as 8 g.
_SIZE = re.compile(rf"(?<![\d.])(\d+(?:\.\d+)?)\s*({_UNIT_PATTERN})(?![a-z])\.?", re.IGNORECASE)


class RecordRejected(Exception):
    """The record can't be imported as a product; the message says why."""


@dataclass(frozen=True)
class CleanProduct:
    """A source record cleaned up into our product fields, ready to load."""

    source: str
    source_id: str
    barcode: str
    name: str
    description: str | None
    size: str | None
    image_url: str | None
    category: str | None  # the category's name, e.g. "Soda"
    price: Decimal | None
    raw: dict[str, Any]
    issues: tuple[str, ...] = field(default=())


def _clean(text: Any) -> str:
    """Text with runs of spaces and line breaks collapsed to single spaces."""
    return " ".join(str(text or "").split())


def _truncate(text: str, limit: int) -> str:
    """Text cut to `limit` characters, at a word boundary when possible, ending with "…"."""
    cut = text[: limit - 1].rsplit(" ", 1)[0] if " " in text[: limit - 1] else text[: limit - 1]
    return cut.rstrip(" ,;:-") + "…"


def normalize_size(text: str) -> str | None:
    """The first number and unit in `text`, written our way ("16.9 Ounce" -> "16.9 oz", "9.52oz"
    -> "9.52 oz", "2 Pounds" -> "2 lb"), or None if there isn't one."""
    match = _SIZE.search(text)
    if match is None:
        return None
    number, unit = match.groups()
    number = number.rstrip("0").rstrip(".") if "." in number else number
    unit = _UNIT_NAMES[re.sub(r"\s+", " ", unit.lower().replace("fl.oz", "fl oz")).strip()]
    return f"{number} {unit}"


def _barcode(source_id: str) -> str:
    digits = source_id.strip()
    # A 13-digit code starting with 0 is a UPC-A code with a 0 in front. Store the 12 digits
    # printed on the package, which is also what the app sends after a scan.
    if len(digits) == 13 and digits.startswith("0"):
        digits = digits[1:]
    try:
        return ProductCreate(barcode=digits, name="-").barcode
    except ValidationError as exc:
        raise RecordRejected(f"barcode {source_id!r} isn't a valid UPC/EAN") from exc


def _price(item: dict[str, Any], issues: list[str]) -> Decimal | None:
    try:
        lowest = Decimal(str(item.get("lowest_recorded_price") or 0))
        highest = Decimal(str(item.get("highest_recorded_price") or 0))
    except InvalidOperation:
        issues.append("no_price")
        return None
    if not lowest.is_finite() or lowest <= 0:
        issues.append("no_price")
        return None
    if lowest > MAX_PRICE:
        issues.append("price_outlier")
        return None
    if highest.is_finite() and highest > lowest * PRICE_SPREAD:
        issues.append("price_spread")
    return lowest.quantize(Decimal("0.01"))


def _size(item: dict[str, Any], name: str, issues: list[str]) -> str | None:
    given = _clean(item.get("size"))
    if given:
        size = normalize_size(given)
        if size is not None:
            return size
        issues.append("size_unrecognized")
    size = normalize_size(name)  # "It's Skinny Spaghetti Pasta - 9.52oz"
    if size is None and not given:
        issues.append("no_size")
    return size


def _image_url(item: dict[str, Any], issues: list[str]) -> str | None:
    # Phones block plain-http images by default, so only use an https photo.
    for url in item.get("images") or []:
        if isinstance(url, str) and url.startswith("https://") and len(url) <= 2000:
            return url
    issues.append("no_image")
    return None


def _category(item: dict[str, Any], issues: list[str]) -> str | None:
    # "Food, Beverages & Tobacco > Beverages > Soda" -> "Soda"
    category = _clean(str(item.get("category") or "").split(">")[-1])[:CATEGORY_MAX_LENGTH]
    if not category:
        issues.append("no_category")
    return category or None


def transform(record: RawRecord) -> CleanProduct:
    """Clean up one UPCitemdb record. Raises RecordRejected if it can't be a product."""
    item = record.payload
    issues: list[str] = []

    barcode = _barcode(record.source_id)
    name = _clean(item.get("title"))
    if not name:
        raise RecordRejected(f"barcode {barcode} has no product name")
    if len(name) > NAME_MAX_LENGTH:
        name = _truncate(name, NAME_MAX_LENGTH)
        issues.append("name_truncated")
    description = _clean(item.get("description")) or None
    if description and len(description) > DESCRIPTION_MAX_LENGTH:
        description = _truncate(description, DESCRIPTION_MAX_LENGTH)
        issues.append("description_truncated")

    return CleanProduct(
        source=record.source,
        source_id=record.source_id,
        barcode=barcode,
        name=name,
        description=description,
        size=_size(item, name, issues),
        image_url=_image_url(item, issues),
        category=_category(item, issues),
        price=_price(item, issues),
        raw=item,
        issues=tuple(issues),
    )
