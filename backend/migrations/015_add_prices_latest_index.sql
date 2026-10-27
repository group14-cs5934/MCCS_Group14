-- Finding a product's current price quickly (T096). Every product the API returns (search, the
-- product page, the admin list) comes with its newest price: the row with the latest observed_at
-- for that product (app/repositories/products.py). Without this index Postgres read the whole
-- prices table once per product, so a search for "in stock anywhere" on a 20,000-product catalog
-- took about 7 seconds; with it, under 50 ms (docs/performance/2026-10-27-search-load-test.md).
--
-- Only adds an index; no data changes. Safe to run more than once.
CREATE INDEX IF NOT EXISTS prices_product_latest_idx
ON prices (product_id, observed_at DESC, id DESC);
