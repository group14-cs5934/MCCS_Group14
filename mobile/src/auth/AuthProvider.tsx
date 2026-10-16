import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getMe, setAccessTokenProvider } from '@/api';
import type { Role } from '@/types/user';

import { authErrorMessage } from './errors';
import { supabase } from './supabase';

/** What signIn/signUp resolve to. They never throw. */
export type AuthResult = { ok: true; needsConfirmation: boolean } | { ok: false; message: string };

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /**
   * The user's role from GET /me, or null while it loads or if the API can't be reached. Treat
   * null like 'user': it never grants admin features.
   */
  role: Role | null;
  isAdmin: boolean;
  /** True until the saved session has been loaded from the device. */
  initializing: boolean;
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
  const [loadedRole, setLoadedRole] = useState<{ userId: string; role: Role | null } | null>(null);

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

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    // GET /me also adds the user's row (with the 'user' role) the first time they sign in.
    const controller = new AbortController();
    getMe({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setLoadedRole({ userId, role: result.ok ? result.data.role : null });
      }
    });
    return () => controller.abort();
  }, [userId]);
  const role = loadedRole && loadedRole.userId === userId ? loadedRole.role : null;

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      role,
      isAdmin: role === 'admin',
      initializing,
      signIn,
      signUp,
      signOut,
    }),
    [session, role, initializing],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
