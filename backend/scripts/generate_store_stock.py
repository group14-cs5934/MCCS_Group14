"""Give every product a simulated stock level at every MCCS store (T077).

    uv run python -m scripts.generate_store_stock            # fill in missing stock rows
    uv run python -m scripts.generate_store_stock --reset    # regenerate every row
    uv run python -m scripts.generate_store_stock --history  # also simulate 90 days of history

We don't have real per-store inventory, so this makes a believable mix for demos: most products
are in stock at most stores, some stores run out of more than others, and in-stock quantities
vary. The numbers come from the product and store IDs (and --seed), so running it again gives the
same stock, and a product added later gets its own rows without changing anyone else's.

If there are no stores yet, it adds DEMO_STORES first. By default only missing rows are added, so
stock that an admin set by hand is kept; --reset replaces every row except ones an admin set
(T094).

--history also makes up the last 90 days (--days) for restock alerts (migration 020): each
product's stock changes as it sells and is restocked, and shoppers' daily views and scans, with a
few popular products that keep running out. It replaces the stock history and view and scan
counts of those days, and sets today's stock to where the history ends.
"""

import argparse
import logging
import os
import random
import sys
from datetime import UTC, date, datetime, timedelta
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


class History(NamedTuple):
    """One product's simulated past at one store."""

    # (days ago, hour of day, in_stock, quantity) for each change, oldest first.
    events: list[tuple[int, int, bool, int]]
    # (days ago, views, scans) for each day with any.
    activity: list[tuple[int, int, int]]
    final: Stock


def simulated_history(
    product_id: int, store_id: int, days: int = 90, seed: int = DEFAULT_SEED
) -> History:
    """A believable past for one product at one store, the same every time for the same inputs.

    About one product in ten is a hit: it sells several a day, gets far more views and scans,
    and keeps running out, because each restock is about the same size however fast it went.
    Everything else sells a few a week to a couple a day. When a product runs out it's restocked
    after a few days; otherwise a delivery comes now and then when it's getting low.
    """
    product_rng = random.Random(f"{seed}:demand:{product_id}")
    hit = product_rng.random() < 0.1
    rate = product_rng.uniform(4, 10) if hit else product_rng.uniform(0.2, 2)
    rate *= random.Random(f"{seed}:busy:{store_id}").uniform(0.6, 1.4)
    rng = random.Random(f"{seed}:history:{product_id}:{store_id}")
    restock_to = rng.randint(20, 60)
    aisle = simulated_stock(product_id, store_id, seed).aisle

    events: list[tuple[int, int, bool, int]] = []
    activity: list[tuple[int, int, int]] = []
    quantity = rng.randint(restock_to // 2, restock_to)
    events.append((days, 0, True, quantity))
    delivery_in: int | None = None
    for day in range(days - 1, 0, -1):
        if delivery_in is not None:
            delivery_in -= 1
            if delivery_in <= 0:
                quantity += restock_to
                delivery_in = None
                events.append((day, rng.randint(6, 9), True, quantity))
        sold = min(quantity, max(round(rng.gauss(rate, rate / 2)), 0))
        if sold:
            quantity -= sold
            events.append((day, rng.randint(10, 21), quantity > 0, quantity))
            if delivery_in is None and (quantity == 0 or quantity <= 5 and rng.random() < 0.3):
                delivery_in = rng.randint(1, 5)
        # Shoppers look at what sells: views and scans follow demand.
        views = max(round(rng.gauss(rate * 3, rate)), 0)
        scans = max(round(rng.gauss(rate * 0.8, rate / 3)), 0)
        if views or scans:
            activity.append((day, views, scans))
    return History(events, activity, Stock(quantity > 0, quantity, aisle))


def simulate_history(
    connection: psycopg.Connection,
    days: int = 90,
    seed: int = DEFAULT_SEED,
    max_products: int = 1000,
) -> dict[str, int]:
    """Replace the stock history and view and scan counts of the last `days` with simulated
    ones, for restock alerts (migration 020), and set today's stock to where it ended. Stock an
    admin or staff member set by hand is left alone. Only the first `max_products` products (by
    ID) are simulated, so a huge catalog doesn't make millions of rows. The caller commits."""
    pairs = connection.execute(
        """
        SELECT ps.product_id, ps.store_id FROM product_stock AS ps
        WHERE ps.admin_set_at IS NULL
          AND ps.product_id IN (SELECT id FROM products ORDER BY id LIMIT %s)
        ORDER BY ps.product_id, ps.store_id
        """,
        (max_products,),
    ).fetchall()
    if not pairs:
        return {"pairs": 0, "events": 0, "activity_days": 0}
    product_ids = sorted({product_id for product_id, _ in pairs})
    connection.execute(
        "DELETE FROM stock_events WHERE product_id = ANY(%s) "
        "AND changed_at > NOW() - make_interval(days => %s)",
        (product_ids, days + 1),
    )
    connection.execute(
        "DELETE FROM product_activity WHERE product_id = ANY(%s) AND day > CURRENT_DATE - %s",
        (product_ids, days + 1),
    )

    events = activity_days = 0
    finals = []
    with connection.cursor() as cursor:
        with cursor.copy(
            "COPY stock_events (product_id, store_id, in_stock, quantity, changed_at) FROM STDIN"
        ) as copy:
            histories = {}
            for product_id, store_id in pairs:
                history = simulated_history(product_id, store_id, days, seed)
                histories[product_id, store_id] = history
                for days_ago, hour, in_stock, quantity in history.events:
                    copy.write_row((product_id, store_id, in_stock, quantity, _at(days_ago, hour)))
                    events += 1
        with cursor.copy(
            "COPY product_activity (product_id, store_id, day, views, scans) FROM STDIN"
        ) as copy:
            for (product_id, store_id), history in histories.items():
                for days_ago, views, scans in history.activity:
                    copy.write_row((product_id, store_id, _day(days_ago), views, scans))
                    activity_days += 1
                finals.append(
                    (history.final.in_stock, history.final.quantity, product_id, store_id)
                )
        # Today's stock is where the history ended (the stock_events trigger records it as now).
        cursor.executemany(
            "UPDATE product_stock SET in_stock = %s, quantity = %s, updated_at = NOW() "
            "WHERE product_id = %s AND store_id = %s",
            finals,
        )
    return {"pairs": len(pairs), "events": events, "activity_days": activity_days}


def _at(days_ago: int, hour: int) -> datetime:
    start = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    return start.replace(hour=hour) - timedelta(days=days_ago)


def _day(days_ago: int) -> date:
    return datetime.now(UTC).date() - timedelta(days=days_ago)


def main(argv: list[str] | None = None, database_url: str | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--reset", action="store_true", help="regenerate every stock row")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="change the simulated mix")
    parser.add_argument(
        "--history", action="store_true", help="also simulate stock history, views, and scans"
    )
    parser.add_argument("--days", type=int, default=90, help="how much history (default 90)")
    parser.add_argument(
        "--max-products", type=int, default=1000, help="simulate history for this many products"
    )
    args = parser.parse_args(argv)

    url = database_url or os.environ.get("DATABASE_URL") or str(get_settings().database_url)
    with psycopg.connect(url, prepare_threshold=None) as connection:
        counts = generate(connection, seed=args.seed, reset=args.reset)
        history = (
            simulate_history(
                connection, days=args.days, seed=args.seed, max_products=args.max_products
            )
            if args.history
            else None
        )
        connection.commit()
    if history is not None:
        logger.info(
            "Simulated %d days of history for %d product-store pairs: %d stock changes, "
            "%d days of views and scans",
            args.days,
            history["pairs"],
            history["events"],
            history["activity_days"],
        )
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
