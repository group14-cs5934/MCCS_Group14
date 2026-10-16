// Used automatically by every Jest test in place of Supabase, so tests never reach a real
// project. Starts signed in, so screens behind the sign-in gate render as usual. A test that's
// about auth controls it through mockAuth (see __tests__/auth.test.tsx):
//   const { mockAuth } = require('@supabase/supabase-js') as SupabaseMock;
//   mockAuth.reset(null); // signed out

type MockSession = { access_token: string; user: { id: string; email: string } };
type Listener = (event: string, session: MockSession | null) => void;

const listeners = new Set<Listener>();
let currentSession: MockSession | null = null;

export function makeSession(email = 'shopper@example.com'): MockSession {
  return { access_token: 'test-access-token', user: { id: 'user-1', email } };
}

/** An error shaped like Supabase's AuthApiError, e.g. authError('invalid_credentials'). */
export function authError(code: string, name = 'AuthApiError') {
  return { __isAuthError: true, name, code, message: code, status: 400 };
}

function emit(event: string, session: MockSession | null) {
  currentSession = session;
  listeners.forEach((listener) => listener(event, session));
}

async function signInAs(email: string) {
  const session = makeSession(email);
  emit('SIGNED_IN', session);
  return { data: { session, user: session.user }, error: null };
}

export const mockAuth = {
  /** Who's signed in when the next screen renders: a session, or null for signed out. */
  reset(session: MockSession | null = makeSession()) {
    listeners.clear();
    currentSession = session;
    jest.clearAllMocks();
  },
  getSession: jest.fn(async () => ({ data: { session: currentSession }, error: null })),
  onAuthStateChange: jest.fn((listener: Listener) => {
    listeners.add(listener);
    listener('INITIAL_SESSION', currentSession);
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  }),
  signInWithPassword: jest.fn(({ email }: { email: string; password: string }) => signInAs(email)),
  signUp: jest.fn(({ email }: { email: string; password: string }) => signInAs(email)),
  signOut: jest.fn(async () => {
    emit('SIGNED_OUT', null);
    return { error: null };
  }),
  startAutoRefresh: jest.fn(),
  stopAutoRefresh: jest.fn(),
};
mockAuth.reset();

export const createClient = () => ({ auth: mockAuth });

export const isAuthError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && '__isAuthError' in error;
