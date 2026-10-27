"""Load test for product search (T096): many shoppers searching at once on a full-size catalog.

T096 acceptance: when 50 simultaneous searches run against the full catalog, 95% return in under
1 second.

It builds a synthetic catalog (by default 20,000 products stocked at 8 stores, far more than the
real catalog holds today) in a throwaway Postgres schema, starts the API on it in its own process,
and sends searches like the app's from 50 clients at once: names (some with typos), a category,
a store, a store and "in stock", or "in stock" anywhere. It prints how long they took and passes
(exit code 0) when 95% returned in under 1 second. The schema is dropped afterwards, so nothing
else in the database is touched.

From backend/, with a local Postgres (see README "Test & lint" for one in Docker):

    uv run python -m scripts.load_test_search --database-url postgresql://postgres:postgres@localhost:5433/postgres
    uv run python -m scripts.load_test_search --products 50000 --requests 1000

--database-url defaults to TEST_DATABASE_URL. Only a database on this computer is allowed, since
the test adds a large temporary schema and heavy load; --allow-remote overrides that.
"""

import argparse
import asyncio
import math
import os
import random
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import quote, urlencode
from uuid import uuid4

import httpx
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

if TYPE_CHECKING:
    from fastapi import FastAPI

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
BACKEND_DIR = MIGRATIONS_DIR.parent

# T096: 95% of searches must return within this many seconds.
TARGET_SECONDS = 1.0
TARGET_PERCENTILE = 95
# The app asks for 20 results at a time (mobile/src/hooks/useProductSearch.ts).
PAGE_SIZE = 20
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}
SERVER_START_TIMEOUT_SECONDS = 30

# The kinds of search the app makes, and how often each is sent.
SEARCH_KINDS: dict[str, int] = {
    "name": 40,
    "name+category": 15,
    "name+store": 15,
    "name+store+in_stock": 15,
    "store+in_stock": 10,
    "in_stock": 5,
}

# Words the synthetic product names are made of; searches use the same words.
BRANDS = [
    "Harbor", "Summit", "Trailhead", "Liberty", "Northstar", "Bluegrass", "Redwood", "Patriot",
    "Frontier", "Seaside", "Ironwood", "Sunrise", "Meadow", "Granite", "Lakeshore", "Pinecrest",
]  # fmt: skip
FLAVORS = [
    "Original", "Classic", "Spicy", "Honey", "Vanilla", "Chocolate", "Strawberry", "Lemon",
    "Barbecue", "Sea Salt", "Cinnamon", "Mint", "Cherry", "Peach", "Garlic", "Ranch",
    "Cheddar", "Maple", "Coconut", "Unscented",
]  # fmt: skip
CATEGORIES: dict[str, list[str]] = {
    "snacks": ["Chips", "Crackers", "Pretzels", "Popcorn", "Cookies", "Trail Mix"],
    "beverages": ["Soda", "Juice", "Sparkling Water", "Iced Tea", "Sports Drink", "Coffee"],
    "household": ["Dish Soap", "Laundry Detergent", "Paper Towels", "Trash Bags", "Wipes"],
    "personal-care": ["Shampoo", "Toothpaste", "Body Wash", "Deodorant", "Lotion"],
    "breakfast": ["Cereal", "Oatmeal", "Granola Bars", "Pancake Mix", "Syrup"],
    "pantry": ["Pasta", "Rice", "Peanut Butter", "Ketchup", "Soup", "Salsa"],
    "frozen": ["Pizza", "Ice Cream", "Waffles", "Burritos"],
    "pet": ["Dog Food", "Cat Treats", "Cat Litter"],
}
SIZES = ["8 oz", "12 oz", "16 oz", "20 fl oz", "1 lb", "2 lb", "6 ct", "12 ct", "24 ct"]
STORES = [
    ("Camp Lejeune MCX", "camp-lejeune-mcx"),
    ("New River MCX", "new-river-mcx"),
    ("Camp Pendleton MCX", "camp-pendleton-mcx"),
    ("Quantico MCX", "quantico-mcx"),
    ("Miramar MCX", "miramar-mcx"),
    ("Twentynine Palms MCX", "twentynine-palms-mcx"),
    ("Kaneohe Bay MCX", "kaneohe-bay-mcx"),
    ("Parris Island MCX", "parris-island-mcx"),
]


# --- The catalog ---


@dataclass
class Catalog:
    products: int
    stores: int
    stock_rows: int
    seconds: float


def product_names(count: int, rng: random.Random) -> Iterator[tuple[str, str, str]]:
    """`count` (category slug, name, size) products, e.g.
    ("snacks", "Harbor Spicy Chips 8 oz", "8 oz")."""
    slugs = list(CATEGORIES)
    for _ in range(count):
        slug = rng.choice(slugs)
        noun = rng.choice(CATEGORIES[slug])
        size = rng.choice(SIZES)
        yield slug, f"{rng.choice(BRANDS)} {rng.choice(FLAVORS)} {noun} {size}", size


def upc_a(number: int) -> str:
    """A unique, valid 12-digit UPC-A barcode for product `number` (the API checks the check
    digit: body digits weighted 3, 1, 3, ... from the right)."""
    body = f"9{number:010d}"
    total = sum(int(digit) * (3 if i % 2 == 0 else 1) for i, digit in enumerate(reversed(body)))
    return body + str(-total % 10)


def build_catalog(
    connection: psycopg.Connection, products: int, stores: int, rng: random.Random
) -> Catalog:
    """Fill an empty database with `products` products, each with a price and a stock record at
    each of `stores` stores (about 70% in stock), then refresh the planner's statistics."""
    started = time.perf_counter()
    store_rows = STORES[:stores]
    with connection.cursor() as cursor:
        category_ids = {}
        for slug in CATEGORIES:
            name = slug.replace("-", " ").title()
            cursor.execute(
                "INSERT INTO categories (name, slug) VALUES (%s, %s) RETURNING id", (name, slug)
            )
            (category_ids[slug],) = cursor.fetchone()
        store_ids = []
        for name, slug in store_rows:
            cursor.execute(
                "INSERT INTO store_locations (name, slug) VALUES (%s, %s) RETURNING id",
                (name, slug),
            )
            store_ids.append(cursor.fetchone()[0])

        with cursor.copy("COPY products (barcode, name, size, category_id) FROM STDIN") as copy:
            for number, (slug, name, size) in enumerate(product_names(products, rng), start=1):
                copy.write_row((upc_a(number), name, size, category_ids[slug]))
        cursor.execute("SELECT id FROM products ORDER BY id")
        product_ids = [row[0] for row in cursor.fetchall()]

        with cursor.copy("COPY prices (product_id, amount) FROM STDIN") as copy:
            for product_id in product_ids:
                copy.write_row((product_id, f"{rng.randint(99, 2999) / 100:.2f}"))

        stock_rows = 0
        with cursor.copy(
            "COPY product_stock (product_id, store_id, in_stock, quantity, aisle) FROM STDIN"
        ) as copy:
            for product_id in product_ids:
                for store_id in store_ids:
                    in_stock = rng.random() < 0.7
                    quantity = rng.randint(1, 60) if in_stock else 0
                    copy.write_row((product_id, store_id, in_stock, quantity, None))
                    stock_rows += 1
    connection.commit()
    # Fresh statistics, as autovacuum would keep them on a real database.
    connection.execute("ANALYZE")
    return Catalog(len(product_ids), len(store_ids), stock_rows, time.perf_counter() - started)


# --- The searches ---


def with_typo(word: str, rng: random.Random) -> str:
    """The word with one letter dropped, like a quick thumb on a phone ("chocolate" -> "chocolte").
    Short words are left alone, since one letter out of four is too much for any search."""
    if len(word) < 5:
        return word
    index = rng.randrange(1, len(word) - 1)
    return word[:index] + word[index + 1 :]


def search_text(rng: random.Random) -> str:
    """What a shopper types: a product word, maybe with a flavor or brand, sometimes with a typo."""
    slug = rng.choice(list(CATEGORIES))
    words = [rng.choice(CATEGORIES[slug]).split()[0].lower()]
    extra = rng.random()
    if extra < 0.3:
        words.insert(0, rng.choice(FLAVORS).split()[0].lower())
    elif extra < 0.5:
        words.insert(0, rng.choice(BRANDS).lower())
    if rng.random() < 0.25:
        words[-1] = with_typo(words[-1], rng)
    return " ".join(words)


def search_path(kind: str, rng: random.Random, store_slugs: list[str]) -> str:
    """One GET /products/search request of this kind, as the app would send it."""
    params: dict[str, str | int] = {}
    if kind.startswith("name"):
        params["q"] = search_text(rng)
    if "category" in kind:
        params["category"] = rng.choice(list(CATEGORIES))
    if "store" in kind:
        params["store"] = rng.choice(store_slugs)
    if kind.endswith("in_stock"):
        params["in_stock"] = "true"
    params["limit"] = PAGE_SIZE
    return f"/products/search?{urlencode(params)}"


def search_plan(count: int, rng: random.Random, store_slugs: list[str]) -> list[tuple[str, str]]:
    """`count` (kind, path) searches, mixed as SEARCH_KINDS says."""
    kinds = rng.choices(list(SEARCH_KINDS), weights=list(SEARCH_KINDS.values()), k=count)
    return [(kind, search_path(kind, rng, store_slugs)) for kind in kinds]


# --- Sending them and timing them ---


@dataclass
class Result:
    kind: str
    seconds: float
    status: int  # 0 when the request itself failed (e.g. a timeout)


async def run_load(
    base_url: str, plan: list[tuple[str, str]], concurrency: int, timeout: float = 30.0
) -> list[Result]:
    """Send every search in `plan`, `concurrency` at a time: each client sends its next search as
    soon as its last one returns, so that many are always in flight. Each is timed from sending
    to the whole response arriving, as the app would see it."""
    queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
    for item in plan:
        queue.put_nowait(item)
    results: list[Result] = []
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)

    async with httpx.AsyncClient(base_url=base_url, limits=limits, timeout=timeout) as client:

        async def shopper() -> None:
            while not queue.empty():
                kind, path = queue.get_nowait()
                started = time.perf_counter()
                try:
                    status = (await client.get(path)).status_code
                except httpx.HTTPError:
                    status = 0
                results.append(Result(kind, time.perf_counter() - started, status))

        await asyncio.gather(*(shopper() for _ in range(concurrency)))
    return results


def percentile(values: list[float], percent: float) -> float:
    """The nearest-rank percentile: the smallest value at least `percent`% of values are <=."""
    if not values:
        raise ValueError("no values")
    ordered = sorted(values)
    rank = max(1, math.ceil(percent / 100 * len(ordered)))
    return ordered[rank - 1]


@dataclass
class Report:
    results: list[Result]
    concurrency: int
    errors: int = field(init=False)
    p50: float = field(init=False)
    p95: float = field(init=False)
    p99: float = field(init=False)
    slowest: float = field(init=False)

    def __post_init__(self) -> None:
        times = [result.seconds for result in self.results]
        self.errors = sum(result.status != 200 for result in self.results)
        self.p50 = percentile(times, 50)
        self.p95 = percentile(times, TARGET_PERCENTILE)
        self.p99 = percentile(times, 99)
        self.slowest = max(times)

    @property
    def passed(self) -> bool:
        """T096: 95% in under a second, and every search answered."""
        return self.errors == 0 and self.p95 < TARGET_SECONDS

    def lines(self) -> list[str]:
        out = [
            f"Searches: {len(self.results):,} from {self.concurrency} clients at once",
            f"  p50 {self.p50:.3f} s   p95 {self.p95:.3f} s   p99 {self.p99:.3f} s   "
            f"slowest {self.slowest:.3f} s   errors {self.errors}",
            "  p95 by kind:",
        ]
        for kind in SEARCH_KINDS:
            times = [result.seconds for result in self.results if result.kind == kind]
            if times:
                out.append(f"    {kind:<22} {percentile(times, 95):.3f} s  ({len(times)} searches)")
        verdict = "PASS" if self.passed else "FAIL"
        out.append(
            f"{verdict}: {TARGET_PERCENTILE}% returned in {self.p95:.3f} s or less "
            f"(target: under {TARGET_SECONDS:g} s, no errors)"
        )
        return out


# --- Database and server ---


def is_local(database_url: str) -> bool:
    """True if every host the URL could connect to is this computer. With no host in the URL,
    libpq uses PGHOSTADDR/PGHOST, or else a local socket."""
    info = conninfo_to_dict(database_url)
    hosts = (
        info.get("hostaddr")
        or info.get("host")
        or os.environ.get("PGHOSTADDR")
        or os.environ.get("PGHOST")
        or ""
    )
    return all(host in LOCAL_HOSTS or host.startswith("/") for host in hosts.split(","))


@contextmanager
def throwaway_schema(base_url: str) -> Iterator[str]:
    """A new schema with every migration applied, dropped afterwards; yields a URL whose
    connections use it (the same approach as the tests' db_url fixture)."""
    name = f"loadtest_{uuid4().hex[:12]}"
    with psycopg.connect(base_url, autocommit=True) as connection:
        # Search needs pg_trgm; if it's already installed, it may be in any schema.
        row = connection.execute(
            "SELECT n.nspname FROM pg_extension AS e "
            "JOIN pg_namespace AS n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'"
        ).fetchone()
        path = [name, "public", "extensions", *([row[0]] if row else [])]
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(name)))
    separator = "&" if "?" in base_url else "?"
    options = quote(f"-c search_path={','.join(path)}")
    try:
        # Inside the try, so the schema is dropped even if a migration fails.
        with psycopg.connect(base_url, autocommit=True) as connection:
            connection.execute(
                sql.SQL("SET search_path TO {}").format(
                    sql.SQL(", ").join(map(sql.Identifier, path))
                )
            )
            for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
                connection.execute(migration.read_text(encoding="utf-8"))
        yield f"{base_url}{separator}options={options}"
    finally:
        with psycopg.connect(base_url, autocommit=True) as connection:
            connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(name)))


def make_app() -> "FastAPI":
    """App factory for the server process: the real app on LOADTEST_DATABASE_URL. Settings are
    given in full, so backend/.env is never read. The app is imported here, so only the server
    process loads it."""
    from app.core.config import load_settings
    from app.main import create_app

    return create_app(
        load_settings(
            _env_file=None,
            database_url=os.environ["LOADTEST_DATABASE_URL"],
            supabase_url="https://loadtest.invalid",  # search needs no sign-in
            app_env="production",
            log_level="WARNING",
        )
    )


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextmanager
def api_server(database_url: str) -> Iterator[str]:
    """The API in its own process (one uvicorn worker, like `fastapi run`), so the load
    generator doesn't share its Python interpreter. Yields its base URL."""
    port = free_port()
    process = subprocess.Popen(
        [
            sys.executable, "-m", "uvicorn", "scripts.load_test_search:make_app", "--factory",
            "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning",
            "--no-access-log",
        ],
        cwd=BACKEND_DIR,
        env={**os.environ, "LOADTEST_DATABASE_URL": database_url},
    )  # fmt: skip
    base_url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + SERVER_START_TIMEOUT_SECONDS
        while True:
            if process.poll() is not None:
                raise RuntimeError("The API didn't start; see its output above.")
            try:
                if httpx.get(f"{base_url}/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if time.monotonic() > deadline:
                raise RuntimeError("The API didn't answer /health in time.")
            time.sleep(0.2)
        yield base_url
    finally:
        # Stopped before the schema is dropped, since its open connections would block that.
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def run(
    database_url: str,
    products: int = 20_000,
    stores: int = 8,
    requests: int = 500,
    concurrency: int = 50,
    seed: int = 96,
) -> tuple[Catalog, Report]:
    """Build the catalog, start the API, warm it up, then time `requests` searches."""
    rng = random.Random(seed)
    with throwaway_schema(database_url) as schema_url:
        with psycopg.connect(schema_url) as connection:
            catalog = build_catalog(connection, products, stores, rng)
        store_slugs = [slug for _, slug in STORES[:stores]]
        with api_server(schema_url) as base_url:
            # Opens the pool's connections and warms Postgres' cache; not counted.
            warmup = asyncio.run(
                run_load(base_url, search_plan(concurrency, rng, store_slugs), concurrency)
            )
            failed = sorted({result.status for result in warmup if result.status != 200})
            if failed:
                raise RuntimeError(f"Searches failed while warming up (status {failed}).")
            plan = search_plan(requests, rng, store_slugs)
            results = asyncio.run(run_load(base_url, plan, concurrency))
    return catalog, Report(results, concurrency)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Time 50 simultaneous product searches on a full-size catalog (T096)."
    )
    parser.add_argument("--database-url", default=os.environ.get("TEST_DATABASE_URL"))
    parser.add_argument("--products", type=int, default=20_000)
    parser.add_argument("--stores", type=int, default=8, choices=range(1, len(STORES) + 1))
    parser.add_argument("--requests", type=int, default=500, help="searches to time")
    parser.add_argument("--concurrency", type=int, default=50, help="searches in flight at once")
    parser.add_argument("--seed", type=int, default=96, help="same seed, same catalog and searches")
    parser.add_argument("--allow-remote", action="store_true", help="allow a non-local database")
    args = parser.parse_args(argv)

    if not args.database_url:
        parser.error("set --database-url or TEST_DATABASE_URL")
    # The API's settings need a URL, and the test schema is set through its options= parameter.
    if not args.database_url.startswith(("postgresql://", "postgres://")):
        parser.error("--database-url must be a postgresql:// URL")
    if "options=" in args.database_url:
        parser.error("--database-url can't have options= (the test sets its own)")
    if args.requests < 1 or args.concurrency < 1 or args.products < 1:
        parser.error("--products, --requests, and --concurrency must be at least 1")
    if not args.allow_remote and not is_local(args.database_url):
        parser.error("the database isn't on this computer; pass --allow-remote if you mean it")

    print(f"Building {args.products:,} products at {args.stores} stores...", flush=True)
    catalog, report = run(
        args.database_url, args.products, args.stores, args.requests, args.concurrency, args.seed
    )
    print(
        f"Catalog: {catalog.products:,} products, {catalog.stores} stores, "
        f"{catalog.stock_rows:,} stock rows (built in {catalog.seconds:.1f} s)"
    )
    print("\n".join(report.lines()))
    return 0 if report.passed else 1


if __name__ == "__main__":
    sys.exit(main())
