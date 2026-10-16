// Shape of GET /me. Mirrors UserRead in backend/app/schemas/user.py; update both together.

/** Every role a user can have. New users get 'user'; admins are set in the database. */
export type Role = 'user' | 'admin';

/** The signed-in user's account. Named Account so it doesn't clash with Supabase's User. */
export type Account = {
  id: string;
  email: string | null;
  role: Role;
};
