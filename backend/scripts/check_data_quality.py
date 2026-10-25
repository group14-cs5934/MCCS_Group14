"""Spot-check imported products after a sync (T076).

    uv run python -m scripts.check_data_quality                    # 20 random imported products
    uv run python -m scripts.check_data_quality --count 50 --output report.md

Picks imported products at random and checks what a shopper would see: a readable name, a
plausible current price, a size, and a photo that actually loads (an https URL that answers with
an image). Prints a Markdown report, one row per product, and exits with status 1 if any product
fails a check. --skip-images skips loading the photos (no network).
"""

import argparse
import logging
import os
import re
import sys
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from app.core.config import get_settings

logger = logging.getLogger("app.ingest")

DEFAULT_COUNT = 20
MIN_PRICE, MAX_PRICE = Decimal("0.25"), Decimal("500")
IMAGE_TIMEOUT_SECONDS = 10

# Returns the photo's content type if it loads, or raises (any exception) if it doesn't.
ImageCheck = Callable[[str], str]

_SAMPLE = """
SELECT p.id, p.barcode, p.name, p.size, p.image_url, c.name AS category, pr.amount AS price
FROM products AS p
LEFT JOIN categories AS c ON c.id = p.category_id
LEFT JOIN LATERAL (
    SELECT amount FROM prices WHERE prices.product_id = p.id
    ORDER BY observed_at DESC, id DESC LIMIT 1
) AS pr ON TRUE
WHERE p.source IS NOT NULL
ORDER BY md5(p.id::text || %(seed)s), p.id
LIMIT %(count)s
"""


@dataclass
class Check:
    product: dict
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def load_image(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "MCCS-Group14-quality/1.0"})
    with urllib.request.urlopen(request, timeout=IMAGE_TIMEOUT_SECONDS) as response:
        return response.headers.get("Content-Type", "")


def check_product(product: dict, image_check: ImageCheck | None) -> Check:
    check = Check(product)
    name = product["name"] or ""
    # "\ufffd" and "W?sthof" are what a character the source couldn't encode turns into.
    if len(name) < 3 or "\ufffd" in name or re.search(r"\w\?\w", name):
        check.problems.append("name looks garbled")
    elif name.isupper():
        check.problems.append("name is all capitals")
    price = product["price"]
    if price is None:
        check.problems.append("no price")
    elif not MIN_PRICE <= price <= MAX_PRICE:
        check.problems.append(f"price ${price} looks wrong")
    if not product["size"]:
        check.problems.append("no size")
    url = product["image_url"]
    if not url:
        check.problems.append("no photo")
    elif not url.startswith("https://"):
        check.problems.append("photo isn't https")
    elif image_check is not None:
        try:
            content_type = image_check(url)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            check.problems.append(f"photo doesn't load ({type(exc).__name__})")
        else:
            if not content_type.startswith("image/"):
                check.problems.append(f"photo URL isn't an image ({content_type or 'no type'})")
    return check


def sample_products(connection: psycopg.Connection, count: int, seed: str) -> list[dict]:
    with connection.cursor(row_factory=dict_row) as cursor:
        return cursor.execute(_SAMPLE, {"count": count, "seed": seed}).fetchall()


def report(checks: list[Check], images_checked: bool) -> str:
    passed = sum(check.ok for check in checks)
    lines = [
        f"Spot check of {len(checks)} imported products: {passed} passed, "
        f"{len(checks) - passed} with problems"
        + ("" if images_checked else " (photos not loaded)")
        + ".",
        "",
        "| # | Barcode | Name | Size | Price | Photo | Result |",
        "| - | ------- | ---- | ---- | ----- | ----- | ------ |",
    ]
    for number, check in enumerate(checks, start=1):
        product = check.product
        name = (product["name"] or "").replace("|", "/")
        price = f"${product['price']}" if product["price"] is not None else "-"
        photo = "yes" if product["image_url"] else "-"
        result = "OK" if check.ok else "; ".join(check.problems)
        lines.append(
            f"| {number} | {product['barcode']} | {name} | {product['size'] or '-'} | {price} "
            f"| {photo} | {result} |"
        )
    return "\n".join(lines) + "\n"


def main(
    argv: list[str] | None = None,
    database_url: str | None = None,
    image_check: ImageCheck = load_image,
) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT, help="products to check")
    parser.add_argument("--seed", default="t076", help="pick a different random sample")
    parser.add_argument("--skip-images", action="store_true", help="don't load the photos")
    parser.add_argument("--output", type=Path, help="also write the report to this file")
    args = parser.parse_args(argv)

    url = database_url or os.environ.get("DATABASE_URL") or str(get_settings().database_url)
    with psycopg.connect(url, prepare_threshold=None) as connection:
        products = sample_products(connection, args.count, args.seed)
    if not products:
        logger.error("No imported products to check; run scripts/sync_products.py first")
        return 1

    checks = [check_product(p, None if args.skip_images else image_check) for p in products]
    text = report(checks, images_checked=not args.skip_images)
    print(text)
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    return 0 if all(check.ok for check in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
