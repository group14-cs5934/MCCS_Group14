// Shape of GET /me. Mirrors UserRead in backend/app/schemas/user.py; update both together.

/** Every role a user can have. New users get 'user'; admins are set in the database. */
export type Role = 'user' | 'admin';

/** The signed-in user's account. Named Account so it doesn't clash with Supabase's User. */
export type Account = {
  id: string;
  email: string | null;
  role: Role;
};

/** A user as admins see them, from GET /admin/users. Mirrors UserAccount in the backend. */
export type AdminUserAccount = Account & {
  /** False once an admin deactivates the account. */
  active: boolean;
  /** When the user first signed in (ISO 8601). */
  created_at: string;
};
