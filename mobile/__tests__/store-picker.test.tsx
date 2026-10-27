import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import type { Store } from '@/types/store';

// T078 acceptance: when I pick a preferred store, it is remembered after I close and reopen the
// app. It's saved on the device (AsyncStorage, kept in memory by its Jest mock) for each user.
//
// GET /locations is faked below; Supabase by __mocks__/@supabase/supabase-js.ts.

type SupabaseMock = typeof import('../__mocks__/@supabase/supabase-js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mockAuth, makeSession } = require('@supabase/supabase-js') as SupabaseMock;

const STORES: Store[] = [
  {
    id: 1,
    name: 'Camp Lejeune MCX',
    slug: 'camp-lejeune-mcx',
    address: 'Bldg. 1231 Birch St., Camp Lejeune, NC',
    hours: null,
  },
  { id: 2, name: 'Camp Pendleton MCX', slug: 'camp-pendleton-mcx', address: null, hours: null },
];

/** True while GET /locations fails. */
let locationsFail = false;

const fetchMock = jest.fn(async (url: string) => {
  const ok = new URL(url).pathname === '/locations' && !locationsFail;
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => null },
    text: async () =>
      JSON.stringify(ok ? STORES : { code: 'internal_error', message: 'Something broke' }),
  } as unknown as Response;
});
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockAuth.reset(makeSession());
  locationsFail = false;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

/** Opens the picker from Home's "Your store" row. */
async function openPicker(buttonName: string) {
  renderRouter('src/app');
  const button = await screen.findByRole('button', { name: buttonName });
  await act(async () => fireEvent.press(button));
  expect(screen).toHavePathname('/stores');
}

it("asks on Home for the shopper's store until they pick one", async () => {
  renderRouter('src/app');

  expect(await screen.findByText('Not chosen yet')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Choose your store' })).toBeOnTheScreen();
});

it('lists every store, and picking one shows it on Home', async () => {
  await openPicker('Choose your store');

  expect(await screen.findByText('Camp Pendleton MCX')).toBeOnTheScreen();
  expect(screen.getByText('Bldg. 1231 Birch St., Camp Lejeune, NC')).toBeOnTheScreen();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Camp Lejeune MCX' })));

  expect(screen).toHavePathname('/');
  expect(screen.getByText('Camp Lejeune MCX')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Change your store' })).toBeOnTheScreen();
});

it('remembers the store after the app is closed and reopened', async () => {
  await openPicker('Choose your store');
  const store = await screen.findByRole('button', { name: 'Camp Pendleton MCX' });
  await act(async () => fireEvent.press(store));

  screen.unmount();
  renderRouter('src/app');

  expect(await screen.findByText('Camp Pendleton MCX')).toBeOnTheScreen();
  expect(screen.queryByText('Not chosen yet')).not.toBeOnTheScreen();
});

it('marks the current store, and can stop using one', async () => {
  await AsyncStorage.setItem(
    'preferred-store:user-1',
    JSON.stringify({ id: 2, name: 'Camp Pendleton MCX' }),
  );
  await openPicker('Change your store');

  expect(
    await screen.findByRole('button', { name: 'Camp Pendleton MCX, your store' }),
  ).toBeOnTheScreen();
  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: "Don't use a preferred store" })),
  );

  expect(screen).toHavePathname('/');
  expect(screen.getByText('Not chosen yet')).toBeOnTheScreen();
  expect(await AsyncStorage.getItem('preferred-store:user-1')).toBeNull();
});

it("keeps each user's store separate on a shared phone", async () => {
  await AsyncStorage.setItem(
    'preferred-store:user-1',
    JSON.stringify({ id: 2, name: 'Camp Pendleton MCX' }),
  );
  mockAuth.reset({ access_token: 'token-2', user: { id: 'user-2', email: 'other@example.com' } });

  renderRouter('src/app');

  expect(await screen.findByText('Not chosen yet')).toBeOnTheScreen();
});

it("doesn't show the last user's store after someone else signs in", async () => {
  await AsyncStorage.setItem(
    'preferred-store:user-1',
    JSON.stringify({ id: 2, name: 'Camp Pendleton MCX' }),
  );
  renderRouter('src/app');
  expect(await screen.findByText('Camp Pendleton MCX')).toBeOnTheScreen();

  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Sign out' })));
  // User-2's saved store loads only when the test says, so the moment before it can be checked.
  let finishLoading: (saved: string | null) => void = () => {};
  jest
    .spyOn(AsyncStorage, 'getItem')
    .mockImplementationOnce(() => new Promise((resolve) => (finishLoading = resolve)));
  // The mock's signInWithPassword is always user-1, so tell the app's listener about user-2.
  const other = { access_token: 'token-2', user: { id: 'user-2', email: 'other@example.com' } };
  await act(async () => {
    for (const [listener] of mockAuth.onAuthStateChange.mock.calls) listener('SIGNED_IN', other);
  });

  // While it loads, Home shows neither user-1's store nor "Not chosen yet".
  expect(await screen.findByText('Scan & compare.')).toBeOnTheScreen();
  expect(screen.queryByText('Camp Pendleton MCX')).not.toBeOnTheScreen();
  expect(screen.queryByText('Not chosen yet')).not.toBeOnTheScreen();

  await act(async () => finishLoading(null));

  expect(screen.getByText('Not chosen yet')).toBeOnTheScreen();
});

it('goes Home after picking when the picker was opened directly', async () => {
  renderRouter('src/app', { initialUrl: '/stores' });
  const store = await screen.findByRole('button', { name: 'Camp Lejeune MCX' });

  await act(async () => fireEvent.press(store));

  expect(screen).toHavePathname('/');
  expect(await screen.findByText('Camp Lejeune MCX')).toBeOnTheScreen();
});

it("ignores a saved store it can't read", async () => {
  await AsyncStorage.setItem('preferred-store:user-1', 'not json');

  renderRouter('src/app');

  expect(await screen.findByText('Not chosen yet')).toBeOnTheScreen();
});

it("offers to try again when the stores can't be loaded", async () => {
  locationsFail = true;
  await openPicker('Choose your store');

  const retry = await screen.findByRole('button', { name: 'Try Again' });
  locationsFail = false;
  await act(async () => fireEvent.press(retry));

  expect(await screen.findByText('Camp Lejeune MCX')).toBeOnTheScreen();
});
