# Search load test with store and in-stock filters (T096)

**Date:** 2026-10-27 · **Target:** when 50 simultaneous searches run against the full catalog,
95% return in under 1 second · **Result:** passes after two fixes (p95 0.24 s at 20,000 products,
0.69 s at 100,000)

## How it was run

`backend/scripts/load_test_search.py` builds a synthetic catalog in a throwaway Postgres schema
(dropped afterwards), starts the API on it in its own process (one uvicorn worker, like
`fastapi run`), and keeps 50 searches in flight at once. Each search is timed from sending it to
the whole response arriving, as the app sees it.

```sh
# from backend/, with the local Postgres from the README's "Test & lint" section
uv run python -m scripts.load_test_search --database-url postgresql://postgres:postgres@localhost:5433/postgres
uv run python -m scripts.load_test_search --products 100000 --requests 1000   # larger catalog
```

- **Catalog:** 20,000 products in 8 categories, each with a price and a stock record at each of
  8 stores (about 70% in stock): 160,000 stock rows. The real catalog had 32 products after the
  first full ingest (T076) and grows by at most 90 a day, so this is far larger than today's.
- **Searches**, mixed like the app's (`limit=20`; the search screen's **In stock** filter sends
  `in_stock`, plus `store` when the shopper has picked one): name only 40% (a quarter of them with a typo,
  e.g. "chocolte"), name + category 15%, name + store 15%, name + store + in stock 15%,
  store + in stock 10%, in stock anywhere 5%. 500 timed searches after 50 warm-up ones.
- **Machine:** AMD Ryzen 7 9800X3D, 31 GB RAM, Windows 11; Postgres 17.11 in Docker on the same
  machine. On Supabase each search also pays the network round trip to the database.

## Results

| 50 simultaneous searches, 20,000 products | p50        | p95        | p99        | Errors     |
| ----------------------------------------- | ---------- | ---------- | ---------- | ---------- |
| As on `main` before T096                  | 5.29 s     | 10.32 s    | 14.28 s    | 243 of 500 |
| With the prices index (migration 015)     | 0.18 s     | 5.17 s     | 5.23 s     | 49 of 500  |
| With the index and connection slots       | **0.17 s** | **0.24 s** | **0.27 s** | **0**      |

With both fixes, at 100,000 products (800,000 stock rows) and 1,000 searches: p50 0.41 s,
p95 0.69 s, p99 0.80 s, no errors. Every kind of search had a p95 under 0.8 s.

## What it found (fixed in this PR)

- **No index for a product's current price.** Every product the API returns comes with its
  newest price, found per product with `ORDER BY observed_at DESC LIMIT 1` on `prices`. With no
  index on `prices.product_id`, Postgres read the whole prices table once for every product in
  the result. One search on its own, before and after migration 015's index on
  `prices (product_id, observed_at DESC, id DESC)`:

  | Search (one at a time)  | Before   | After  |
  | ----------------------- | -------- | ------ |
  | name "chips"            | 261 ms   | 2.5 ms |
  | name + store + in stock | 198 ms   | 3 ms   |
  | in stock anywhere       | 7,178 ms | 47 ms  |

  The index also lets the name search use the trigram index (`products_name_trgm_idx`) again;
  before, the planner skipped it. Product pages and the admin list get the same speed-up.

- **A burst of requests stalled the API for 5 seconds.** With the index, searches were either
  fast or failed after exactly 5 s with `PoolTimeout`. Each request takes its database connection
  in a worker thread (`get_connection` is a sync dependency), and FastAPI runs those and the
  routes on one pool of 40 threads, while the database pool has 10 connections. Once 40 requests
  were blocked waiting for a connection, the 10 that had one couldn't get a thread to finish and
  give it back, so nothing moved until the waiters timed out. With 10 clients instead of 50 there
  were no errors (p95 0.10 s). The fix (`app/core/database.py`) gives each request a slot before
  its connection: at most 10 requests use the database at once, and the rest wait without
  holding a thread. This affected every endpoint that uses the database, not only search.

## Repeating it

The script exits with code 1 when the target isn't met, so it can be rerun after changes to
search or to the database setup. `tests/test_load_test_search.py` runs a small version in CI
(300 products, 50 at once) to check every search succeeds and the schema is cleaned up; CI
machines are too uneven to check timings there.
