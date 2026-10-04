"""Seed the development database with a small sample product set."""

import psycopg

from app.core.config import get_settings

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
                    raise RuntimeError(
                        f"Category '{product['category_slug']}' was not found."
                    )

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

        connection.commit()


if __name__ == "__main__":
    seed()
    print("Development seed completed successfully.")