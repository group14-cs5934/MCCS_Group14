"""Give every product a simulated stock level at every MCCS store (T077).

    uv run python -m scripts.generate_store_stock            # fill in missing stock rows
    uv run python -m scripts.generate_store_stock --reset    # regenerate every row

We don't have real per-store inventory, so this makes a believable mix for demos: most products
are in stock at most stores, some stores run out of more than others, and in-stock quantities
vary. The numbers come from the product and store IDs (and --seed), so running it again gives the
same stock, and a product added later gets its own rows without changing anyone else's.

If there are no stores yet, it adds DEMO_STORES first. By default only missing rows are added, so
stock that an admin set by hand is kept; --reset replaces every row except ones an admin set
(T094).
"""

import argparse
import logging
import os
import random
import sys
from typing import NamedTuple

import psycopg

from app.core.config import get_settings

logger = logging.getLogger("app.ingest")

# Major Marine Corps Exchange (MCX) locations, used when the database has no stores yet.
DEMO_STORES = [
    ("Camp Lejeune MCX", "camp-lejeune-mcx", "Camp Lejeune, NC"),
    ("New River MCX", "new-river-mcx", "MCAS New River, NC"),
    ("Camp Pendleton MCX", "camp-pendleton-mcx", "Camp Pendleton, CA"),
    ("Quantico MCX", "quantico-mcx", "MCB Quantico, VA"),
    ("Miramar MCX", "miramar-mcx", "MCAS Miramar, CA"),
    ("Twentynine Palms MCX", "twentynine-palms-mcx", "MCAGCC Twentynine Palms, CA"),
    ("Kaneohe Bay MCX", "kaneohe-bay-mcx", "MCB Hawaii, Kaneohe Bay, HI"),
    ("Parris Island MCX", "parris-island-mcx", "MCRD Parris Island, SC"),
]

DEFAULT_SEED = 14  # Group 14
AISLES = 24


class Stock(NamedTuple):
    in_stock: bool
    quantity: int
    aisle: str


def _store_fill_rate(store_id: int, seed: int) -> float:
    """How often this store has a product: between 70% and 95%, fixed per store."""
    return random.Random(f"{seed}:store:{store_id}").uniform(0.70, 0.95)


def simulated_stock(product_id: int, store_id: int, seed: int = DEFAULT_SEED) -> Stock:
    """The simulated stock of one product at one store; the same inputs always give the same
    answer."""
    rng = random.Random(f"{seed}:{product_id}:{store_id}")
    # The aisle depends on the product only, so it's in the same aisle at every store.
    aisle = f"Aisle {random.Random(f'{seed}:aisle:{product_id}').randint(1, AISLES)}"
    if rng.random() >= _store_fill_rate(store_id, seed):
        return Stock(in_stock=False, quantity=0, aisle=aisle)
    # Mostly a shelf's worth, sometimes just a few left, now and then a pallet.
    quantity = rng.choice(
        [rng.randint(1, 4), rng.randint(5, 40), rng.randint(5, 40), rng.randint(41, 120)]
    )
    return Stock(in_stock=True, quantity=quantity, aisle=aisle)


def ensure_stores(connection: psycopg.Connection) -> int:
    """Add DEMO_STORES if there are no stores; return how many were added."""
    if connection.execute("SELECT 1 FROM store_locations LIMIT 1").fetchone():
        return 0
    for name, slug, address in DEMO_STORES:
        connection.execute(
            "INSERT INTO store_locations (name, slug, address) VALUES (%s, %s, %s)",
            (name, slug, address),
        )
    return len(DEMO_STORES)


def generate(
    connection: psycopg.Connection, seed: int = DEFAULT_SEED, reset: bool = False
) -> dict[str, int]:
    """Write simulated stock for every product at every store. Without `reset`, rows that already
    exist are kept. Returns how many rows were written, and how many of those are in stock. The
    caller commits."""
    stores_added = ensure_stores(connection)
    pairs = connection.execute(
        "SELECT p.id, s.id FROM products AS p CROSS JOIN store_locations AS s ORDER BY p.id, s.id"
    ).fetchall()
    # Even --reset leaves stock an admin set (T094).
    conflict = (
        "DO UPDATE SET in_stock = EXCLUDED.in_stock, quantity = EXCLUDED.quantity, "
        "aisle = EXCLUDED.aisle, updated_at = NOW() WHERE product_stock.admin_set_at IS NULL"
        if reset
        else "DO NOTHING"
    )
    written = in_stock = 0
    with connection.cursor() as cursor:
        for product_id, store_id in pairs:
            stock = simulated_stock(product_id, store_id, seed)
            cursor.execute(
                f"""
                INSERT INTO product_stock (product_id, store_id, in_stock, quantity, aisle)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (product_id, store_id) {conflict}
                """,  # conflict is one of the two constants above
                (product_id, store_id, stock.in_stock, stock.quantity, stock.aisle),
            )
            if cursor.rowcount:
                written += 1
                in_stock += stock.in_stock
    return {"stores_added": stores_added, "written": written, "in_stock": in_stock}


def main(argv: list[str] | None = None, database_url: str | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--reset", action="store_true", help="regenerate every stock row")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="change the simulated mix")
    args = parser.parse_args(argv)

    url = database_url or os.environ.get("DATABASE_URL") or str(get_settings().database_url)
    with psycopg.connect(url, prepare_threshold=None) as connection:
        counts = generate(connection, seed=args.seed, reset=args.reset)
        connection.commit()
    if counts["stores_added"]:
        logger.info("Added %d demo stores", counts["stores_added"])
    share = counts["in_stock"] / counts["written"] if counts["written"] else 0
    logger.info(
        "Wrote %d stock rows: %d in stock, %d out of stock (%.0f%% in stock)",
        counts["written"],
        counts["in_stock"],
        counts["written"] - counts["in_stock"],
        share * 100,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
