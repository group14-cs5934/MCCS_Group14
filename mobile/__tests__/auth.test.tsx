import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { getMe } from '@/api/me';
import { DEACTIVATED_MESSAGE } from '@/auth';

// T039 acceptance: users must create an account or sign in before using the app, and can sign
// out again. Supabase is faked by __mocks__/@supabase/supabase-js.ts, and GET /me (which gives
// the user's role) is stubbed in jest.setup.ts.

// A plain require gets the same mock instance the app imports (jest.requireMock makes its own).
type SupabaseMock = typeof import('../__mocks__/@supabase/supabase-js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mockAuth, makeSession, authError } = require('@supabase/supabase-js') as SupabaseMock;

const EMAIL = 'shopper@example.com';
const PASSWORD = 'secret123';

/** Types into each labeled field, e.g. fillIn({ Email: '...', Password: '...' }). */
function fillIn(fields: Record<string, string>) {
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.changeText(screen.getByLabelText(label), value);
  }
}

async function openSignIn() {
  renderRouter('src/app');
  await screen.findByText('Welcome back.');
}

async function openSignUp() {
  await openSignIn();
  fireEvent.press(screen.getByText('Create an account'));
  await screen.findByText('Create your account.');
}

beforeEach(() => mockAuth.reset(null));

describe('signed out', () => {
  it('opens on the sign-in screen instead of Home', async () => {
    await openSignIn();

    expect(screen).toHavePathname('/sign-in');
    expect(screen.queryByText('Scan & compare.')).not.toBeOnTheScreen();
  });

  it("can't open a product directly", async () => {
    renderRouter('src/app', { initialUrl: '/product/1' });

    expect(await screen.findByText('Welcome back.')).toBeOnTheScreen();
  });
});

describe('sign in', () => {
  it('signs in and shows Home', async () => {
    await openSignIn();

    fillIn({ Email: ` ${EMAIL} `, Password: PASSWORD });
    fireEvent.press(screen.getByText('Sign In'));

    expect(await screen.findByText('Scan & compare.')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD });
  });

  it('shows a friendly message for a wrong password', async () => {
    mockAuth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: authError('invalid_credentials'),
    } as never);
    await openSignIn();

    fillIn({ Email: EMAIL, Password: 'wrong-password' });
    fireEvent.press(screen.getByText('Sign In'));

    expect(
      await screen.findByText("That email and password don't match. Please try again."),
    ).toBeOnTheScreen();
    expect(screen).toHavePathname('/sign-in');
  });

  it('shows a friendly message when Supabase is unreachable', async () => {
    mockAuth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: authError('', 'AuthRetryableFetchError'),
    } as never);
    await openSignIn();

    fillIn({ Email: EMAIL, Password: PASSWORD });
    fireEvent.press(screen.getByText('Sign In'));

    expect(await screen.findByText(/Can't reach the server/)).toBeOnTheScreen();
  });

  it('checks the fields before calling Supabase', async () => {
    await openSignIn();

    fireEvent.press(screen.getByText('Sign In'));
    expect(screen.getByText('Enter your email.')).toBeOnTheScreen();
    expect(screen.getByText('Enter your password.')).toBeOnTheScreen();

    fillIn({ Email: 'not-an-email', Password: PASSWORD });
    fireEvent.press(screen.getByText('Sign In'));
    expect(screen.getByText('Enter a valid email, like name@example.com.')).toBeOnTheScreen();

    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('sign up', () => {
  it('creates an account and shows Home when no confirmation is needed', async () => {
    await openSignUp();

    fillIn({ Email: EMAIL, Password: PASSWORD, 'Confirm password': PASSWORD });
    fireEvent.press(screen.getByText('Create Account'));

    expect(await screen.findByText('Scan & compare.')).toBeOnTheScreen();
    expect(mockAuth.signUp).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD });
  });

  it('asks the user to check their email when confirmation is required', async () => {
    mockAuth.signUp.mockResolvedValueOnce({
      data: { session: null, user: makeSession(EMAIL).user },
      error: null,
    } as never);
    await openSignUp();

    fillIn({ Email: EMAIL, Password: PASSWORD, 'Confirm password': PASSWORD });
    fireEvent.press(screen.getByText('Create Account'));

    expect(await screen.findByText('Check your email')).toBeOnTheScreen();
    expect(screen.getByText(new RegExp(EMAIL))).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Back to sign in'));
    expect(await screen.findByText('Welcome back.')).toBeOnTheScreen();
  });

  it('shows a friendly message when the email is already registered', async () => {
    mockAuth.signUp.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: authError('user_already_exists'),
    } as never);
    await openSignUp();

    fillIn({ Email: EMAIL, Password: PASSWORD, 'Confirm password': PASSWORD });
    fireEvent.press(screen.getByText('Create Account'));

    expect(
      await screen.findByText('An account with this email already exists. Try signing in.'),
    ).toBeOnTheScreen();
  });

  it('rejects a short password and a mismatched confirmation', async () => {
    await openSignUp();

    fillIn({ Email: EMAIL, Password: '123', 'Confirm password': '1234' });
    fireEvent.press(screen.getByText('Create Account'));

    expect(screen.getByText('Use at least 6 characters.')).toBeOnTheScreen();
    expect(screen.getByText("Passwords don't match.")).toBeOnTheScreen();
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });
});

describe('signed in', () => {
  beforeEach(() => mockAuth.reset(makeSession(EMAIL)));

  it('shows who is signed in and signs out back to the sign-in screen', async () => {
    renderRouter('src/app');

    expect(await screen.findByText(`Signed in as ${EMAIL}`)).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByText('Sign out'));
    });

    expect(await screen.findByText('Welcome back.')).toBeOnTheScreen();
    expect(screen).toHavePathname('/sign-in');
    expect(mockAuth.signOut).toHaveBeenCalled();
  });
});

describe('roles', () => {
  const getMeMock = jest.mocked(getMe);

  beforeEach(() => {
    getMeMock.mockClear();
    mockAuth.reset(makeSession(EMAIL));
  });

  it('loads the role from GET /me after signing in', async () => {
    mockAuth.reset(null);
    await openSignIn();
    expect(getMeMock).not.toHaveBeenCalled();

    fillIn({ Email: EMAIL, Password: PASSWORD });
    fireEvent.press(screen.getByText('Sign In'));

    expect(await screen.findByText(`Signed in as ${EMAIL}`)).toBeOnTheScreen();
    expect(getMeMock).toHaveBeenCalledTimes(1);
  });

  it('opens the admin area for admins and marks them on Home', async () => {
    getMeMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { id: 'user-1', email: EMAIL, role: 'admin' },
    });
    renderRouter('src/app');

    // Admins start in the admin area, which opens on top of Home; Back shows Home.
    expect(await screen.findByRole('tab', { name: 'Products' })).toBeOnTheScreen();
    expect(screen).toHavePathname('/admin');

    await act(async () => router.back());

    expect(await screen.findByText(`Signed in as ${EMAIL} · Admin`)).toBeOnTheScreen();
  });

  it("still opens Home when the role can't be loaded", async () => {
    getMeMock.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'network', message: "Can't reach the server." },
    });
    renderRouter('src/app');

    expect(await screen.findByText(`Signed in as ${EMAIL}`)).toBeOnTheScreen();
    expect(getMeMock).toHaveBeenCalledTimes(1);
  });
});

// T097 acceptance: when an admin deactivates a user, that user can no longer sign in. Supabase
// still accepts their password, but the API refuses them (403 account_deactivated), so the app
// signs them straight back out and says why. This uses the real getMe against a fake API.
describe('deactivated accounts', () => {
  const getMeMock = jest.mocked(getMe);
  const { getMe: realGetMe } = jest.requireActual<typeof import('@/api/me')>('@/api/me');
  const originalFetch = globalThis.fetch;
  /** Whether the fake API refuses the signed-in user as deactivated. */
  let deactivated = true;

  const fetchMock = jest.fn(async () => {
    const [status, body] = deactivated
      ? [403, { code: 'account_deactivated', message: 'This account has been deactivated.' }]
      : [200, { id: 'user-1', email: EMAIL, role: 'user' }];
    return {
      ok: status === 200,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });

  beforeEach(() => {
    deactivated = true;
    getMeMock.mockImplementation(realGetMe);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // What jest.setup.ts gives every other test.
    getMeMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      data: { id: 'user-1', email: EMAIL, role: 'user' },
    }));
  });

  it("can't sign in: they're signed straight back out and told why", async () => {
    await openSignIn();

    fillIn({ Email: EMAIL, Password: PASSWORD });
    fireEvent.press(screen.getByText('Sign In'));

    expect(await screen.findByText(DEACTIVATED_MESSAGE)).toBeOnTheScreen();
    expect(screen).toHavePathname('/sign-in');
    expect(mockAuth.signOut).toHaveBeenCalled();
    expect(screen.queryByText(`Signed in as ${EMAIL}`)).not.toBeOnTheScreen();
  });

  it('are signed out when the app opens with their saved session', async () => {
    mockAuth.reset(makeSession(EMAIL));

    renderRouter('src/app');

    expect(await screen.findByText(DEACTIVATED_MESSAGE)).toBeOnTheScreen();
    expect(screen).toHavePathname('/sign-in');
  });

  it('can sign in again once reactivated, and the message is gone', async () => {
    await openSignIn();
    fillIn({ Email: EMAIL, Password: PASSWORD });
    fireEvent.press(screen.getByText('Sign In'));
    await screen.findByText(DEACTIVATED_MESSAGE);

    deactivated = false;
    fillIn({ Email: EMAIL, Password: PASSWORD });
    fireEvent.press(screen.getByText('Sign In'));
    expect(await screen.findByText(`Signed in as ${EMAIL}`)).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByText('Sign out'));
    });
    expect(await screen.findByText('Welcome back.')).toBeOnTheScreen();
    expect(screen.queryByText(DEACTIVATED_MESSAGE)).not.toBeOnTheScreen();
  });
});
