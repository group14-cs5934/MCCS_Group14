-- Row level security on the catalog tables (T084). Every other table already has it (migrations
-- 004-010); these three were created before that rule (migration 001).
--
-- Supabase lets apps read and write public tables directly through its REST API, using the app's
-- publishable key or a signed-in user's token. With row level security on and no policies, those
-- direct requests can't see or change any row, even if table access is granted by mistake. The
-- backend is unaffected: it connects as the tables' owner, which row level security doesn't
-- apply to. All reads and writes go through the API, which checks who's asking.
--
-- On purpose there are no policies such as "users may edit their own review": a direct edit would
-- skip the API's checks, e.g. an author could clear hidden_at and undo moderation (T082).
--
-- Safe to run more than once.
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;
