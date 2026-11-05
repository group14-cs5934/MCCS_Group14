import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { getMe } from '@/api/me';
import type { Role } from '@/types/user';
import type { Store } from '@/types/store';

// Admins add, edit and delete stores from the store list and a store's page; shoppers and staff
// see none of those controls.
//
// GET /locations and the admin store calls are faked here (a small in-memory list); the signed-in
// user's role comes from GET /me (stubbed in jest.setup.ts).

const getMeMock = jest.mocked(getMe);

let stores: Store[];
/** Set to make the next POST or PATCH fail like the API does. */
let nextFailure: { status: number; body: unknown } | null;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (body === null ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const { pathname } = new URL(url);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(init.body as string) : null;
  const id = Number(pathname.match(/^\/(?:locations|admin\/stores)\/(\d+)$/)?.[1]);
  const store = stores.find((item) => item.id === id);

  if (method !== 'GET' && nextFailure) {
    const failure = nextFailure;
    nextFailure = null;
    return jsonResponse(failure.status, failure.body);
  }
  if (pathname === '/locations') return jsonResponse(200, stores);
  if (pathname === '/admin/stores' && method === 'POST') {
    const created: Store = {
      id: 10,
      name: body.name,
      slug: body.slug ?? body.name.toLowerCase().replace(/\s+/g, '-'),
      address: body.address ?? null,
      hours: body.hours ?? null,
    };
    stores = [...stores, created];
    return jsonResponse(201, created);
  }
  if (pathname.startsWith('/locations/') && store) return jsonResponse(200, store);
  if (pathname.startsWith('/admin/stores/') && store && method === 'PATCH') {
    Object.assign(store, body);
    return jsonResponse(200, store);
  }
  if (pathname.startsWith('/admin/stores/') && store && method === 'DELETE') {
    stores = stores.filter((item) => item !== store);
    return jsonResponse(204, null);
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
});
const originalFetch = globalThis.fetch;

/** Each non-GET call: method, path and body. */
const changes = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method && init.method !== 'GET')
    .map(([url, init]) => ({
      method: init!.method,
      path: new URL(url).pathname,
      body: init!.body ? JSON.parse(init!.body as string) : null,
    }));

function signedInAs(role: Role) {
  getMeMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: 'user-1', email: 'someone@example.com', role },
  });
}

beforeAll(() => Ionicons.loadFont());

beforeEach(async () => {
  await AsyncStorage.clear();
  stores = [
    {
      id: 1,
      name: 'Camp Lejeune MCX',
      slug: 'camp-lejeune-mcx',
      address: 'Birch St.',
      hours: null,
    },
    { id: 2, name: 'MCX Online Store', slug: 'mcx-online', address: null, hours: null },
  ];
  nextFailure = null;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function press(name: string) {
  const button = await screen.findByRole('button', { name });
  await act(async () => fireEvent.press(button));
}

it('shows a shopper no add, edit or delete controls', async () => {
  renderRouter('src/app', { initialUrl: '/stores' });
  await screen.findByText('Camp Lejeune MCX');
  expect(screen.queryByRole('button', { name: 'Add store' })).not.toBeOnTheScreen();

  await press('Camp Lejeune MCX details');
  await screen.findByLabelText('Address: Birch St.');
  expect(screen.queryByRole('button', { name: 'Edit store' })).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Delete store' })).not.toBeOnTheScreen();
});

it('shows store staff no admin controls either', async () => {
  signedInAs('staff');
  renderRouter('src/app', { initialUrl: '/stores' });
  await screen.findByText('Camp Lejeune MCX');

  expect(screen.queryByRole('button', { name: 'Add store' })).not.toBeOnTheScreen();
});

it('lets an admin add a store, which is then listed', async () => {
  signedInAs('admin');
  renderRouter('src/app', { initialUrl: '/stores' });
  await press('Add store');
  expect(screen).toHavePathname('/store/new');

  fireEvent.changeText(screen.getByLabelText('Name'), 'Quantico MCX');
  fireEvent.changeText(screen.getByLabelText('Hours'), 'Daily 9 AM–9 PM');
  await press('Add store');

  expect(changes()).toEqual([
    {
      method: 'POST',
      path: '/admin/stores',
      body: { name: 'Quantico MCX', hours: 'Daily 9 AM–9 PM' },
    },
  ]);
  expect(await screen.findByText('Quantico MCX')).toBeOnTheScreen();
  expect(screen).toHavePathname('/stores');
});

it('asks for a name before adding a store', async () => {
  signedInAs('admin');
  renderRouter('src/app', { initialUrl: '/store/new' });
  await press('Add store');

  expect(screen.getByText('Enter the store’s name.')).toBeOnTheScreen();
  expect(changes()).toEqual([]);
});

it('says when another store already has the slug (409)', async () => {
  signedInAs('admin');
  renderRouter('src/app', { initialUrl: '/store/new' });
  nextFailure = {
    status: 409,
    body: { code: 'slug_taken', message: 'Another store has this slug' },
  };
  fireEvent.changeText(await screen.findByLabelText('Name'), 'Another MCX');
  fireEvent.changeText(screen.getByLabelText('Slug'), 'mcx-online');
  await press('Add store');

  expect(await screen.findByText(/Another store already has this slug/)).toBeOnTheScreen();
  expect(screen).toHavePathname('/store/new');
});

it('shows the API’s problems next to the fields (422)', async () => {
  signedInAs('admin');
  renderRouter('src/app', { initialUrl: '/store/new' });
  nextFailure = {
    status: 422,
    body: {
      code: 'validation_error',
      message: 'The request has 1 invalid field',
      details: [{ loc: ['body', 'slug'], msg: 'String should match pattern', type: 'x' }],
    },
  };
  fireEvent.changeText(await screen.findByLabelText('Name'), 'Quantico MCX');
  fireEvent.changeText(screen.getByLabelText('Slug'), 'Bad Slug');
  await press('Add store');

  expect(await screen.findByText('String should match pattern')).toBeOnTheScreen();
});

it('lets an admin edit a store, sending only what changed', async () => {
  signedInAs('admin');
  renderRouter('src/app', { initialUrl: '/store/1' });
  await press('Edit store');

  fireEvent.changeText(screen.getByLabelText('Hours'), 'Mon–Fri 9 AM–5 PM');
  fireEvent.changeText(screen.getByLabelText('Address'), '');
  await press('Save changes');

  expect(changes()).toEqual([
    {
      method: 'PATCH',
      path: '/admin/stores/1',
      body: { address: null, hours: 'Mon–Fri 9 AM–5 PM' },
    },
  ]);
  expect(await screen.findByLabelText('Hours: Mon–Fri 9 AM–5 PM')).toBeOnTheScreen();
  expect(screen.getByLabelText('Address: Not listed')).toBeOnTheScreen();
});

it('lets an admin delete a store after confirming, then returns to the list', async () => {
  signedInAs('admin');
  renderRouter('src/app', { initialUrl: '/stores' });
  await press('Camp Lejeune MCX details');
  await press('Delete store');
  // Nothing is sent until it's confirmed.
  expect(changes()).toEqual([]);
  await press('Confirm delete store');

  expect(changes()).toEqual([{ method: 'DELETE', path: '/admin/stores/1', body: null }]);
  expect(await screen.findByText('MCX Online Store')).toBeOnTheScreen();
  expect(screen).toHavePathname('/stores');
  expect(screen.queryByText('Camp Lejeune MCX')).not.toBeOnTheScreen();
});

it('keeps the store if the delete is cancelled', async () => {
  signedInAs('admin');
  renderRouter('src/app', { initialUrl: '/store/1' });
  await press('Delete store');
  await press('Cancel');

  expect(changes()).toEqual([]);
  expect(screen.getByRole('button', { name: 'Delete store' })).toBeOnTheScreen();
});
