-- Admin edits survive the product sync (T089). admin_fields lists the fields an admin has set on
-- a product, e.g. {name,price}: the nightly sync (app/ingest/load.py) and the product monitor
-- (jobs/product-monitor) keep those values instead of replacing them with the source's, and keep
-- updating every other field. "price" means the sync and the monitor don't add newer prices.
-- An admin can hand a field back to the sync, which removes it from the list.
--
-- Empty for every existing product, so nothing changes until an admin edits one. Safe to run
-- more than once.
ALTER TABLE products ADD COLUMN IF NOT EXISTS admin_fields TEXT[] NOT NULL DEFAULT '{}';
