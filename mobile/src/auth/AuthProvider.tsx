import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { getMe, setAccessTokenProvider, setAccountDeactivatedHandler } from '@/api';
import type { Role } from '@/types/user';

import { authErrorMessage } from './errors';
import { supabase } from './supabase';

/** What signIn/signUp resolve to. They never throw. */
export type AuthResult = { ok: true; needsConfirmation: boolean } | { ok: false; message: string };

/** Shown on the sign-in screen after the app signs out a user whose account was deactivated. */
export const DEACTIVATED_MESSAGE =
  'This account has been deactivated, so it can’t sign in. If you think this is a mistake, contact an admin.';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /**
   * The user's role from GET /me, or null while it loads or if the API can't be reached. Treat
   * null like 'user': it never grants admin features.
   */
  role: Role | null;
  /** True while a signed-in user's role is still loading, so screens can wait before deciding. */
  roleLoading: boolean;
  isAdmin: boolean;
  /** True for a store worker or manager (not admins, who aren't tied to one store). */
  isStaff: boolean;
  /** True for a store manager. */
  isManager: boolean;
  /** The store a worker or manager works at, from GET /me; null for anyone else. */
  storeId: number | null;
  /**
   * Loads the role and store again, e.g. when the API says the user's access changed (they were
   * removed from their store, or moved) since they signed in.
   */
  refreshRole: () => void;
  /** True until the saved session has been loaded from the device. */
  initializing: boolean;
  /**
   * Why the app signed the user out, e.g. DEACTIVATED_MESSAGE, for the sign-in screen to show.
   * Cleared when they next sign in or create an account.
   */
  signedOutReason: string | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  /** needsConfirmation is true when Supabase requires the user to confirm their email first. */
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: authErrorMessage(error) };
    return { ok: true, needsConfirmation: false };
  } catch (error) {
    return { ok: false, message: authErrorMessage(error) };
  }
}

async function signUp(email: string, password: string): Promise<AuthResult> {
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { ok: false, message: authErrorMessage(error) };
    // With "Confirm email" on, Supabase returns no session until the link is opened.
    return { ok: true, needsConfirmation: data.session === null };
  } catch (error) {
    return { ok: false, message: authErrorMessage(error) };
  }
}

async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Provides the signed-in session to the app and sends its token with every API request. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  // Kept with the user ID it belongs to, so a previous user's role is never shown for the next.
  const [loadedRole, setLoadedRole] = useState<{
    userId: string;
    role: Role | null;
    storeId: number | null;
  } | null>(null);
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);

  useEffect(() => {
    // Fires INITIAL_SESSION right away with the saved session (or null), then on every change.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setInitializing(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // getSession() refreshes an expired token first, so requests always carry a valid one.
    setAccessTokenProvider(
      async () => (await supabase.auth.getSession()).data.session?.access_token,
    );
    return () => setAccessTokenProvider(null);
  }, []);

  useEffect(() => {
    // Supabase still lets a deactivated user sign in, but the API refuses every request they make.
    // The app calls GET /me right after signing in and on every launch, so they're signed out
    // straight away, and also mid-session as soon as any request is refused.
    setAccountDeactivatedHandler(async (token) => {
      // Only if the refused request was this session's, not one still answering from a previous
      // user (or from before signing out).
      const { session: current } = (await supabase.auth.getSession()).data;
      if (!current || current.access_token !== token) return;
      setSignedOutReason(DEACTIVATED_MESSAGE);
      await signOut();
    });
    return () => setAccountDeactivatedHandler(null);
  }, []);

  const userId = session?.user.id;
  // Bumped by refreshRole to load the role again; the current role stays until the new one loads.
  const [roleRequest, setRoleRequest] = useState(0);
  const refreshRole = useCallback(() => setRoleRequest((count) => count + 1), []);
  useEffect(() => {
    if (!userId) return;
    // GET /me also adds the user's row (with the 'user' role) the first time they sign in.
    const controller = new AbortController();
    getMe({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setLoadedRole({
          userId,
          role: result.ok ? result.data.role : null,
          storeId: result.ok ? (result.data.store_id ?? null) : null,
        });
      }
    });
    return () => controller.abort();
  }, [userId, roleRequest]);
  const roleLoaded = !!loadedRole && loadedRole.userId === userId;
  const role = roleLoaded ? loadedRole.role : null;
  const storeId = roleLoaded ? loadedRole.storeId : null;
  const roleLoading = !!userId && !roleLoaded;

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      role,
      roleLoading,
      isAdmin: role === 'admin',
      // Staff without a store can't happen (the API requires one), but never treat them as staff.
      isStaff: (role === 'worker' || role === 'manager') && storeId !== null,
      isManager: role === 'manager' && storeId !== null,
      storeId,
      refreshRole,
      initializing,
      signedOutReason,
      signIn: (email: string, password: string) => {
        setSignedOutReason(null);
        return signIn(email, password);
      },
      signUp: (email: string, password: string) => {
        setSignedOutReason(null);
        return signUp(email, password);
      },
      signOut,
    }),
    [session, role, storeId, refreshRole, roleLoading, initializing, signedOutReason],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
