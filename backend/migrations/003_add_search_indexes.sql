-- Typo-tolerant product search (US04): pg_trgm compares words by their 3-letter chunks
-- ("trigrams"), so "coffe" still matches "Coffee". Search queries should use word similarity,
-- which finds a typed word inside a longer name (in psycopg, write the operator as <%%):
--   WHERE 'coffe' <% p.name ORDER BY word_similarity('coffe', p.name) DESC
-- (plain similarity, the % operator, compares against the whole name and misses long names).
-- <% matches at word_similarity >= 0.6 (pg_trgm.word_similarity_threshold): "coffe" scores 0.83
-- against "Coffee", but short words lose more per typo ("snaks" vs "Snacks" is only 0.5).
-- Supabase may already have pg_trgm enabled in its "extensions" schema; that works too.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes let those searches (and ILIKE '%...%') use an index instead of reading
-- every row.
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS categories_name_trgm_idx
ON categories USING gin (name gin_trgm_ops);
