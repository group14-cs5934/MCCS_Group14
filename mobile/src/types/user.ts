// Shape of GET /me. Mirrors UserRead in backend/app/schemas/user.py; update both together.

/**
 * Every role a user can have. New users get 'user'. Workers edit their store's stock; managers
 * also add and remove its workers; admins can do everything, at every store.
 */
export type Role = 'user' | 'worker' | 'manager' | 'admin';

/** The signed-in user's account. Named Account so it doesn't clash with Supabase's User. */
export type Account = {
  id: string;
  email: string | null;
  role: Role;
  /** The store a worker or manager works at; null for anyone else. */
  store_id?: number | null;
};

/** A user as admins see them, from GET /admin/users. Mirrors UserAccount in the backend. */
export type AdminUserAccount = Account & {
  /** False once an admin deactivates the account. */
  active: boolean;
  /** When the user first signed in (ISO 8601). */
  created_at: string;
};

/**
 * Body of PATCH /admin/users/{id}: at least one field. A worker or manager needs a store_id.
 * Mirrors UserUpdate in the backend.
 */
export type UserUpdateBody = { role?: Role; store_id?: number; active?: boolean };

/** Roles that belong to a store. */
export const STAFF_ROLES: readonly Role[] = ['worker', 'manager'];
