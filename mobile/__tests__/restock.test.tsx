import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { getMe } from '@/api/me';
import type { Product } from '@/types/product';
import type { RestockItem, RestockRequest } from '@/types/restock';
import type { Role, StoreRoleSummary } from '@/types/user';

// Restock alerts: product pages and scans are counted per store (fire and forget); store staff
// whose role allows it see a badge with the low and out counts, the Restock list with statistics,
// and (with request_restock) can request and cancel reorders and change reorder points. The API is
// faked below to the contract; the signed-in user comes from GET /me (stubbed in jest.setup.ts).

const getMeMock = jest.mocked(getMe);

const QUANTICO = 4;
const STORES = [
  { id: QUANTICO, name: 'Quantico MCX', slug: 'quantico-mcx', address: null, hours: null },
];

const VIEWER: StoreRoleSummary = { id: 1, name: 'Looker', permissions: ['view_restock'] };
const BUYER: StoreRoleSummary = { id: 2, name: 'Buyer', permissions: ['request_restock'] };
const WORKER: StoreRoleSummary = { id: 3, name: 'Worker', permissions: ['edit_stock'] };

const PRODUCT: Product = {
  id: 2,
  barcode: '012000171741',
  name: 'Diet Pepsi',
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
  created_at: '2026-10-16T12:00:00Z',
  updated_at: '2026-10-16T12:00:00Z',
};

function request(id: number, productId: number, name: string, extra: Partial<RestockRequest> = {}) {
  return {
    id,
    product: { id: productId, barcode: `0360${productId}`, name, size: null, image_url: null },
    quantity: 12,
    note: null,
    status: 'open',
    requested_at: '2026-10-26T12:00:00Z',
    requested_by: 'boss@example.com',
    closed_at: null,
    ...extra,
  } as RestockRequest;
}

const CHIPS: RestockItem = {
  product: { id: 1, barcode: '036000291452', name: 'Sample Chips', size: '12 oz', image_url: null },
  status: 'out',
  quantity: 0,
  aisle: 'Aisle 3',
  reorder_point: 5,
  reorder_point_is_default: true,
  stats: {
    views_30d: 120,
    scans_30d: 45,
    interest_change: 18.4,
    popular: true,
    stockouts_30d: 3,
    stockouts_90d: 5,
    days_out_30d: 6.5,
    sold_per_day: 2.5,
    days_left: null,
  },
  last_request: request(7, 1, 'Sample Chips', { quantity: 18, status: 'restocked' }),
  suggested_quantity: 24,
  advice: 'Popular and ran out 3 times in 30 days: order more than last time (24).',
};
const SODA: RestockItem = {
  product: { id: 3, barcode: '012000001291', name: 'Cola', size: null, image_url: null },
  status: 'low',
  quantity: 3,
  aisle: null,
  reorder_point: 8,
  reorder_point_is_default: false,
  stats: {
    views_30d: 4,
    scans_30d: 1,
    interest_change: null,
    popular: false,
    stockouts_30d: 0,
    stockouts_90d: 0,
    days_out_30d: 0,
    sold_per_day: 1,
    days_left: 3,
  },
  last_request: request(8, 3, 'Cola', { quantity: 12 }),
  suggested_quantity: null,
  advice: null,
};

const api = {
  items: [] as RestockItem[],
  requests: [] as RestockRequest[],
  me: { role: 'user' as Role, storeId: null as number | null },
  permissions: [] as string[],
  defaultPoint: 5,
  /** Makes the next request for a reorder answer 409 restock_already_requested. */
  alreadyRequested: false,
  /** Makes the activity counter answer 500. */
  activityBroken: false,
};

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const summary = () => ({
  out: api.items.filter((item) => item.status === 'out').length,
  low: api.items.filter((item) => item.status === 'low').length,
  open_requests: api.requests.filter((item) => item.status === 'open').length,
  default_reorder_point: api.defaultPoint,
});

const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const { pathname, searchParams } = new URL(url);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(init.body as string) : undefined;

  if (pathname === '/locations') return jsonResponse(200, STORES);
  if (pathname === '/staff/permissions') return jsonResponse(200, []);
  if (/^\/products\/\d+\/ratings$/.test(pathname)) {
    return jsonResponse(200, { product_id: 2, average: null, count: 0 });
  }
  if (/^\/products\/\d+\/activity$/.test(pathname)) {
    return api.activityBroken
      ? jsonResponse(500, { code: 'oops', message: 'Broken' })
      : jsonResponse(204);
  }
  if (pathname === '/products/2' || pathname === `/products/barcode/${PRODUCT.barcode}`) {
    return jsonResponse(200, PRODUCT);
  }

  const match = pathname.match(/^\/staff\/stores\/(\d+)\/restock(\/.*)?$/);
  if (!match) return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
  const rest = match[2] ?? '';
  const allowed = (...keys: string[]) => keys.some((key) => api.permissions.includes(key));
  const isRead = method === 'GET';
  if (isRead ? !allowed('view_restock', 'request_restock') : !allowed('request_restock')) {
    return jsonResponse(403, {
      code: 'missing_permission',
      message: 'Your role does not allow this.',
    });
  }

  if (rest === '/summary') return jsonResponse(200, summary());
  if (rest === '' && isRead) {
    const status = searchParams.get('status');
    return jsonResponse(
      200,
      api.items.filter((item) => status === 'all' || item.status === status),
    );
  }
  if (rest === '/requests' && isRead) {
    const open = searchParams.get('status') === 'open';
    return jsonResponse(
      200,
      api.requests.filter((item) => !open || item.status === 'open'),
    );
  }
  if (rest === '/settings' && method === 'PUT') {
    api.defaultPoint = body.default_reorder_point;
    return jsonResponse(200, summary());
  }
  const productId = Number(rest.match(/^\/(\d+)\//)?.[1]);
  if (rest.endsWith('/requests') && method === 'POST') {
    if (api.alreadyRequested) {
      return jsonResponse(409, {
        code: 'restock_already_requested',
        message: 'A reorder is already requested for this product.',
      });
    }
    const item = api.items.find((row) => row.product.id === productId)!;
    const created = request(20, productId, item.product.name, body);
    api.requests.push(created);
    return jsonResponse(201, created);
  }
  if (rest.endsWith('/requests/open') && method === 'DELETE') return jsonResponse(204);
  if (rest.endsWith('/reorder-point') && method === 'PUT') {
    return jsonResponse(200, {
      reorder_point: body.reorder_point ?? api.defaultPoint,
      reorder_point_is_default: body.reorder_point === null,
    });
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
});
const originalFetch = globalThis.fetch;

function signedInAs(role: Role, storeId: number | null = null, storeRole?: StoreRoleSummary) {
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
      store_role: storeRole ?? null,
    },
  });
}

/** Each request sent to a path matching `pattern`: method, path and body. */
const sent = (pattern: RegExp) =>
  fetchMock.mock.calls
    .filter(([url]) => pattern.test(new URL(url).pathname))
    .map(([url, init]) => ({
      method: init?.method ?? 'GET',
      path: new URL(url).pathname,
      ...(init?.body ? { body: JSON.parse(init.body as string) } : {}),
    }));
const activity = () => sent(/\/activity$/).map(({ path, body }) => ({ path, ...body }));

beforeEach(async () => {
  api.items = [{ ...CHIPS }, { ...SODA }];
  api.requests = [
    request(8, 3, 'Cola', { quantity: 12 }),
    request(7, 1, 'Sample Chips', {
      quantity: 18,
      status: 'restocked',
      closed_at: '2026-10-27T12:00:00Z',
    }),
  ];
  api.defaultPoint = 5;
  api.alreadyRequested = false;
  api.activityBroken = false;
  await AsyncStorage.clear();
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

describe('counting product views and scans', () => {
  beforeEach(() => signedInAs('user'));

  it('counts one view for the chosen store when a product page opens', async () => {
    await AsyncStorage.setItem(
      'preferred-store:user-1',
      JSON.stringify({ id: QUANTICO, name: 'Quantico MCX' }),
    );
    renderRouter('src/app', { initialUrl: '/product/2' });
    expect(await screen.findByText('Diet Pepsi')).toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(1000));

    expect(activity()).toEqual([
      { path: '/products/2/activity', kind: 'view', store_id: QUANTICO },
    ]);
  });

  it('leaves the store out when none is chosen', async () => {
    renderRouter('src/app', { initialUrl: '/product/2' });
    expect(await screen.findByText('Diet Pepsi')).toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(1000));

    expect(activity()).toEqual([{ path: '/products/2/activity', kind: 'view' }]);
  });

  it('counts a scan, and only the scan, when a barcode opens the product', async () => {
    renderRouter('src/app', { initialUrl: `/product/barcode/${PRODUCT.barcode}` });
    expect(await screen.findByText('Diet Pepsi')).toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(1000));

    expect(activity()).toEqual([{ path: '/products/2/activity', kind: 'scan' }]);
  });

  it('counts once even when switching tabs re-renders the page', async () => {
    renderRouter('src/app', { initialUrl: '/product/2' });
    await screen.findByText('Diet Pepsi');
    await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Reviews' })));
    await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Stores' })));

    expect(activity()).toHaveLength(1);
  });

  it('shows nothing when counting fails', async () => {
    api.activityBroken = true;
    renderRouter('src/app', { initialUrl: '/product/2' });

    expect(await screen.findByText('Diet Pepsi')).toBeOnTheScreen();
    expect(screen.queryByText('Broken')).not.toBeOnTheScreen();
    expect(screen.queryByText(/went wrong/)).not.toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(30000));
    expect(activity()).toHaveLength(1); // never retried
  });
});

describe('the restock badge', () => {
  it('counts out plus low on My store, for a role that can view restock', async () => {
    signedInAs('staff', QUANTICO, VIEWER);
    renderRouter('src/app');

    fireEvent.press(await screen.findByRole('button', { name: 'Account' }));
    const button = await screen.findByRole('button', { name: 'My store' });
    expect(await screen.findByText('2')).toBeOnTheScreen();

    await act(async () => fireEvent.press(button));
    // The only section, so there are no tabs; the list itself is shown.
    expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
  });

  it('shows on the Restock tab too, and request_restock implies viewing', async () => {
    signedInAs('staff', QUANTICO, {
      id: 4,
      name: 'Both',
      permissions: ['edit_stock', 'request_restock'],
    });
    renderRouter('src/app', { initialUrl: '/my-store' });

    const tab = await screen.findByRole('tab', { name: 'Restock' });
    expect(await screen.findByText('2')).toBeOnTheScreen();
    await act(async () => fireEvent.press(tab));
    expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
  });

  it('is not shown, or asked for, without the permission', async () => {
    signedInAs('staff', QUANTICO, WORKER);
    renderRouter('src/app');

    fireEvent.press(await screen.findByRole('button', { name: 'Account' }));
    await screen.findByRole('button', { name: 'My store' });
    await act(async () => jest.advanceTimersByTime(1000));
    expect(screen.queryByText('2')).not.toBeOnTheScreen();
    expect(sent(/\/restock/)).toHaveLength(0);
  });

  it('is not shown when nothing needs restocking', async () => {
    api.items = [];
    signedInAs('staff', QUANTICO, VIEWER);
    renderRouter('src/app');

    fireEvent.press(await screen.findByRole('button', { name: 'Account' }));
    await screen.findByRole('button', { name: 'My store' });
    await act(async () => jest.advanceTimersByTime(1000));
    expect(sent(/\/restock\/summary$/)).toHaveLength(1);
    expect(screen.queryByText('0')).not.toBeOnTheScreen();
  });
});

describe('the My store header', () => {
  it('shows the store, the role and out, low and open reorder tiles', async () => {
    signedInAs('staff', QUANTICO, VIEWER);
    renderRouter('src/app', { initialUrl: '/my-store' });

    expect(await screen.findByText('Quantico MCX')).toBeOnTheScreen();
    expect(screen.getByText('Store tools · Looker')).toBeOnTheScreen();
    expect(await screen.findByText('Running low')).toBeOnTheScreen();
    expect(screen.getByText('Reorders open')).toBeOnTheScreen();
    expect(screen.getAllByText('Out of stock').length).toBeGreaterThan(0);
  });

  it('has no tiles, and asks for no summary, for a role without view_restock', async () => {
    signedInAs('staff', QUANTICO, WORKER);
    renderRouter('src/app', { initialUrl: '/my-store' });

    expect(await screen.findByText('Store tools · Worker')).toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(screen.queryByText('Running low')).not.toBeOnTheScreen();
    expect(screen.queryByText('Reorders open')).not.toBeOnTheScreen();
    expect(sent(/\/restock/)).toHaveLength(0);
  });
});

describe('the Restock section', () => {
  const open = async () => {
    renderRouter('src/app', { initialUrl: '/my-store' });
    await screen.findByText('Sample Chips');
  };

  it('is hidden for a role without view_restock', async () => {
    signedInAs('staff', QUANTICO, WORKER);
    renderRouter('src/app', { initialUrl: '/my-store' });

    expect(await screen.findByText('Store tools · Worker')).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: 'Restock' })).not.toBeOnTheScreen();
    expect(sent(/\/restock/)).toHaveLength(0);
  });

  it('lists each product with its status, numbers, statistics and advice', async () => {
    signedInAs('staff', QUANTICO, VIEWER);
    await open();

    expect(screen.getByText('12 oz')).toBeOnTheScreen();
    // Status pills (the header tile has the same words as the Out of stock pill).
    expect(screen.getAllByText('Out of stock')).toHaveLength(2);
    expect(screen.getByText('Low · 3 left')).toBeOnTheScreen();
    expect(screen.getByText('Popular')).toBeOnTheScreen();
    expect(
      screen.getByText('Quantity 0 · Reorder at 5 (store default) · Aisle 3'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Quantity 3 · Reorder at 8')).toBeOnTheScreen();
    expect(screen.getByText('120')).toBeOnTheScreen();
    expect(screen.getByText('3×')).toBeOnTheScreen();
    expect(screen.getByText('~2.5 / day')).toBeOnTheScreen();
    expect(screen.getByText('Interest +18% vs the 30 days before')).toBeOnTheScreen();
    expect(screen.getByText('About 3 days left')).toBeOnTheScreen();
    expect(screen.getByText(CHIPS.advice!)).toBeOnTheScreen();
    expect(screen.getByText(/Last request of 18 was restocked/)).toBeOnTheScreen();
    expect(screen.getByText(/^Requested 12 on /)).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'All 2' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Out 1' })).toBeOnTheScreen();
    expect(screen.getByText('Out 1')).toBeOnTheScreen();
    expect(screen.getByText('Low 1')).toBeOnTheScreen();
    // Read-only: nothing to change.
    expect(screen.queryByRole('button', { name: /Request reorder/ })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Cancel the reorder/ })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /reorder point/i })).not.toBeOnTheScreen();
  });

  it('filters to out or low products', async () => {
    signedInAs('staff', QUANTICO, VIEWER);
    await open();

    await act(async () => fireEvent.press(screen.getByRole('radio', { name: 'Low 1' })));

    expect(await screen.findByText('Cola')).toBeOnTheScreen();
    expect(screen.queryByText('Sample Chips')).not.toBeOnTheScreen();
    const last = fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter((url) => url.pathname.endsWith('/restock'))
      .at(-1)!;
    expect(last.searchParams.get('status')).toBe('low');
    expect(last.searchParams.get('limit')).toBe('50');
  });

  it('lists open requests, and all of them on request', async () => {
    signedInAs('staff', QUANTICO, VIEWER);
    await open();

    await act(async () => fireEvent.press(screen.getByRole('radio', { name: 'Requests' })));
    expect(await screen.findByText(/^12 requested on /)).toBeOnTheScreen();
    expect(screen.getByText('By boss@example.com')).toBeOnTheScreen();
    expect(screen.queryByText(/^18 requested on /)).not.toBeOnTheScreen();

    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Show all requests' })),
    );
    expect(await screen.findByText(/^18 requested on .* · Restocked /)).toBeOnTheScreen();
  });

  describe('with request_restock', () => {
    beforeEach(() => signedInAs('staff', QUANTICO, BUYER));

    it('requests a reorder with the suggested quantity and a note', async () => {
      await open();

      expect(screen.getByLabelText('Quantity to order of Sample Chips').props.value).toBe('24');
      fireEvent.press(
        screen.getByRole('button', { name: 'Add a note to the reorder of Sample Chips' }),
      );
      fireEvent.changeText(
        screen.getByLabelText('Note for Sample Chips (optional)'),
        ' Before Friday ',
      );
      await act(async () =>
        fireEvent.press(screen.getByRole('button', { name: 'Request reorder of Sample Chips' })),
      );

      expect(sent(/\/requests$/).filter((call) => call.method === 'POST')).toEqual([
        {
          method: 'POST',
          path: `/staff/stores/${QUANTICO}/restock/1/requests`,
          body: { quantity: 24, note: 'Before Friday' },
        },
      ]);
      expect(await screen.findByText(/^Requested 24 on .* · Before Friday$/)).toBeOnTheScreen();
      expect(
        screen.getByRole('button', { name: 'Cancel the reorder request for Sample Chips' }),
      ).toBeOnTheScreen();
    });

    it('updates the Reorders open tile after a reorder request', async () => {
      await open();
      // The number in the same tile as the "Reorders open" label.
      const openCount = () => {
        let node = screen.getByText('Reorders open').parent!;
        while (within(node).queryAllByText(/^\d+$/).length === 0) node = node.parent!;
        return within(node).getByText(/^\d+$/).props.children;
      };
      expect(openCount()).toBe(1);

      await act(async () =>
        fireEvent.press(screen.getByRole('button', { name: 'Request reorder of Sample Chips' })),
      );
      await screen.findByText(/^Requested 24 on /);
      await waitFor(() => expect(openCount()).toBe(2));
      expect(sent(/\/restock\/summary$/)).toHaveLength(2);
    });

    it('needs a whole quantity', async () => {
      await open();

      fireEvent.changeText(screen.getByLabelText('Quantity to order of Sample Chips'), '0');
      await act(async () =>
        fireEvent.press(screen.getByRole('button', { name: 'Request reorder of Sample Chips' })),
      );

      expect(screen.getByText('Enter a whole number from 1 to 10000.')).toBeOnTheScreen();
      expect(sent(/\/requests$/).filter((call) => call.method === 'POST')).toHaveLength(0);
    });

    it('shows the API message when a reorder is already requested', async () => {
      api.alreadyRequested = true;
      await open();

      await act(async () =>
        fireEvent.press(screen.getByRole('button', { name: 'Request reorder of Sample Chips' })),
      );

      expect(
        screen.getByText('A reorder is already requested for this product.'),
      ).toBeOnTheScreen();
    });

    it('cancels an open request', async () => {
      await open();

      expect(screen.getByText(/^Requested 12 on /)).toBeOnTheScreen();
      await act(async () =>
        fireEvent.press(
          screen.getByRole('button', { name: 'Cancel the reorder request for Cola' }),
        ),
      );

      expect(sent(/\/requests\/open$/)).toEqual([
        { method: 'DELETE', path: `/staff/stores/${QUANTICO}/restock/3/requests/open` },
      ]);
      expect(screen.queryByText(/^Requested 12 on /)).not.toBeOnTheScreen();
      expect(screen.getByText(/Last request of 12 was cancelled/)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Request reorder of Cola' })).toBeOnTheScreen();
    });

    it("changes a product's reorder point, or hands it back to the store default", async () => {
      await open();

      fireEvent.press(screen.getByRole('button', { name: 'Change the reorder point of Cola' }));
      fireEvent.changeText(screen.getByLabelText('Reorder point of Cola'), '10');
      await act(async () =>
        fireEvent.press(screen.getByRole('button', { name: 'Save the reorder point of Cola' })),
      );
      expect(screen.getByText('Quantity 3 · Reorder at 10')).toBeOnTheScreen();

      fireEvent.press(screen.getByRole('button', { name: 'Change the reorder point of Cola' }));
      await act(async () =>
        fireEvent.press(
          screen.getByRole('button', { name: 'Use the store default reorder point for Cola' }),
        ),
      );

      expect(sent(/\/reorder-point$/).map(({ body }) => body)).toEqual([
        { reorder_point: 10 },
        { reorder_point: null },
      ]);
      expect(screen.getByText('Quantity 3 · Reorder at 5 (store default)')).toBeOnTheScreen();
    });

    it("changes the store's default reorder point", async () => {
      await open();

      fireEvent.press(screen.getByRole('button', { name: 'Change the default reorder point' }));
      expect(screen.getByLabelText('Default reorder point').props.value).toBe('5');
      fireEvent.changeText(screen.getByLabelText('Default reorder point'), '9');
      await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Save default' })));

      expect(sent(/\/settings$/)).toEqual([
        {
          method: 'PUT',
          path: `/staff/stores/${QUANTICO}/restock/settings`,
          body: { default_reorder_point: 9 },
        },
      ]);
      expect(await screen.findByText(/The store default is 9\./)).toBeOnTheScreen();
    });
  });
});
