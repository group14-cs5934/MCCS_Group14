import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { getMe } from '@/api/me';
import { SEARCH_DEBOUNCE_MS } from '@/hooks/useProductSearch';
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

const fetchMock = jest.fn(async (url: string) => {
  const { pathname, searchParams } = new URL(url);
  if (pathname === '/admin/products') {
    if (adminProducts)
      return jsonResponse(adminProducts.status, { code: 'forbidden', message: 'No' });
    const q = (searchParams.get('q') ?? '').toLowerCase();
    return jsonResponse(
      200,
      CATALOG.filter((item) => item.name.toLowerCase().includes(q)),
    );
  }
  if (pathname === '/admin/users') {
    if (adminUsers) return jsonResponse(adminUsers.status, { code: 'forbidden', message: 'No' });
    const email = (searchParams.get('email') ?? '').toLowerCase();
    return jsonResponse(
      200,
      USERS.filter((user) => user.email!.includes(email)),
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
const userRequests = () =>
  fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/admin/users');

beforeEach(() => {
  adminProducts = null;
  adminUsers = null;
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

  it('open a product page by tapping a product', async () => {
    renderRouter('src/app', { initialUrl: '/admin' });

    const row = await screen.findByText('Diet Pepsi');
    // The product page starts loading as it opens; let that finish inside act.
    await act(async () => fireEvent.press(row));

    expect(screen).toHavePathname('/product/2');
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
