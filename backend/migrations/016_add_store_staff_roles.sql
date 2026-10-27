-- Store staff roles (added after the Gantt tasks). Besides "user" and "admin", a user can be a
-- store "worker" (edits their store's stock) or "manager" (also adds and removes the store's
-- workers). Staff belong to exactly one store, users.store_id; nobody else has one. Admins assign
-- managers and workers anywhere; a manager can only add or remove workers at their own store.
-- See app/core/auth.py (can_edit_stock, can_manage_staff) and app/api/staff.py.
--
-- Every existing user keeps their role and has no store, so nothing changes until someone is
-- made staff. Safe to run more than once.

ALTER TABLE users ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES store_locations (id);

-- Widen the role check from migration 004 (Postgres named it users_role_check).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'worker', 'manager', 'admin'));

-- Workers and managers always have a store, and nobody else does. Deleting a store first turns
-- its staff back into regular users (DELETE /admin/stores/{id}), so the reference never dangles.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_staff_have_a_store;
ALTER TABLE users
    ADD CONSTRAINT users_staff_have_a_store
    CHECK ((role IN ('worker', 'manager')) = (store_id IS NOT NULL));

-- Listing a store's staff.
CREATE INDEX IF NOT EXISTS users_store_id_idx ON users (store_id) WHERE store_id IS NOT NULL;
