-- Store hours (T080), shown on the app's store page next to the address, e.g.
-- "Mon–Sat 9 AM–9 PM · Sun 10 AM–6 PM". Free text, since stores word their hours differently
-- (holidays, split hours). Admins set it through PATCH /admin/stores/{id}.
--
-- Empty for every existing store, so the app shows "Hours not listed" until it's set. Safe to run
-- more than once.
ALTER TABLE store_locations ADD COLUMN IF NOT EXISTS hours VARCHAR(200);
