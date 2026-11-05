import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { getMe } from '@/api/me';

// A plain require gets the same mock instance the app imports (jest.requireMock makes its own).
type SupabaseMock = typeof import('../__mocks__/@supabase/supabase-js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mockAuth, makeSession } = require('@supabase/supabase-js') as SupabaseMock;

// The Account screen (opened from the Home avatar): who is signed in, the shopper's store, the
// staff and admin shortcuts, and Sign out.

const getMeMock = jest.mocked(getMe);

const fetchMock = jest.fn(async () => {
  return {
    ok: false,
    status: 404,
    headers: { get: () => null },
    text: async () => JSON.stringify({ code: 'not_found', message: 'Not Found' }),
  } as unknown as Response;
});
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockAuth.reset(makeSession());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() =>
  getMeMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: 'user-1', email: 'shopper@example.com', role: 'user' },
  }),
);

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('account screen', () => {
  it('shows the email, the store row and Sign out, but no staff or admin rows', async () => {
    renderRouter('src/app', { initialUrl: '/account' });

    expect(await screen.findByText('shopper@example.com')).toBeOnTheScreen();
    expect(screen.getByText('Shopper')).toBeOnTheScreen();
    expect(screen.getByText('SH')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'My store' })).not.toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Your store' }));
    expect(screen).toHavePathname('/stores');
  });

  it('shows the chosen store on the store row', async () => {
    await AsyncStorage.setItem(
      'preferred-store:user-1',
      JSON.stringify({ id: 1, name: 'Quantico MCX', slug: 'quantico-mcx' }),
    );
    renderRouter('src/app', { initialUrl: '/account' });

    expect(await screen.findByText('Quantico MCX')).toBeOnTheScreen();
  });

  it('gives staff My store', async () => {
    getMeMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: 'user-1',
        email: 'staff@example.com',
        role: 'staff',
        store_id: 1,
        store_role: { id: 1, name: 'Worker', permissions: ['edit_stock'] },
      },
    });
    renderRouter('src/app', { initialUrl: '/account' });

    expect(await screen.findByText('Worker')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'My store' })));
    expect(screen).toHavePathname('/my-store');
  });

  it('gives admins Admin and Store tools', async () => {
    getMeMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'user-1', email: 'admin@example.com', role: 'admin' },
    });
    renderRouter('src/app', { initialUrl: '/account' });

    expect(await screen.findByText('Administrator')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Store tools' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'My store' })).not.toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Admin' })));
    expect(screen).toHavePathname('/admin');
  });

  it('signs out', async () => {
    renderRouter('src/app', { initialUrl: '/account' });

    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Sign out' })));

    expect(mockAuth.signOut).toHaveBeenCalled();
    expect(await screen.findByText('Welcome back.')).toBeOnTheScreen();
  });

  it('opens from the Home avatar and goes back to Home', async () => {
    renderRouter('src/app');

    fireEvent.press(await screen.findByRole('button', { name: 'Account' }));
    expect(screen).toHavePathname('/account');
    expect(await screen.findByText('shopper@example.com')).toBeOnTheScreen();
  });
});
