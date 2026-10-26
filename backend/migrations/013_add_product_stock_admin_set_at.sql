-- Stock an admin sets survives automatic updates (T094). admin_set_at is when an admin last set a
-- store's stock for a product; while it's set, the product monitor (jobs/product-monitor) and the
-- simulated stock script (scripts/generate_store_stock.py --reset) leave that row alone. NULL
-- means the row is managed automatically. Removing the admin's setting clears it (the values
-- stay), so the monitor manages that store again from its next run.
--
-- Empty for every existing row, so nothing changes until an admin sets stock. Safe to run more
-- than once.
ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS admin_set_at TIMESTAMPTZ;
