-- One row per Supabase Auth user, added by the API on the user's first signed-in request (T039).
-- There's no foreign key to auth.users: that table only exists on Supabase, not in local or CI
-- databases.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY, -- the Supabase Auth user ID (the access token's "sub")
    email TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supabase exposes public tables through its REST API to anyone with the app's publishable key.
-- With row level security on and no policies, only the backend (which connects as the table
-- owner) can read or change rows, so users can't make themselves admins.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
