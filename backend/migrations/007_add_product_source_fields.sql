-- Where an imported product came from (T046), so the ingestion pipeline (T061-T066) can find the
-- product again on the next sync and tell how fresh its data is. Products added by hand (admin
-- screen, seed script) leave all four columns NULL.
--
--   source          which connector imported it, e.g. 'upcitemdb'
--   source_id       the product's ID in that source (UPCitemdb: its EAN)
--   last_synced_at  when the product was last imported or refreshed from the source
--   raw_payload     the source's record exactly as received, for debugging and re-transforming
--                   without fetching it again
ALTER TABLE products ADD COLUMN IF NOT EXISTS source VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS source_id VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS raw_payload JSONB;

-- A source ID names one product in its source. Partial, so hand-added products (no source) don't
-- collide; the index also finds a product by its source ID during a sync.
CREATE UNIQUE INDEX IF NOT EXISTS products_source_id_unique
ON products (source, source_id)
WHERE source IS NOT NULL AND source_id IS NOT NULL;

-- Both or neither: a source ID means nothing without the source it belongs to.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_source_and_id_together;
ALTER TABLE products ADD CONSTRAINT products_source_and_id_together
CHECK ((source IS NULL) = (source_id IS NULL));
