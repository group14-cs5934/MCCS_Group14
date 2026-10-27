import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { getMe } from '@/api/me';
import { SEARCH_DEBOUNCE_MS } from '@/hooks/useProductSearch';
import type { AuditLogEntry } from '@/types/audit';
import type { Product } from '@/types/product';
import type { AdminUserAccount, Role } from '@/types/user';

// T090 acceptance: when a regular user tries to open the admin area, access is denied; an admin
// can open it and see the product list. Admins also see the app's users, and start in the admin
// area after signing in.
//
// The signed-in user's role comes from GET /me (stubbed in jest.setup.ts); the product list from
// GET /admin/products, faked here.

const getMeMock = jest.mocked(getMe);

function product(id: number, name: string): Product {
  const at = '2026-10-20T12:00:00Z';
  return {
    id,
    barcode: String(12000000000 + id).padStart(12, '0'),
    name,
    description: null,
    size: null,
    image_url: null,
    brand_id: null,
    category_id: null,
    brand: null,
    category: null,
    price: null,
    source: null,
    source_id: null,
    last_synced_at: null,
    created_at: at,
    updated_at: at,
  };
}

const CATALOG = [product(1, 'Coca-Cola Classic'), product(2, 'Diet Pepsi')];

const USERS: AdminUserAccount[] = [
  {
    id: 'u-1',
    email: 'admin@example.com',
    role: 'admin',
    active: true,
    created_at: '2026-10-01T12:00:00Z',
  },
  {
    id: 'u-2',
    email: 'shopper@example.com',
    role: 'user',
    active: false,
    created_at: '2026-10-15T12:00:00Z',
  },
];

/** GET /locations: the stores a worker or manager can be at. */
const STORES = [
  { id: 1, name: 'Camp Lejeune MCX', slug: 'camp-lejeune-mcx', address: null, hours: null },
  { id: 4, name: 'Quantico MCX', slug: 'quantico-mcx', address: null, hours: null },
];

/** What GET /admin/products answers: the catalog (filtered by q), or an error status. */
let adminProducts: { status: number } | null = null;
/** What GET /admin/users answers: USERS (filtered by email), or an error status. */
let adminUsers: { status: number } | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** GET /admin/audit-log's entries, newest first. */
const ACTIVITY: AuditLogEntry[] = [
  {
    id: 3,
    admin_id: 'u-1',
    admin_email: 'admin@example.com',
    action: 'product.update',
    target_type: 'product',
    target_id: '2',
    changes: {
      price: { from: '2.49', to: '2.99' },
      name: { from: 'Pepsi', to: 'Diet Pepsi' },
      size: { from: null, to: '20 fl oz' },
      category_id: { from: null, to: 4 },
    },
    created_at: '2026-10-26T15:04:00Z',
  },
  {
    id: 2,
    admin_id: null,
    admin_email: 'former@example.com',
    action: 'review.hide',
    target_type: 'review',
    target_id: '9',
    changes: { hidden: { from: false, to: true } },
    created_at: '2026-10-25T10:00:00Z',
  },
  {
    id: 1,
    admin_id: 'u-1',
    admin_email: 'admin@example.com',
    action: 'product.delete',
    target_type: 'product',
    target_id: '5',
    changes: { name: { from: 'Old Chips', to: null }, ratings: { from: 3, to: 0 } },
    created_at: '2026-10-24T09:00:00Z',
  },
];

/** What GET /admin/audit-log answers: these entries (filtered by target_type), or an error. */
let auditLog: { status: number } | null = null;
let auditEntries: AuditLogEntry[] = ACTIVITY;
/** The users GET /admin/users lists and PATCH /admin/users/{id} changes. */
let userList: AdminUserAccount[] = USERS;
/** What PATCH /admin/users/{id} answers instead of the changed user, if set. */
let userUpdateFails: { status: number; code: string; message: string } | null = null;

const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const { pathname, searchParams } = new URL(url);
  const userId = pathname.match(/^\/admin\/users\/(.+)$/)?.[1];
  if (userId && init?.method === 'PATCH') {
    if (userUpdateFails) return jsonResponse(userUpdateFails.status, userUpdateFails);
    const user: AdminUserAccount = {
      ...userList.find((item) => item.id === userId)!,
      ...JSON.parse(init.body as string),
    };
    // Like the API: only workers and managers have a store.
    if (user.role !== 'worker' && user.role !== 'manager') user.store_id = null;
    userList = userList.map((item) => (item.id === userId ? user : item));
    return jsonResponse(200, user);
  }
  if (pathname === '/admin/products') {
    if (adminProducts)
      return jsonResponse(adminProducts.status, { code: 'forbidden', message: 'No' });
    const q = (searchParams.get('q') ?? '').toLowerCase();
    return jsonResponse(
      200,
      CATALOG.filter((item) => item.name.toLowerCase().includes(q)),
    );
  }
  if (pathname === '/admin/audit-log') {
    if (auditLog) return jsonResponse(auditLog.status, { code: 'forbidden', message: 'No' });
    const targetType = searchParams.get('target_type');
    return jsonResponse(
      200,
      auditEntries.filter((entry) => !targetType || entry.target_type === targetType),
    );
  }
  if (pathname === '/locations') return jsonResponse(200, STORES);
  if (pathname === '/admin/users') {
    if (adminUsers) return jsonResponse(adminUsers.status, { code: 'forbidden', message: 'No' });
    const email = (searchParams.get('email') ?? '').toLowerCase();
    return jsonResponse(
      200,
      userList.filter((user) => user.email!.includes(email)),
    );
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
});
const originalFetch = globalThis.fetch;

/** Who's signed in: their role from GET /me. */
function signedInAs(role: Role) {
  getMeMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: 'user-1', email: 'someone@example.com', role },
  });
}

const adminRequests = () =>
  fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/admin/products');
const activityRequests = () =>
  fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/admin/audit-log');
const userRequests = () =>
  fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/admin/users');
/** Each PATCH /admin/users/{id}: the path and the body sent. */
const userUpdates = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([url, init]) => ({
      path: new URL(url).pathname,
      body: JSON.parse(init!.body as string),
    }));

beforeEach(() => {
  adminProducts = null;
  adminUsers = null;
  auditLog = null;
  auditEntries = ACTIVITY;
  userList = USERS;
  userUpdateFails = null;
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

describe('regular users', () => {
  beforeEach(() => signedInAs('user'));

  it('are denied when they open the admin area', async () => {
    renderRouter('src/app', { initialUrl: '/admin' });

    expect(await screen.findByText('Admins only')).toBeOnTheScreen();
    expect(screen.queryByText('Diet Pepsi')).not.toBeOnTheScreen();
    expect(adminRequests()).toHaveLength(0);
  });

  it('can go back home from the denied screen', async () => {
    renderRouter('src/app', { initialUrl: '/admin' });

    fireEvent.press(await screen.findByRole('button', { name: 'Go Home' }));

    expect(screen).toHavePathname('/');
  });

  it("stay on Home and don't see the Admin button", async () => {
    renderRouter('src/app');

    await screen.findByText('Scan & compare.');
    await act(async () => {}); // let the role finish loading
    expect(screen).toHavePathname('/');
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeOnTheScreen();
  });
});

describe('admins', () => {
  beforeEach(() => signedInAs('admin'));

  it('can open the admin area and see the product list', async () => {
    renderRouter('src/app', { initialUrl: '/admin' });

    expect(await screen.findByText('Coca-Cola Classic')).toBeOnTheScreen();
    expect(screen.getByText('Diet Pepsi')).toBeOnTheScreen();
    expect(screen.getByText('2 products')).toBeOnTheScreen();
    expect(screen.queryByText('Admins only')).not.toBeOnTheScreen();
    expect(new URL(adminRequests()[0][0]).searchParams.get('limit')).toBe('100');
  });

  it('start in the admin area when the app opens', async () => {
    renderRouter('src/app');

    expect(await screen.findByText('Diet Pepsi')).toBeOnTheScreen();
    expect(screen).toHavePathname('/admin');
  });

  it('can go back to Home without being sent to the admin area again', async () => {
    renderRouter('src/app');
    await screen.findByText('Diet Pepsi');

    await act(async () => router.back());

    expect(screen).toHavePathname('/');
    expect(screen.getByText('Scan & compare.')).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Admin' }));
    expect(screen).toHavePathname('/admin');
    expect(await screen.findByText('Diet Pepsi')).toBeOnTheScreen();
  });

  it('open a product for editing by tapping it (T091)', async () => {
    renderRouter('src/app', { initialUrl: '/admin' });

    const row = await screen.findByText('Diet Pepsi');
    // The form starts loading as it opens; let that finish inside act.
    await act(async () => fireEvent.press(row));

    expect(screen).toHavePathname('/admin-product/2');
  });

  it('can add a product from the list (T091)', async () => {
    renderRouter('src/app', { initialUrl: '/admin' });
    await screen.findByText('Diet Pepsi');

    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Add product' })));

    expect(screen).toHavePathname('/admin-product/new');
  });

  it('can search the product list', async () => {
    renderRouter('src/app', { initialUrl: '/admin' });
    await screen.findByText('Coca-Cola Classic');

    fireEvent.changeText(screen.getByLabelText('Search products'), 'pepsi');
    await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));

    expect(await screen.findByText('1 product')).toBeOnTheScreen();
    expect(screen.queryByText('Coca-Cola Classic')).not.toBeOnTheScreen();
    expect(new URL(adminRequests().at(-1)![0]).searchParams.get('q')).toBe('pepsi');
  });

  it('are denied if the API no longer counts them as an admin', async () => {
    adminProducts = { status: 403 };

    renderRouter('src/app', { initialUrl: '/admin' });

    expect(await screen.findByText('Admins only')).toBeOnTheScreen();
  });
});

describe('while the role is unknown', () => {
  it('waits for the role before deciding', async () => {
    getMeMock.mockReturnValue(new Promise(() => {})); // GET /me never answers

    renderRouter('src/app', { initialUrl: '/admin' });

    expect(await screen.findByText('Checking access…')).toBeOnTheScreen();
    expect(screen.queryByText('Admins only')).not.toBeOnTheScreen();
    expect(adminRequests()).toHaveLength(0);
  });

  it('denies access if the role can’t be loaded', async () => {
    getMeMock.mockResolvedValue({
      ok: false,
      error: { kind: 'network', message: "Can't reach the server." },
    });

    renderRouter('src/app', { initialUrl: '/admin' });

    expect(await screen.findByText('Admins only')).toBeOnTheScreen();
  });
});

describe('users list', () => {
  beforeEach(() => signedInAs('admin'));

  async function openUsers() {
    renderRouter('src/app', { initialUrl: '/admin' });
    await screen.findByText('Diet Pepsi');
    fireEvent.press(screen.getByRole('tab', { name: 'Users' }));
  }

  it('shows every user with their role and whether they are active', async () => {
    await openUsers();

    expect(await screen.findByText('admin@example.com')).toBeOnTheScreen();
    expect(screen.getByText('shopper@example.com')).toBeOnTheScreen();
    expect(screen.getByText('2 users')).toBeOnTheScreen();
    expect(screen.getByText('Admin')).toBeOnTheScreen();
    expect(screen.getByText('Deactivated')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('shopper@example.com, User, Deactivated, joined Oct 15, 2026'),
    ).toBeOnTheScreen();
    expect(new URL(userRequests()[0][0]).searchParams.get('limit')).toBe('100');
  });

  it('searches users by email', async () => {
    await openUsers();
    await screen.findByText('2 users');

    fireEvent.changeText(screen.getByLabelText('Search users by email'), 'shop');
    await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));

    expect(await screen.findByText('1 user')).toBeOnTheScreen();
    expect(screen.queryByText('admin@example.com')).not.toBeOnTheScreen();
    expect(new URL(userRequests().at(-1)![0]).searchParams.get('email')).toBe('shop');
  });

  it('keeps each list’s search when switching between Products and Users', async () => {
    renderRouter('src/app', { initialUrl: '/admin' });
    await screen.findByText('Diet Pepsi');
    fireEvent.changeText(screen.getByLabelText('Search products'), 'pepsi');
    await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    await screen.findByText('1 product');

    fireEvent.press(screen.getByRole('tab', { name: 'Users' }));
    expect(await screen.findByText('2 users')).toBeOnTheScreen();
    expect(screen.getByLabelText('Search users by email')).toHaveProp('value', '');
    // The users list never searched for the products' text.
    expect(userRequests().every(([url]) => !new URL(url).searchParams.has('email'))).toBe(true);

    fireEvent.press(screen.getByRole('tab', { name: 'Products' }));
    expect(screen.getByLabelText('Search products')).toHaveProp('value', 'pepsi');
    expect(await screen.findByText('1 product')).toBeOnTheScreen();
  });

  it('shows "Admins only" if the API refuses the users list', async () => {
    adminUsers = { status: 403 };

    await openUsers();

    expect(await screen.findByText('Admins only')).toBeOnTheScreen();
  });
});

// T097: admins can change a user's role, and deactivate them so they can't sign in (see
// auth.test.tsx for what a deactivated user sees). Every change is confirmed first.
describe('managing users', () => {
  const ACTIVE_SHOPPER: AdminUserAccount = { ...USERS[1], active: true };

  beforeEach(() => signedInAs('admin'));

  async function openUsers() {
    renderRouter('src/app', { initialUrl: '/admin' });
    await screen.findByText('Diet Pepsi');
    fireEvent.press(screen.getByRole('tab', { name: 'Users' }));
    await screen.findByText(/^\d+ users?$/);
  }

  it('deactivates a user after the admin confirms', async () => {
    userList = [ACTIVE_SHOPPER];
    await openUsers();

    fireEvent.press(screen.getByRole('button', { name: 'Deactivate shopper@example.com' }));
    expect(
      screen.getByText(
        "Deactivate shopper@example.com? They'll be signed out and won't be able to sign in.",
      ),
    ).toBeOnTheScreen();
    expect(userUpdates()).toHaveLength(0);

    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Deactivate shopper@example.com' })),
    );

    expect(userUpdates()).toEqual([{ path: '/admin/users/u-2', body: { active: false } }]);
    expect(
      screen.getByLabelText('shopper@example.com, User, Deactivated, joined Oct 15, 2026'),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Reactivate shopper@example.com' }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/^Deactivate shopper/)).not.toBeOnTheScreen();
  });

  it('sends nothing when the admin cancels', async () => {
    userList = [ACTIVE_SHOPPER];
    await openUsers();

    fireEvent.press(screen.getByRole('button', { name: 'Deactivate shopper@example.com' }));
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/^Deactivate shopper/)).not.toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Deactivate shopper@example.com' }),
    ).toBeOnTheScreen();
    expect(userUpdates()).toHaveLength(0);
  });

  it('reactivates a user and makes them an admin', async () => {
    await openUsers();

    fireEvent.press(screen.getByRole('button', { name: 'Reactivate shopper@example.com' }));
    expect(
      screen.getByText("Reactivate shopper@example.com? They'll be able to sign in again."),
    ).toBeOnTheScreen();
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Reactivate shopper@example.com' })),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Change role of shopper@example.com' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Admin' }));
    expect(
      screen.getByText(
        "Make shopper@example.com an admin? They'll be able to manage products, users and reviews.",
      ),
    ).toBeOnTheScreen();
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Save role of shopper@example.com' })),
    );

    expect(userUpdates()).toEqual([
      { path: '/admin/users/u-2', body: { active: true } },
      { path: '/admin/users/u-2', body: { role: 'admin' } },
    ]);
    expect(
      screen.getByLabelText('shopper@example.com, Admin, joined Oct 15, 2026'),
    ).toBeOnTheScreen();
  });

  it('removes an admin role', async () => {
    await openUsers();

    fireEvent.press(screen.getByRole('button', { name: 'Change role of admin@example.com' }));
    fireEvent.press(screen.getByRole('radio', { name: 'User' }));
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Save role of admin@example.com' })),
    );

    expect(userUpdates()).toEqual([{ path: '/admin/users/u-1', body: { role: 'user' } }]);
    expect(screen.getByLabelText('admin@example.com, User, joined Oct 1, 2026')).toBeOnTheScreen();
  });

  it("offers no changes on the admin's own row", async () => {
    // The signed-in user is user-1 (see __mocks__/@supabase/supabase-js.ts).
    userList = [
      ...USERS,
      { ...USERS[0], id: 'user-1', email: 'me@example.com', created_at: '2026-09-01T12:00:00Z' },
    ];
    await openUsers();

    expect(
      screen.getByLabelText('me@example.com, You, Admin, joined Sep 1, 2026'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /me@example\.com$/ })).not.toBeOnTheScreen();
    // The other rows still offer their changes.
    expect(
      screen.getByRole('button', { name: 'Change role of admin@example.com' }),
    ).toBeOnTheScreen();
  });

  it('makes someone a worker at a store, which needs a store chosen first', async () => {
    userList = [ACTIVE_SHOPPER];
    await openUsers();

    fireEvent.press(screen.getByRole('button', { name: 'Change role of shopper@example.com' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Worker' }));
    expect(screen.getByText('Choose their store.')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Save role of shopper@example.com' }));
    expect(userUpdates()).toHaveLength(0);

    fireEvent.press(screen.getByRole('radio', { name: 'Quantico MCX' }));
    expect(
      screen.getByText(
        "Make shopper@example.com a worker at Quantico MCX? They'll edit its stock.",
      ),
    ).toBeOnTheScreen();
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Save role of shopper@example.com' })),
    );

    expect(userUpdates()).toEqual([
      { path: '/admin/users/u-2', body: { role: 'worker', store_id: 4 } },
    ]);
    expect(
      screen.getByLabelText('shopper@example.com, Worker at Quantico MCX, joined Oct 15, 2026'),
    ).toBeOnTheScreen();
  });

  it("shows a manager's store, and can move them to another", async () => {
    userList = [{ ...ACTIVE_SHOPPER, role: 'manager', store_id: 4 }];
    await openUsers();

    expect(
      await screen.findByLabelText(
        'shopper@example.com, Manager at Quantico MCX, joined Oct 15, 2026',
      ),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Change role of shopper@example.com' }));
    expect(screen.getByRole('radio', { name: 'Manager' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Quantico MCX' })).toBeChecked();
    fireEvent.press(screen.getByRole('radio', { name: 'Camp Lejeune MCX' }));
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Save role of shopper@example.com' })),
    );

    expect(userUpdates()).toEqual([
      { path: '/admin/users/u-2', body: { role: 'manager', store_id: 1 } },
    ]);
    expect(
      screen.getByLabelText(
        'shopper@example.com, Manager at Camp Lejeune MCX, joined Oct 15, 2026',
      ),
    ).toBeOnTheScreen();
  });

  it('says why a change failed and leaves the user as they were', async () => {
    userList = [ACTIVE_SHOPPER];
    userUpdateFails = { status: 500, code: 'internal_error', message: 'Boom' };
    await openUsers();

    fireEvent.press(screen.getByRole('button', { name: 'Deactivate shopper@example.com' }));
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Deactivate shopper@example.com' })),
    );

    expect(
      screen.getByText(
        "Couldn't update shopper@example.com. Something went wrong on our end. Please try again in a moment.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('shopper@example.com, User, joined Oct 15, 2026'),
    ).toBeOnTheScreen();
  });

  it('says when the user no longer exists', async () => {
    userList = [ACTIVE_SHOPPER];
    userUpdateFails = { status: 404, code: 'user_not_found', message: 'User not found' };
    await openUsers();

    fireEvent.press(screen.getByRole('button', { name: 'Deactivate shopper@example.com' }));
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Deactivate shopper@example.com' })),
    );

    expect(screen.getByText('shopper@example.com no longer exists.')).toBeOnTheScreen();
  });

  it('shows "Admins only" if the API refuses the change', async () => {
    userList = [ACTIVE_SHOPPER];
    userUpdateFails = { status: 403, code: 'forbidden', message: 'No' };
    await openUsers();

    fireEvent.press(screen.getByRole('button', { name: 'Deactivate shopper@example.com' }));
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Deactivate shopper@example.com' })),
    );

    expect(screen.getByText('Admins only')).toBeOnTheScreen();
  });
});

describe('activity', () => {
  beforeEach(() => signedInAs('admin'));

  async function openActivity() {
    renderRouter('src/app', { initialUrl: '/admin' });
    await screen.findByText('Diet Pepsi');
    fireEvent.press(screen.getByRole('tab', { name: 'Activity' }));
  }

  it('shows each admin change: who, what, and when, newest first', async () => {
    await openActivity();

    expect(await screen.findByText('admin@example.com edited product #2')).toBeOnTheScreen();
    expect(screen.getByText('3 changes')).toBeOnTheScreen();
    expect(screen.getByText('Price: $2.49 → $2.99')).toBeOnTheScreen();
    expect(screen.getByText('Name: Pepsi → Diet Pepsi')).toBeOnTheScreen();
    expect(screen.getByText('Size: none → 20 fl oz')).toBeOnTheScreen();
    expect(screen.getByText('and 1 more change')).toBeOnTheScreen(); // the fourth field
    expect(screen.getByText('former@example.com hid review #9')).toBeOnTheScreen();
    expect(screen.getByText('Hidden: no → yes')).toBeOnTheScreen();
    // Shown in the phone's own time zone, so only the date is the same everywhere.
    expect(screen.getByText(/^Oct 24, 2026, \d{1,2}:\d{2}/)).toBeOnTheScreen();
    expect(new URL(activityRequests()[0][0]).searchParams.get('limit')).toBe('100');
  });

  it('shows a stock change by store, and it opens the product', async () => {
    auditEntries = [
      {
        id: 4,
        admin_id: 'u-1',
        admin_email: 'admin@example.com',
        action: 'stock.set',
        target_type: 'product',
        target_id: '2',
        changes: { 'Camp Lejeune MCX in_stock': { from: true, to: false } },
        created_at: '2026-10-26T16:00:00Z',
      },
    ];
    await openActivity();

    expect(await screen.findByText('admin@example.com set stock for product #2')).toBeOnTheScreen();
    expect(screen.getByText('Camp Lejeune MCX in stock: yes → no')).toBeOnTheScreen();
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: /^admin@example.com set stock for/ })),
    );
    expect(screen).toHavePathname('/product/2');
  });

  it('shows what a delete removed', async () => {
    await openActivity();

    expect(await screen.findByText('admin@example.com deleted product #5')).toBeOnTheScreen();
    expect(screen.getByText('Name: Old Chips')).toBeOnTheScreen();
    expect(screen.getByText('Ratings: 3')).toBeOnTheScreen();
  });

  it('has no search box, and filters by what was changed', async () => {
    await openActivity();
    await screen.findByText('3 changes');
    expect(screen.queryByLabelText(/^Search/)).not.toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Show reviews changes' }));

    expect(await screen.findByText('1 change')).toBeOnTheScreen();
    expect(screen.queryByText('admin@example.com edited product #2')).not.toBeOnTheScreen();
    expect(new URL(activityRequests().at(-1)![0]).searchParams.get('target_type')).toBe('review');
    expect(screen.getByRole('button', { name: 'Show reviews changes' })).toBeSelected();
  });

  it('opens a changed product, but not one that was deleted', async () => {
    await openActivity();
    await screen.findByText('3 changes');
    expect(
      screen.queryByRole('button', { name: /^admin@example.com deleted product #5/ }),
    ).not.toBeOnTheScreen();

    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: /^admin@example.com edited product #2/ })),
    );

    expect(screen).toHavePathname('/product/2');
  });

  it('says when there are no changes yet', async () => {
    auditEntries = [];

    await openActivity();

    expect(await screen.findByText('No changes yet.')).toBeOnTheScreen();
  });

  it('shows "Admins only" if the API refuses the log', async () => {
    auditLog = { status: 403 };

    await openActivity();

    expect(await screen.findByText('Admins only')).toBeOnTheScreen();
  });
});
