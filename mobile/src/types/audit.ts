// Shape of GET /admin/audit-log. Mirrors AuditLogEntry in backend/app/schemas/audit.py; update both
// together.

/** One admin change: who made it, what changed, and when. */
export type AuditLogEntry = {
  id: number;
  /** The admin's account; null if it was deleted since. */
  admin_id: string | null;
  /** The admin's email when they made the change. */
  admin_email: string | null;
  /** e.g. 'product.update', 'user.update', 'review.hide'. */
  action: string;
  /** What was changed: 'product', 'user', or 'review'. */
  target_type: string;
  /** Its ID, as text, e.g. '7'. */
  target_id: string;
  /** Each changed field as { from, to }: from is null for something created, to for deleted. */
  changes: Record<string, { from: unknown; to: unknown }>;
  /** When the change was made (ISO 8601). */
  created_at: string;
};
