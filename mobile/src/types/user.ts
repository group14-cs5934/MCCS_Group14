// Shape of GET /me. Mirrors UserRead in backend/app/schemas/user.py; update both together.

/**
 * A user's account type. New users get 'user'. Staff belong to one store and can do what their
 * store role there allows; admins can do everything, at every store.
 */
export type Role = 'user' | 'staff' | 'admin';

/** A store role as GET /me and the user lists show it: the person's role at their store. */
export type StoreRoleSummary = {
  id: number;
  name: string;
  /** Permission keys, e.g. 'edit_stock'. */
  permissions: string[];
};

/** A store role with its store and how many people have it (GET /staff/stores/{id}/roles). */
export type StoreRole = StoreRoleSummary & {
  store_id: number;
  member_count: number;
};

/** One thing a store role can allow, from GET /staff/permissions (in display order). */
export type PermissionInfo = {
  key: string;
  label: string;
  description: string;
};

/** The permission keys the app itself checks. The roles checklist is drawn from the API instead. */
export const PERMISSIONS = {
  editStock: 'edit_stock',
  viewStaff: 'view_staff',
  manageStaff: 'manage_staff',
  manageRoles: 'manage_roles',
  editStoreInfo: 'edit_store_info',
} as const;

/** The signed-in user's account. Named Account so it doesn't clash with Supabase's User. */
export type Account = {
  id: string;
  email: string | null;
  role: Role;
  /** The store a staff member works at; null for anyone else. */
  store_id?: number | null;
  /** A staff member's role at their store; null for anyone else. */
  store_role?: StoreRoleSummary | null;
};

/** A user as admins see them, from GET /admin/users. Mirrors UserAccount in the backend. */
export type AdminUserAccount = Account & {
  /** False once an admin deactivates the account. */
  active: boolean;
  /** When the user first signed in (ISO 8601). */
  created_at: string;
};

/**
 * Body of PATCH /admin/users/{id}: at least one field. Staff need a store_role_id (their store is
 * that role's store). Mirrors UserUpdate in the backend.
 */
export type UserUpdateBody = { role?: Role; store_role_id?: number; active?: boolean };
