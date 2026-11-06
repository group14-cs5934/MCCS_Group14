-- The review agent (jobs/product-monitor, T052.7) now works from the catalog: it reads the
-- products that have a product_page_url and saves their reviews under products.id, so the app can
-- show them next to the product. Until now it read its own list (products.yaml) and named products
-- by text IDs that aren't in the catalog.
--
-- Rows already in the agent tables name products by those text IDs and can't be linked to a
-- catalog product, so they're deleted. The agent collects them again from the product pages.

-- The store page the agent reads the product's reviews from. One per product.
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_page_url TEXT;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_page_url_https;
ALTER TABLE products ADD CONSTRAINT products_product_page_url_https
CHECK (product_page_url ~ '^https://[^/\s]+');

-- Each table is changed only if it still has the old product column, so this can run again.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'agent_reviews'
          AND column_name = 'product'
    ) THEN
        DELETE FROM agent_reviews;
        ALTER TABLE agent_reviews DROP CONSTRAINT agent_reviews_one_per_key;
        ALTER TABLE agent_reviews DROP COLUMN product;
        ALTER TABLE agent_reviews
            ADD COLUMN product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE;
        -- Also the index for a product's reviews (product_id comes first).
        ALTER TABLE agent_reviews
            ADD CONSTRAINT agent_reviews_one_per_key UNIQUE (product_id, source, review_key);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'agent_source_ratings'
          AND column_name = 'product'
    ) THEN
        DELETE FROM agent_source_ratings;
        ALTER TABLE agent_source_ratings DROP COLUMN product;  -- and the primary key with it
        ALTER TABLE agent_source_ratings
            ADD COLUMN product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE;
        ALTER TABLE agent_source_ratings
            ADD CONSTRAINT agent_source_ratings_pkey PRIMARY KEY (product_id, source);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'agent_review_summaries'
          AND column_name = 'product'
    ) THEN
        DELETE FROM agent_review_summaries;
        ALTER TABLE agent_review_summaries DROP COLUMN product;  -- and the primary key with it
        -- The product's name is now products.name.
        ALTER TABLE agent_review_summaries DROP COLUMN IF EXISTS product_name;
        ALTER TABLE agent_review_summaries
            ADD COLUMN product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE;
    END IF;
END $$;
