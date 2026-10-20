-- Admins can deactivate an account (T081). A deactivated user's Supabase sign-in still works, but
-- the API rejects their requests (403 account_deactivated) from their next request on, until an
-- admin reactivates them. NULL means the account is active.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- The admin user list is sorted by when users joined.
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at, id);
