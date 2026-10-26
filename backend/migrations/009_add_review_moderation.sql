-- Admins can hide a review (T082). A hidden review stays in the table, so it can be shown again,
-- but the public review list (GET /products/{id}/reviews) leaves it out. NULL means visible.
-- Safe to run more than once.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

-- The admin who hid it. If that admin's account is deleted, the review stays hidden and this is
-- cleared.
ALTER TABLE reviews
ADD COLUMN IF NOT EXISTS hidden_by UUID REFERENCES users(id) ON DELETE SET NULL;
