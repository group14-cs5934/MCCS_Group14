-- Ensure each product barcode is unique.
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so check first: this keeps the migration safe to
-- run more than once. The check is on this products table (not just the constraint's name), so a
-- products table in another schema with the same constraint doesn't count.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'products'::regclass AND conname = 'products_barcode_unique'
    ) THEN
        ALTER TABLE products ADD CONSTRAINT products_barcode_unique UNIQUE (barcode);
    END IF;
END $$;
