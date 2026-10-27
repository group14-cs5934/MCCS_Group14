import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { getMe } from '@/api/me';
import type { StaffStockRow } from '@/types/store';
import type { AdminUserAccount, Role } from '@/types/user';

// Store staff roles: workers edit their store's stock on My store; managers also add and remove
// its workers; admins pick any store. Regular users are turned away. The signed-in user's role
// and store come from GET /me (stubbed in jest.setup.ts); the staff API is faked below and, like
// the real one, refuses other stores.

const getMeMock = jest.mocked(getMe);

const QUANTICO = 4;
const STORES = [
  { id: 1, name: 'Camp Lejeune MCX', slug: 'camp-lejeune-mcx', address: null, hours: null },
  { id: QUANTICO, name: 'Quantico MCX', slug: 'quantico-mcx', address: null, hours: null },
];

function stockRow(id: number, name: string, extra: Partial<StaffStockRow> = {}): StaffStockRow {
  return {
    product: { id, barcode: `0360002914${50 + id}`, name, size: '12 oz', image_url: null },
    in_stock: true,
    quantity: null,
    aisle: null,
    updated_at: '2026-10-26T12:00:00Z',
    admin_set_at: null,
    ...extra,
  };
}

function person(id: string, email: string, role: Role): AdminUserAccount {
  return {
    id,
    email,
    role,
    store_id: role === 'worker' || role === 'manager' ? QUANTICO : null,
    active: true,
    created_at: '2026-10-01T12:00:00Z',
  };
}

const api = {
  stock: [] as StaffStockRow[],
  staff: [] as AdminUserAccount[],
  /** Accounts that exist (signed up), by email, for adding a worker. */
  accounts: [] as AdminUserAccount[],
  /** Who's signed in, as the API sees them. */
  me: { role: 'user' as Role, storeId: null as number | null },
  /** Makes every staff request answer 403, as if the user were just removed from the store. */
  refuse: false,
  /** Makes staff-list requests answer 403 managers_only, as if the manager were made a worker. */
  managersOnly: false,
};

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const { pathname, searchParams } = new URL(url);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  if (pathname === '/locations') return jsonResponse(200, STORES);

  const match = pathname.match(/^\/staff\/stores\/(\d+)(\/.*)$/);
  if (!match) return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
  const [storeId, rest] = [Number(match[1]), match[2]];
  const ownStore = api.me.role === 'admin' || api.me.storeId === storeId;
  if (api.refuse || !ownStore) {
    return jsonResponse(403, { code: 'not_your_store', message: 'Not your store' });
  }

  if (rest === '/stock' && method === 'GET') {
    const q = (searchParams.get('q') ?? '').toLowerCase();
    return jsonResponse(
      200,
      api.stock.filter((row) => row.product.name.toLowerCase().includes(q)),
    );
  }
  const stockMatch = rest.match(/^\/stock\/(\d+)$/);
  if (stockMatch) {
    const productId = Number(stockMatch[1]);
    const row = api.stock.find((item) => item.product.id === productId)!;
    if (method === 'DELETE') {
      row.admin_set_at = null;
      return jsonResponse(204);
    }
    Object.assign(row, {
      in_stock: body.in_stock,
      quantity: body.quantity ?? null,
      updated_at: '2026-10-27T12:00:00Z',
      admin_set_at: '2026-10-27T12:00:00Z',
    });
    const store = STORES.find((item) => item.id === storeId)!;
    const { in_stock, quantity, aisle, updated_at, admin_set_at } = row;
    return jsonResponse(200, { store, in_stock, quantity, aisle, updated_at, admin_set_at });
  }
  if (rest.startsWith('/staff') && api.managersOnly) {
    return jsonResponse(403, { code: 'managers_only', message: 'Managers only' });
  }
  if (rest === '/staff' && method === 'GET') return jsonResponse(200, api.staff);
  if (rest === '/staff' && method === 'POST') {
    const found = api.accounts.find((item) => item.email === body.email);
    if (!found) {
      return jsonResponse(404, {
        code: 'user_not_found',
        message: 'No account with this email. They need to sign up in the app first.',
      });
    }
    const added = { ...found, role: 'worker' as Role, store_id: storeId };
    api.staff = [...api.staff, added];
    return jsonResponse(201, added);
  }
  const staffMatch = rest.match(/^\/staff\/(.+)$/);
  if (staffMatch && method === 'DELETE') {
    api.staff = api.staff.filter((item) => item.id !== staffMatch[1]);
    return jsonResponse(204);
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
});
const originalFetch = globalThis.fetch;

/** Who's signed in: their role and store, from GET /me (and as the fake API sees them). */
function signedInAs(role: Role, storeId: number | null = null) {
  api.me = { role, storeId };
  getMeMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: 'user-1', email: 'me@example.com', role, store_id: storeId },
  });
}

/** Each change sent: method, path, and body. */
const changes = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method && init.method !== 'GET')
    .map(([url, init]) => ({
      method: init!.method,
      path: new URL(url).pathname,
      ...(init!.body ? { body: JSON.parse(init!.body as string) } : {}),
    }));

beforeEach(() => {
  api.stock = [
    stockRow(1, 'Sample Chips'),
    stockRow(2, 'Diet Pepsi', { in_stock: false, admin_set_at: '2026-10-26T12:00:00Z' }),
  ];
  api.staff = [
    person('user-1', 'me@example.com', 'manager'),
    person('w-1', 'worker@example.com', 'worker'),
  ];
  api.accounts = [person('u-9', 'new@example.com', 'user')];
  api.refuse = false;
  api.managersOnly = false;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  getMeMock.mockReset();
  signedInAs('user'); // what jest.setup.ts gives every other test
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function openMyStore() {
  renderRouter('src/app', { initialUrl: '/my-store' });
  await screen.findByText('Quantico MCX', {}, { timeout: 3000 });
}

/** Opens the stock editor for a product, chooses, and saves. */
async function setStock(product: string, choice: string, quantity?: string) {
  fireEvent.press(screen.getByRole('button', { name: `Edit the stock of ${product}` }));
  fireEvent.press(screen.getByRole('radio', { name: `${product}: ${choice}` }));
  if (quantity !== undefined) {
    fireEvent.changeText(screen.getByLabelText(`Quantity of ${product} (optional)`), quantity);
  }
  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: `Save the stock of ${product}` })),
  );
}

describe('regular users', () => {
  beforeEach(() => signedInAs('user'));

  it('are turned away, and Home has no My store button', async () => {
    renderRouter('src/app', { initialUrl: '/my-store' });
    expect(await screen.findByText('Store staff only')).toBeOnTheScreen();

    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Go Home' })));
    expect(screen.queryByRole('button', { name: 'My store' })).not.toBeOnTheScreen();
  });
});

describe('workers', () => {
  beforeEach(() => signedInAs('worker', QUANTICO));

  it("open their store from Home, and don't see its staff", async () => {
    renderRouter('src/app');
    const button = await screen.findByRole('button', { name: 'My store' });
    expect(screen.getByText(/· Store worker$/)).toBeOnTheScreen();

    await act(async () => fireEvent.press(button));

    expect(screen).toHavePathname('/my-store');
    expect(await screen.findByText('You work at this store')).toBeOnTheScreen();
    expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: 'Staff' })).not.toBeOnTheScreen();
  });

  it('mark a product out of stock at their store', async () => {
    await openMyStore();
    await screen.findByText('Sample Chips');

    await setStock('Sample Chips', 'Out of stock');

    expect(changes()).toEqual([
      { method: 'PUT', path: `/staff/stores/${QUANTICO}/stock/1`, body: { in_stock: false } },
    ]);
    expect(screen.getAllByText('Out of stock')).toHaveLength(2); // both products now
    expect(screen.getAllByText('Set by hand')).toHaveLength(2);
  });

  it('set a quantity, which must be a whole number', async () => {
    await openMyStore();
    await screen.findByText('Sample Chips');

    await setStock('Sample Chips', 'In stock', '0');
    expect(screen.getByText('Enter a whole number above 0, or leave it empty.')).toBeOnTheScreen();
    expect(changes()).toHaveLength(0);

    fireEvent.changeText(screen.getByLabelText('Quantity of Sample Chips (optional)'), '12');
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Save the stock of Sample Chips' })),
    );

    expect(changes()).toEqual([
      {
        method: 'PUT',
        path: `/staff/stores/${QUANTICO}/stock/1`,
        body: { in_stock: true, quantity: 12 },
      },
    ]);
    expect(screen.getByText('In stock (12)')).toBeOnTheScreen();
  });

  it('hand stock set by hand back to automatic updates', async () => {
    await openMyStore();
    await screen.findByText('Diet Pepsi');

    await setStock('Diet Pepsi', 'Automatic');

    expect(changes()).toEqual([{ method: 'DELETE', path: `/staff/stores/${QUANTICO}/stock/2` }]);
    expect(screen.queryByText('Set by hand')).not.toBeOnTheScreen();
  });

  it('search their store by name', async () => {
    await openMyStore();
    await screen.findByText('Sample Chips');

    fireEvent.changeText(screen.getByLabelText('Find a product'), 'pepsi');
    await act(async () => jest.advanceTimersByTime(500));

    expect(await screen.findByText('1 product')).toBeOnTheScreen();
    expect(screen.queryByText('Sample Chips')).not.toBeOnTheScreen();
    const lastStockUrl = fetchMock.mock.calls
      .map(([url]) => url)
      .filter((url) => url.includes('/stock?'))
      .at(-1)!;
    expect(new URL(lastStockUrl).searchParams.get('q')).toBe('pepsi');
  });

  it('see "Store staff only" once the API no longer counts them as staff', async () => {
    api.refuse = true;

    renderRouter('src/app', { initialUrl: '/my-store' });

    expect(await screen.findByText('Store staff only')).toBeOnTheScreen();
    // Their role is loaded again, so Home shows the right buttons.
    expect(getMeMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(getMeMock.mock.calls.length).toBeLessThan(4); // once more, not in a loop
  });
});

describe('managers', () => {
  beforeEach(() => signedInAs('manager', QUANTICO));

  async function openStaff() {
    await openMyStore();
    expect(screen.getByText('You manage this store')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('tab', { name: 'Staff' }));
    await screen.findByText('worker@example.com');
  }

  it("list their store's staff, and can't remove themselves", async () => {
    await openStaff();

    expect(screen.getByLabelText('me@example.com, you, Manager')).toBeOnTheScreen();
    expect(screen.getByLabelText('worker@example.com, Worker')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Remove me@example.com' })).not.toBeOnTheScreen();
  });

  it('add a worker by the email they signed up with', async () => {
    await openStaff();

    fireEvent.changeText(screen.getByLabelText('Their email'), ' new@example.com ');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Add worker' })));

    expect(changes()).toEqual([
      {
        method: 'POST',
        path: `/staff/stores/${QUANTICO}/staff`,
        body: { email: 'new@example.com' },
      },
    ]);
    expect(screen.getByText('new@example.com is now a worker here.')).toBeOnTheScreen();
    expect(await screen.findByLabelText('new@example.com, Worker')).toBeOnTheScreen();
  });

  it("are told when someone hasn't signed up yet", async () => {
    await openStaff();

    fireEvent.changeText(screen.getByLabelText('Their email'), 'nobody@example.com');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Add worker' })));

    expect(
      screen.getByText('No account with this email. They need to sign up in the app first.'),
    ).toBeOnTheScreen();
  });

  it('keep Stock but lose Staff once made a worker since signing in', async () => {
    await openMyStore();
    const calls = getMeMock.mock.calls.length;
    api.managersOnly = true;

    await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Staff' })));

    expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: 'Staff' })).not.toBeOnTheScreen();
    expect(screen.queryByText('Store staff only')).not.toBeOnTheScreen();
    expect(getMeMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it('remove a worker after confirming', async () => {
    await openStaff();

    fireEvent.press(screen.getByRole('button', { name: 'Remove worker@example.com' }));
    expect(
      screen.getByText(
        "Remove worker@example.com from Quantico MCX? They'll become a regular user.",
      ),
    ).toBeOnTheScreen();
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Remove worker@example.com' })),
    );

    expect(changes()).toEqual([{ method: 'DELETE', path: `/staff/stores/${QUANTICO}/staff/w-1` }]);
    expect(screen.queryByText('worker@example.com')).not.toBeOnTheScreen();
  });
});

describe('admins', () => {
  beforeEach(() => signedInAs('admin'));

  it('choose a store, then manage its stock and staff', async () => {
    api.staff = [
      person('m-1', 'manager@example.com', 'manager'),
      person('w-1', 'worker@example.com', 'worker'),
    ];
    renderRouter('src/app', { initialUrl: '/my-store' });

    const quantico = await screen.findByRole('button', { name: 'Manage Quantico MCX' });
    await act(async () => fireEvent.press(quantico));

    expect(await screen.findByText('Managing as an admin')).toBeOnTheScreen();
    expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('tab', { name: 'Staff' }));
    expect(await screen.findByText('worker@example.com')).toBeOnTheScreen();
    // Only admins remove managers.
    expect(screen.getByRole('button', { name: 'Remove manager@example.com' })).toBeOnTheScreen();
  });
});
