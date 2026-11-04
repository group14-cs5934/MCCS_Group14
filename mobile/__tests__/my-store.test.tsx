import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import { getMe } from '@/api/me';
import type { StaffStockRow, Store } from '@/types/store';
import type { AdminUserAccount, PermissionInfo, Role, StoreRoleSummary } from '@/types/user';

// Store staff: My store shows the sections the signed-in user's store role allows (stock, staff,
// roles, store info); admins pick any store and see everything. Regular users are turned away. The
// signed-in user's role, store and store role come from GET /me (stubbed in jest.setup.ts); the
// staff API is faked below and, like the real one, checks the store and the permission.

const getMeMock = jest.mocked(getMe);

const QUANTICO = 4;
const STORES: Store[] = [
  { id: 1, name: 'Camp Lejeune MCX', slug: 'camp-lejeune-mcx', address: null, hours: null },
  {
    id: QUANTICO,
    name: 'Quantico MCX',
    slug: 'quantico-mcx',
    address: '1 Main St',
    hours: 'Mon–Sat 9 AM–9 PM',
  },
];

// The catalog the API serves. restock_orders is not one the app knows about: it must still show.
const CATALOG: PermissionInfo[] = [
  { key: 'edit_stock', label: 'Edit stock', description: 'Set stock, quantity and aisle' },
  { key: 'view_staff', label: 'See staff', description: 'See who works here' },
  { key: 'manage_staff', label: 'Manage staff', description: 'Add and remove staff' },
  { key: 'manage_roles', label: 'Manage roles', description: 'Create and change roles' },
  { key: 'edit_store_info', label: 'Edit store info', description: 'Change address and hours' },
  { key: 'restock_orders', label: 'Restock orders', description: 'Place restock orders' },
];
const ALL = CATALOG.slice(0, 5).map((item) => item.key);

const MANAGER: StoreRoleSummary = { id: 1, name: 'Manager', permissions: ALL };
const WORKER: StoreRoleSummary = { id: 2, name: 'Worker', permissions: ['edit_stock'] };
const VIEWER: StoreRoleSummary = { id: 3, name: 'Viewer', permissions: ['view_staff'] };

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

function person(id: string, email: string, storeRole: StoreRoleSummary | null): AdminUserAccount {
  return {
    id,
    email,
    role: storeRole ? 'staff' : 'user',
    store_id: storeRole ? QUANTICO : null,
    store_role: storeRole,
    active: true,
    created_at: '2026-10-01T12:00:00Z',
  };
}

const api = {
  stock: [] as StaffStockRow[],
  staff: [] as AdminUserAccount[],
  roles: [] as StoreRoleSummary[],
  stores: [] as Store[],
  /** Accounts that exist (signed up), by email, for adding staff. */
  accounts: [] as AdminUserAccount[],
  /** Who's signed in, as the API sees them. */
  me: { role: 'user' as Role, storeId: null as number | null },
  /** The permissions the API gives the signed-in staff member (GET /me may say otherwise). */
  permissions: [] as string[],
  /** Makes every staff request answer 403 not_your_store, as if the user were just removed. */
  refuse: false,
  /** Makes role creation answer 409 role_name_taken. */
  nameTaken: false,
};

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const MISSING = { code: 'missing_permission', message: 'Your role does not allow this.' };

const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const { pathname, searchParams } = new URL(url);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  if (pathname === '/locations') return jsonResponse(200, api.stores);
  if (pathname === '/staff/permissions') return jsonResponse(200, CATALOG);

  const match = pathname.match(/^\/staff\/stores\/(\d+)(\/.*)?$/);
  if (!match) return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
  const [storeId, rest] = [Number(match[1]), match[2] ?? ''];
  const isAdmin = api.me.role === 'admin';
  if (api.refuse || !(isAdmin || api.me.storeId === storeId)) {
    return jsonResponse(403, { code: 'not_your_store', message: 'Not your store' });
  }
  /** Refuses with 403 missing_permission unless the signed-in staff member has one of these. */
  const needs = (...keys: string[]) =>
    isAdmin || keys.some((key) => api.permissions.includes(key))
      ? null
      : jsonResponse(403, MISSING);

  if (rest === '/stock' && method === 'GET') {
    const refused = needs('edit_stock');
    if (refused) return refused;
    const q = (searchParams.get('q') ?? '').toLowerCase();
    return jsonResponse(
      200,
      api.stock.filter((row) => row.product.name.toLowerCase().includes(q)),
    );
  }
  const stockMatch = rest.match(/^\/stock\/(\d+)$/);
  if (stockMatch) {
    const refused = needs('edit_stock');
    if (refused) return refused;
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
    const store = api.stores.find((item) => item.id === storeId)!;
    const { in_stock, quantity, aisle, updated_at, admin_set_at } = row;
    return jsonResponse(200, { store, in_stock, quantity, aisle, updated_at, admin_set_at });
  }

  if (rest === '' && method === 'PATCH') {
    const refused = needs('edit_store_info');
    if (refused) return refused;
    api.stores = api.stores.map((item) => (item.id === storeId ? { ...item, ...body } : item));
    return jsonResponse(
      200,
      api.stores.find((item) => item.id === storeId),
    );
  }

  const memberCount = (roleId: number) =>
    api.staff.filter((item) => item.store_role?.id === roleId).length;
  if (rest === '/roles' && method === 'GET') {
    return jsonResponse(
      200,
      api.roles.map((role) => ({ ...role, store_id: storeId, member_count: memberCount(role.id) })),
    );
  }
  if (rest === '/roles' && method === 'POST') {
    const refused = needs('manage_roles');
    if (refused) return refused;
    if (api.nameTaken) {
      return jsonResponse(409, {
        code: 'role_name_taken',
        message: 'This store already has a role with that name.',
      });
    }
    const created = { id: 10, ...body };
    api.roles = [...api.roles, created];
    return jsonResponse(201, { ...created, store_id: storeId, member_count: 0 });
  }
  const roleMatch = rest.match(/^\/roles\/(\d+)$/);
  if (roleMatch) {
    const refused = needs('manage_roles');
    if (refused) return refused;
    const roleId = Number(roleMatch[1]);
    if (method === 'PATCH') {
      api.roles = api.roles.map((item) => (item.id === roleId ? { ...item, ...body } : item));
      const updated = api.roles.find((item) => item.id === roleId);
      return jsonResponse(200, {
        ...updated,
        store_id: storeId,
        member_count: memberCount(roleId),
      });
    }
    if (memberCount(roleId) > 0) {
      return jsonResponse(409, {
        code: 'role_in_use',
        message: 'People still have this role. Give them another role first.',
      });
    }
    api.roles = api.roles.filter((item) => item.id !== roleId);
    return jsonResponse(204);
  }

  if (rest.startsWith('/staff')) {
    const refused = method === 'GET' ? needs('view_staff', 'manage_staff') : needs('manage_staff');
    if (refused) return refused;
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
    const storeRole = api.roles.find((item) => item.id === body.role_id)!;
    const added = { ...found, role: 'staff' as Role, store_id: storeId, store_role: storeRole };
    api.staff = [...api.staff, added];
    return jsonResponse(201, added);
  }
  const staffMatch = rest.match(/^\/staff\/(.+)$/);
  if (staffMatch && method === 'PATCH') {
    const storeRole = api.roles.find((item) => item.id === body.role_id)!;
    api.staff = api.staff.map((item) =>
      item.id === staffMatch[1] ? { ...item, store_role: storeRole } : item,
    );
    return jsonResponse(
      200,
      api.staff.find((item) => item.id === staffMatch[1]),
    );
  }
  if (staffMatch && method === 'DELETE') {
    api.staff = api.staff.filter((item) => item.id !== staffMatch[1]);
    return jsonResponse(204);
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
});
const defaultFetch = fetchMock.getMockImplementation()!;
const originalFetch = globalThis.fetch;

/** Who's signed in: account type, store and store role, from GET /me (and as the API sees them). */
function signedInAs(
  role: Role,
  storeId: number | null = null,
  storeRole: StoreRoleSummary | null = null,
) {
  api.me = { role, storeId };
  api.permissions = storeRole?.permissions ?? [];
  getMeMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      id: 'user-1',
      email: 'me@example.com',
      role,
      store_id: storeId,
      store_role: storeRole,
    },
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
  api.roles = [MANAGER, WORKER, VIEWER];
  api.staff = [
    person('user-1', 'me@example.com', MANAGER),
    person('w-1', 'worker@example.com', WORKER),
  ];
  api.stores = STORES.map((store) => ({ ...store }));
  api.accounts = [person('u-9', 'new@example.com', null)];
  api.refuse = false;
  api.nameTaken = false;
  fetchMock.mockClear();
  fetchMock.mockImplementation(defaultFetch);
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

/** Opens My store and then one of its sections. */
async function openSection(tab: string, waitFor: string) {
  await openMyStore();
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: tab })));
  await screen.findByText(waitFor);
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

describe('staff with only edit_stock', () => {
  beforeEach(() => signedInAs('staff', QUANTICO, WORKER));

  it('open their store from Home, and see Stock but nothing else', async () => {
    renderRouter('src/app');
    const button = await screen.findByRole('button', { name: 'My store' });
    expect(screen.getByText(/· Worker$/)).toBeOnTheScreen();

    await act(async () => fireEvent.press(button));

    expect(screen).toHavePathname('/my-store');
    expect(await screen.findByText('Your role here: Worker')).toBeOnTheScreen();
    expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
    expect(screen.queryByRole('tab')).not.toBeOnTheScreen();
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

describe('sections follow the store role', () => {
  it('show only Staff, read-only, for view_staff', async () => {
    signedInAs('staff', QUANTICO, VIEWER);
    await openMyStore();

    expect(await screen.findByText('worker@example.com')).toBeOnTheScreen();
    expect(screen.queryByRole('tab')).not.toBeOnTheScreen(); // only one section
    expect(screen.queryByText('Sample Chips')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('worker@example.com, Worker')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Their email')).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Remove worker@example.com' }),
    ).not.toBeOnTheScreen();
  });

  it('let manage_staff see staff without view_staff', async () => {
    signedInAs('staff', QUANTICO, { id: 5, name: 'HR', permissions: ['manage_staff'] });
    await openMyStore();

    expect(await screen.findByText('worker@example.com')).toBeOnTheScreen();
    expect(screen.getByLabelText('Their email')).toBeOnTheScreen();
  });

  it('show every section for a role with every permission', async () => {
    signedInAs('staff', QUANTICO, MANAGER);
    await openMyStore();

    for (const tab of ['Stock', 'Staff', 'Roles', 'Store info']) {
      expect(screen.getByRole('tab', { name: tab })).toBeOnTheScreen();
    }
  });

  it('tell a role with no permissions that it allows nothing yet', async () => {
    signedInAs('staff', QUANTICO, { id: 6, name: 'Intern', permissions: [] });
    await openMyStore();

    expect(screen.getByText(/allow anything here yet/)).toBeOnTheScreen();
    expect(screen.queryByRole('tab')).not.toBeOnTheScreen();
  });

  it('lose a section the API refuses once their role changed since signing in', async () => {
    signedInAs('staff', QUANTICO, MANAGER);
    await openMyStore();
    const calls = getMeMock.mock.calls.length;
    api.permissions = ['edit_stock', 'manage_roles', 'edit_store_info']; // staff access taken away

    await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Staff' })));

    expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: 'Staff' })).not.toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Roles' })).toBeOnTheScreen();
    expect(screen.queryByText('Store staff only')).not.toBeOnTheScreen();
    expect(getMeMock.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe('staff with manage_staff', () => {
  beforeEach(() => signedInAs('staff', QUANTICO, MANAGER));

  const openStaff = () => openSection('Staff', 'worker@example.com');
  const newRoleChoices = () => screen.getByLabelText('New role for worker@example.com');

  it("list their store's staff with role names, and can't change themselves", async () => {
    await openStaff();

    expect(screen.getByLabelText('me@example.com, you, Manager')).toBeOnTheScreen();
    expect(screen.getByLabelText('worker@example.com, Worker')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Remove me@example.com' })).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Change role of me@example.com' }),
    ).not.toBeOnTheScreen();
  });

  it('add someone by the email they signed up with and a role', async () => {
    await openStaff();

    fireEvent.changeText(screen.getByLabelText('Their email'), ' new@example.com ');
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Add staff member' })),
    );
    expect(screen.getByText('Choose their role.')).toBeOnTheScreen();
    expect(changes()).toHaveLength(0);

    fireEvent.press(screen.getByRole('radio', { name: 'Worker' }));
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Add staff member' })),
    );

    expect(changes()).toEqual([
      {
        method: 'POST',
        path: `/staff/stores/${QUANTICO}/staff`,
        body: { email: 'new@example.com', role_id: WORKER.id },
      },
    ]);
    expect(screen.getByText('new@example.com was added as Worker.')).toBeOnTheScreen();
    expect(await screen.findByLabelText('new@example.com, Worker')).toBeOnTheScreen();
  });

  it("are told when someone hasn't signed up yet", async () => {
    await openStaff();

    fireEvent.changeText(screen.getByLabelText('Their email'), 'nobody@example.com');
    fireEvent.press(screen.getByRole('radio', { name: 'Worker' }));
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Add staff member' })),
    );

    expect(
      screen.getByText('No account with this email. They need to sign up in the app first.'),
    ).toBeOnTheScreen();
  });

  it("change a person's role", async () => {
    await openStaff();

    fireEvent.press(screen.getByRole('button', { name: 'Change role of worker@example.com' }));
    fireEvent.press(within(newRoleChoices()).getByRole('radio', { name: 'Viewer' }));
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Save role of worker@example.com' })),
    );

    expect(changes()).toEqual([
      {
        method: 'PATCH',
        path: `/staff/stores/${QUANTICO}/staff/w-1`,
        body: { role_id: VIEWER.id },
      },
    ]);
    expect(await screen.findByLabelText('worker@example.com, Viewer')).toBeOnTheScreen();
  });

  it('say why a role change was refused', async () => {
    await openStaff();
    fetchMock.mockImplementation(async (url, init) =>
      init?.method === 'PATCH'
        ? jsonResponse(403, {
            code: 'beyond_your_permissions',
            message: 'You can only give permissions you have yourself.',
          })
        : defaultFetch(url, init),
    );

    fireEvent.press(screen.getByRole('button', { name: 'Change role of worker@example.com' }));
    fireEvent.press(within(newRoleChoices()).getByRole('radio', { name: 'Viewer' }));
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Save role of worker@example.com' })),
    );

    expect(screen.getByText('You can only give permissions you have yourself.')).toBeOnTheScreen();
    // Not treated as losing access.
    expect(screen.getByLabelText('worker@example.com, Worker')).toBeOnTheScreen();
  });

  it('remove someone after confirming', async () => {
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

describe('staff with manage_roles', () => {
  beforeEach(() => signedInAs('staff', QUANTICO, MANAGER));

  const openRoles = () => openSection('Roles', 'Viewer');

  it('list roles with how many people have each and what they allow', async () => {
    await openRoles();

    expect(screen.getByLabelText('Manager, 1 person')).toBeOnTheScreen();
    expect(screen.getByLabelText('Worker, 1 person')).toBeOnTheScreen();
    expect(screen.getByLabelText('Viewer, 0 people')).toBeOnTheScreen();
    expect(screen.getByText('See staff')).toBeOnTheScreen(); // the Viewer role's permission
  });

  it('create a role from the permissions the API lists', async () => {
    await openRoles();

    fireEvent.press(screen.getByRole('button', { name: 'New role' }));
    // Every permission in the catalog is offered, including ones the app doesn't know.
    for (const permission of CATALOG) {
      expect(screen.getByRole('checkbox', { name: permission.label })).toBeOnTheScreen();
    }
    expect(screen.getByText('Place restock orders')).toBeOnTheScreen();

    fireEvent.changeText(screen.getByLabelText('Role name'), ' Stocker ');
    fireEvent.press(screen.getByRole('checkbox', { name: 'Edit stock' }));
    fireEvent.press(screen.getByRole('checkbox', { name: 'Restock orders' }));
    expect(screen.getByRole('checkbox', { name: 'Edit stock' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Manage roles' })).not.toBeChecked();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save new role' })));

    expect(changes()).toEqual([
      {
        method: 'POST',
        path: `/staff/stores/${QUANTICO}/roles`,
        body: { name: 'Stocker', permissions: ['edit_stock', 'restock_orders'] },
      },
    ]);
    expect(await screen.findByLabelText('Stocker, 0 people')).toBeOnTheScreen();
  });

  it('are told when the role name is taken', async () => {
    api.nameTaken = true;
    await openRoles();

    fireEvent.press(screen.getByRole('button', { name: 'New role' }));
    fireEvent.changeText(screen.getByLabelText('Role name'), 'Worker');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save new role' })));

    expect(screen.getByText('This store already has a role with that name.')).toBeOnTheScreen();
  });

  it('need a name', async () => {
    await openRoles();

    fireEvent.press(screen.getByRole('button', { name: 'New role' }));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save new role' })));

    expect(screen.getByText('Enter a name for the role.')).toBeOnTheScreen();
    expect(changes()).toHaveLength(0);
  });

  it('edit a role: its checklist starts as the role is', async () => {
    await openRoles();

    fireEvent.press(screen.getByRole('button', { name: 'Edit Worker' }));
    expect(screen.getByLabelText('Role name').props.value).toBe('Worker');
    expect(screen.getByRole('checkbox', { name: 'Edit stock' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'See staff' })).not.toBeChecked();

    fireEvent.changeText(screen.getByLabelText('Role name'), 'Cashier');
    fireEvent.press(screen.getByRole('checkbox', { name: 'See staff' }));
    fireEvent.press(screen.getByRole('checkbox', { name: 'Edit stock' }));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save Worker' })));

    expect(changes()).toEqual([
      {
        method: 'PATCH',
        path: `/staff/stores/${QUANTICO}/roles/${WORKER.id}`,
        body: { name: 'Cashier', permissions: ['view_staff'] },
      },
    ]);
    expect(await screen.findByLabelText('Cashier, 1 person')).toBeOnTheScreen();
  });

  it('delete a role nobody has, after confirming', async () => {
    await openRoles();

    fireEvent.press(screen.getByRole('button', { name: 'Delete Viewer' }));
    expect(screen.getByText('Delete the Viewer role?')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Delete Viewer' })));

    expect(changes()).toEqual([
      { method: 'DELETE', path: `/staff/stores/${QUANTICO}/roles/${VIEWER.id}` },
    ]);
    expect(screen.queryByLabelText('Viewer, 0 people')).not.toBeOnTheScreen();
  });

  it('see the API message when a role is still in use', async () => {
    await openRoles();

    fireEvent.press(screen.getByRole('button', { name: 'Delete Worker' }));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Delete Worker' })));

    expect(
      screen.getByText('People still have this role. Give them another role first.'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Worker, 1 person')).toBeOnTheScreen();
  });
});

describe('staff with edit_store_info', () => {
  beforeEach(() => signedInAs('staff', QUANTICO, MANAGER));

  it("change the store's address and hours", async () => {
    await openSection('Store info', 'Save store info');

    expect(screen.getByLabelText('Address').props.value).toBe('1 Main St');
    fireEvent.changeText(screen.getByLabelText('Address'), ' 2 Elm St ');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save store info' })));

    expect(changes()).toEqual([
      { method: 'PATCH', path: `/staff/stores/${QUANTICO}`, body: { address: '2 Elm St' } },
    ]);
    expect(screen.getByText('Store info saved.')).toBeOnTheScreen();
  });
});

describe('admins', () => {
  beforeEach(() => signedInAs('admin'));

  it('choose a store, then manage everything there', async () => {
    api.staff = [
      person('m-1', 'manager@example.com', MANAGER),
      person('w-1', 'worker@example.com', WORKER),
    ];
    renderRouter('src/app', { initialUrl: '/my-store' });

    const quantico = await screen.findByRole('button', { name: 'Manage Quantico MCX' });
    await act(async () => fireEvent.press(quantico));

    expect(await screen.findByText('Managing as an admin')).toBeOnTheScreen();
    expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
    for (const tab of ['Stock', 'Staff', 'Roles', 'Store info']) {
      expect(screen.getByRole('tab', { name: tab })).toBeOnTheScreen();
    }
    fireEvent.press(screen.getByRole('tab', { name: 'Staff' }));
    expect(await screen.findByText('worker@example.com')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Remove manager@example.com' })).toBeOnTheScreen();
  });
});
