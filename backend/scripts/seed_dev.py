"""Seed the development database with a small sample product set.

Adds Sample Chips (always product 1 in a fresh database), then the real products collected by the
T022 spike (sample_products.json) with their names, photos, categories, and prices, so scanning
one of them in the app shows its product page. Safe to run again: products already in the
database (by barcode) are skipped.
"""

import json
import re
from decimal import Decimal
from pathlib import Path
from typing import Any, NamedTuple

import psycopg

from app.core.config import get_settings
from app.schemas import ProductCreate

SAMPLE_CATALOG_FILE = Path(__file__).resolve().parent / "sample_products.json"
SAMPLE_CATALOG_PRICE_SOURCE = "UPCitemdb"

SAMPLE_CATEGORIES = [
    {
        "name": "Snacks",
        "slug": "snacks",
        "description": "Snack foods and packaged snacks.",
    },
    {
        "name": "Beverages",
        "slug": "beverages",
        "description": "Drinks and beverages.",
    },
]

SAMPLE_PRODUCTS = [
    {
        "barcode": "036000291452",
        "name": "Sample Chips",
        "description": "Sample snack product for development.",
        "size": "184g",
        "image_url": None,
        "brand_id": None,
        "category_slug": "snacks",
    },
]


# The hours are samples for development (T080's store page), not the stores' real hours.
SAMPLE_STORES = [
    {
        "name": "Camp Lejeune MCX",
        "slug": "camp-lejeune-mcx",
        "address": "Bldg. 1231 Birch St., Camp Lejeune, NC 28547",
        "hours": "Mon–Sat 9 AM–9 PM · Sun 10 AM–6 PM (sample hours)",
    },
    {
        "name": "New River MCX",
        "slug": "new-river-mcx",
        "address": "Bldg. AS-4040 Curtis Rd., MCAS New River, NC 28540",
        "hours": "Mon–Fri 9 AM–8 PM · Sat–Sun 10 AM–6 PM (sample hours)",
    },
    {
        # The MCCS online store, where jobs/product-monitor reads prices and stock from.
        "name": "MCX Online Store",
        "slug": "mcx-online",
        "address": None,
        "hours": "Open 24/7 online (sample hours)",
    },
]


def seed() -> None:
    """Insert development sample data into the database."""
    settings = get_settings()

    with psycopg.connect(str(settings.database_url)) as connection:
        with connection.cursor() as cursor:
            # Seed categories first because products reference categories.
            for category in SAMPLE_CATEGORIES:
                cursor.execute(
                    """
                    INSERT INTO categories (name, slug, description)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (slug) DO NOTHING
                    """,
                    (
                        category["name"],
                        category["slug"],
                        category["description"],
                    ),
                )

            # Seed sample products.
            for product in SAMPLE_PRODUCTS:
                # Skip the product if its barcode already exists.
                cursor.execute(
                    "SELECT id FROM products WHERE barcode = %s",
                    (product["barcode"],),
                )
                existing_product = cursor.fetchone()

                if existing_product is not None:
                    continue

                # Find the category ID using the category slug.
                cursor.execute(
                    "SELECT id FROM categories WHERE slug = %s",
                    (product["category_slug"],),
                )
                category_row = cursor.fetchone()

                if category_row is None:
                    raise RuntimeError(f"Category '{product['category_slug']}' was not found.")

                category_id = category_row[0]

                cursor.execute(
                    """
                    INSERT INTO products (
                        barcode,
                        name,
                        description,
                        size,
                        image_url,
                        brand_id,
                        category_id
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        product["barcode"],
                        product["name"],
                        product["description"],
                        product["size"],
                        product["image_url"],
                        product["brand_id"],
                        category_id,
                    ),
                )

            seed_sample_catalog(cursor)
            seed_store_locations(cursor)

        connection.commit()


def seed_store_locations(cursor: psycopg.Cursor) -> int:
    """Insert demo MCCS stores; skip existing store slugs, but give them sample hours if they
    have none yet (stores seeded before T080 added hours)."""
    added = 0

    for store in SAMPLE_STORES:
        cursor.execute(
            """
            INSERT INTO store_locations (name, slug, address, hours)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (slug) DO NOTHING
            RETURNING id
            """,
            (
                store["name"],
                store["slug"],
                store["address"],
                store["hours"],
            ),
        )

        if cursor.fetchone() is not None:
            added += 1
        else:
            cursor.execute(
                "UPDATE store_locations SET hours = %s WHERE slug = %s AND hours IS NULL",
                (store["hours"], store["slug"]),
            )

    return added


class CatalogProduct(NamedTuple):
    """One sample_products.json entry, ready to store."""

    product: ProductCreate
    category: str | None
    price: Decimal | None  # None if the source has no price


def catalog_product(item: dict[str, Any]) -> CatalogProduct:
    """Convert one sample_products.json entry. Raises ValueError if it isn't a valid product
    (e.g. a wrong check digit)."""
    ean = item["ean"]
    # A 13-digit code starting with 0 is a UPC-A code with a 0 in front. Store the 12 digits
    # printed on the package, which is also what the app sends after a scan.
    barcode = ean[1:] if len(ean) == 13 and ean.startswith("0") else ean
    # Phones block plain-http images by default, so only use an https photo.
    image_url = next((url for url in item.get("images", []) if url.startswith("https://")), None)
    product = ProductCreate(
        barcode=barcode,
        name=_clean(item["title"]),
        description=_clean(item.get("description")) or None,
        size=_clean(item.get("size")) or None,
        image_url=image_url,
    )
    # "Food, Beverages & Tobacco > Beverages > Soda" -> "Soda"
    category = _clean(item.get("category", "").split(">")[-1]) or None
    price = Decimal(str(item.get("lowest_recorded_price") or 0)).quantize(Decimal("0.01"))
    return CatalogProduct(product, category, price if price > 0 else None)


def seed_sample_catalog(cursor: psycopg.Cursor) -> int:
    """Insert every product in sample_products.json that isn't already stored; return how many
    were added."""
    items = json.loads(SAMPLE_CATALOG_FILE.read_text(encoding="utf-8"))
    added = 0
    for item in items:
        product, category, price = catalog_product(item)

        category_id = None
        if category:
            cursor.execute(
                """
                INSERT INTO categories (name, slug) VALUES (%s, %s)
                ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug  -- no-op, so RETURNING
                RETURNING id                                           -- gives the existing id
                """,
                (category, _slug(category)),
            )
            (category_id,) = cursor.fetchone()

        cursor.execute(
            """
            INSERT INTO products (barcode, name, description, size, image_url, category_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (barcode) DO NOTHING
            RETURNING id
            """,
            (
                product.barcode,
                product.name,
                product.description,
                product.size,
                str(product.image_url) if product.image_url else None,
                category_id,
            ),
        )
        inserted = cursor.fetchone()
        if inserted is None:
            continue
        added += 1

        if price is not None:
            cursor.execute(
                "INSERT INTO prices (product_id, amount, source) VALUES (%s, %s, %s)",
                (inserted[0], price, SAMPLE_CATALOG_PRICE_SOURCE),
            )
    return added


def _clean(text: str | None) -> str:
    """Text with runs of spaces and line breaks collapsed to single spaces."""
    return " ".join((text or "").split())


def _slug(name: str) -> str:
    """Name as a category slug, e.g. "Cereal & Granola" -> "cereal-granola"."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


if __name__ == "__main__":
    seed()
    print("Development seed completed successfully.")
