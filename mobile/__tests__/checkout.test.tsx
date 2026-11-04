import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import type { Order, ProductCard } from '@/types/cart';
import type { Store } from '@/types/store';

// Demo checkout and orders: each cart item is checked against the chosen store (available, only N
// left, or not there) with a fix for each problem; the check runs again when the store changes;
// delivery needs an address; placing an order shows its confirmation; and Your orders lists them.
// The API is faked below to the contract.

const CHIPS: ProductCard = {
  id: 1,
  barcode: '036000291452',
  name: 'Sample Chips',
  size: '12 oz',
  image_url: null,
  price: '3.50',
};
const COLA: ProductCard = {
  id: 2,
  barcode: '012000171741',
  name: 'Diet Cola',
  size: null,
  image_url: null,
  price: '1.25',
};
const RICE: ProductCard = {
  id: 3,
  barcode: '000000000003',
  name: 'Plain Rice',
  size: '1 lb',
  image_url: null,
  price: '2.00',
};
const CATALOG = [CHIPS, COLA, RICE];

const store = (id: number, name: string): Store => ({
  id,
  name,
  slug: name.toLowerCase().replace(/ /g, '-'),
  address: null,
  hours: null,
});
const LEJEUNE = store(1, 'Camp Lejeune MCX');
const QUANTICO = store(2, 'Quantico MCX');
const PENDLETON = store(3, 'Camp Pendleton MCX');
const STORES = [LEJEUNE, QUANTICO, PENDLETON];

/** How many of each product (by ID) a store has; a missing product isn't carried there. */
type Stock = Record<number, Record<number, number>>;

const fake = {
  cart: [] as { id: number; quantity: number }[],
  stock: {} as Stock,
  orders: [] as Order[],
  /** The next POST /me/orders fails with this 409 code, once (and the stock then changes). */
  failOrderOnce: null as null | 'items_unavailable',
  /** Stock to switch to when the order fails. */
  stockAfterFailure: null as Stock | null,
  /** Checking against this store fails with a server error. */
  failCheckFor: null as number | null,
};

const product = (id: number) => CATALOG.find((p) => p.id === id)!;

function cartBody() {
  const items = fake.cart.map(({ id, quantity }) => ({
    product: product(id),
    quantity,
    line_total: (Number(product(id).price) * quantity).toFixed(2),
  }));
  return {
    items,
    item_count: fake.cart.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: items.length
      ? items.reduce((sum, i) => sum + Number(i.line_total), 0).toFixed(2)
      : null,
    unpriced_items: 0,
  };
}

function checkBody(storeId: number) {
  const has = (id: number, quantity: number, at: number) => (fake.stock[at]?.[id] ?? 0) >= quantity;
  const items = fake.cart.map(({ id, quantity }) => {
    const onHand = fake.stock[storeId]?.[id] ?? 0;
    return {
      product: product(id),
      quantity,
      status: onHand >= quantity ? 'available' : onHand > 0 ? 'limited' : 'unavailable',
      available_quantity: onHand > 0 ? onHand : null,
    };
  });
  const stores = STORES.map((row) => ({
    store: row,
    available_items: fake.cart.filter(({ id, quantity }) => has(id, quantity, row.id)).length,
    total_items: fake.cart.length,
  })).sort(
    (a, b) => b.available_items - a.available_items || a.store.name.localeCompare(b.store.name),
  );
  return {
    store: STORES.find((row) => row.id === storeId),
    all_available: items.every((item) => item.status === 'available'),
    items,
    stores,
  };
}

function placeBody(body: {
  store_id: number;
  fulfillment: 'pickup' | 'delivery';
  delivery_address?: string;
  contact_name?: string;
}): Order {
  const cart = cartBody();
  const placed: Order = {
    id: 40 + fake.orders.length,
    number: `R-${1000 + fake.orders.length}`,
    store: { id: body.store_id, name: STORES.find((row) => row.id === body.store_id)!.name },
    fulfillment: body.fulfillment,
    delivery_address: body.delivery_address ?? null,
    contact_name: body.contact_name ?? null,
    status: 'placed',
    placed_at: '2026-11-04T15:00:00Z',
    items: cart.items.map((item) => ({
      product_id: item.product.id,
      name: item.product.name,
      quantity: item.quantity,
      unit_price: item.product.price,
    })),
    item_count: cart.item_count,
    total: cart.subtotal,
  };
  fake.orders.unshift(placed);
  fake.cart = [];
  return placed;
}

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
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  let match: RegExpMatchArray | null;

  if (pathname === '/locations') return jsonResponse(200, STORES);
  if (pathname === '/me/cart') return jsonResponse(200, cartBody());
  if (pathname === '/me/cart/check') {
    if (fake.cart.length === 0) return jsonResponse(409, { code: 'cart_empty', message: 'Empty' });
    if (Number(searchParams.get('store_id')) === fake.failCheckFor) {
      return jsonResponse(500, { code: 'internal_error', message: 'Something went wrong' });
    }
    return jsonResponse(200, checkBody(Number(searchParams.get('store_id'))));
  }
  if ((match = pathname.match(/^\/me\/cart\/(\d+)(\/save-for-later)?$/))) {
    const id = Number(match[1]);
    if (method === 'PUT') fake.cart.find((row) => row.id === id)!.quantity = body.quantity;
    else fake.cart = fake.cart.filter((row) => row.id !== id);
    return jsonResponse(200, cartBody());
  }
  if (pathname === '/me/orders' && method === 'POST') {
    if (fake.failOrderOnce) {
      const code = fake.failOrderOnce;
      fake.failOrderOnce = null;
      if (fake.stockAfterFailure) fake.stock = fake.stockAfterFailure;
      return jsonResponse(409, { code, message: 'Stock changed' });
    }
    return jsonResponse(201, placeBody(body));
  }
  if (pathname === '/me/orders') return jsonResponse(200, fake.orders);
  if ((match = pathname.match(/^\/me\/orders\/(\d+)$/))) {
    const order = fake.orders.find((row) => row.id === Number(match![1]));
    return order ? jsonResponse(200, order) : jsonResponse(404, { code: 'order_not_found' });
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
});
const originalFetch = globalThis.fetch;

beforeAll(() => Ionicons.loadFont());

beforeEach(async () => {
  await AsyncStorage.clear();
  // Lejeune has the chips, one cola of the three wanted, and no rice. Quantico has everything.
  fake.cart = [
    { id: 1, quantity: 1 },
    { id: 2, quantity: 3 },
    { id: 3, quantity: 1 },
  ];
  fake.stock = {
    1: { 1: 5, 2: 1 },
    2: { 1: 5, 2: 9, 3: 4 },
    3: { 1: 2, 3: 4 },
  };
  fake.orders = [];
  fake.failOrderOnce = null;
  fake.stockAfterFailure = null;
  fake.failCheckFor = null;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

/** Saves the signed-in user's (user-1's) preferred store, as the store picker does. */
const preferStore = (id: number, name: string) =>
  AsyncStorage.setItem('preferred-store:user-1', JSON.stringify({ id, name }));

/** The stores the cart was checked against, in order. */
const checkedStores = () =>
  fetchMock.mock.calls
    .map(([url]) => new URL(url))
    .filter(({ pathname }) => pathname === '/me/cart/check')
    .map(({ searchParams }) => Number(searchParams.get('store_id')));

/** The requests that changed something, e.g. "PUT /me/cart/2". */
const writes = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method && init.method !== 'GET')
    .map(([url, init]) => `${init?.method} ${new URL(url).pathname}`);

const press = async (name: string | RegExp) => {
  const button = await screen.findByRole('button', { name });
  await act(async () => fireEvent.press(button));
};

async function openCheckout(preferred: [number, string] = [1, 'Camp Lejeune MCX']) {
  await preferStore(...preferred);
  renderRouter('src/app', { initialUrl: '/checkout' });
  await screen.findByText('Demo checkout: no payment is taken.');
}

const placeOrderButton = () => screen.getByRole('button', { name: 'Place order' });

describe('checking the items', () => {
  it('shows each item as available, limited, or not at the store, and blocks Place order', async () => {
    await openCheckout();

    expect(await screen.findByText('Only 1 left')).toBeOnTheScreen();
    expect(screen.getByText('Available')).toBeOnTheScreen();
    expect(screen.getByText('Not at this store')).toBeOnTheScreen();
    expect(screen.getByText('Camp Lejeune MCX')).toBeOnTheScreen();
    expect(checkedStores()).toEqual([1]);
    expect(placeOrderButton()).toBeDisabled();
  });

  it('"Use N" sets the quantity to what the store has, then checks again', async () => {
    await openCheckout();
    await screen.findByText('Only 1 left');

    await press('Use 1 of Diet Cola');

    expect(await screen.findAllByText('Available')).toHaveLength(2);
    expect(writes()).toEqual(['PUT /me/cart/2']);
    expect(checkedStores()).toEqual([1, 1]);
    expect(fake.cart.find((line) => line.id === 2)?.quantity).toBe(1);
  });

  it('can remove an item the store lacks', async () => {
    await openCheckout();
    await screen.findByText('Not at this store');

    await press('Remove Plain Rice from cart');

    await screen.findByText('Only 1 left');
    expect(screen.queryByText('Plain Rice')).not.toBeOnTheScreen();
    expect(writes()).toEqual(['DELETE /me/cart/3']);
  });

  it('can save an item the store lacks for later', async () => {
    await openCheckout();
    await screen.findByText('Not at this store');

    await press('Save Plain Rice for later');

    await screen.findByText('Only 1 left');
    expect(screen.queryByText('Plain Rice')).not.toBeOnTheScreen();
    expect(writes()).toEqual(['POST /me/cart/3/save-for-later']);
  });

  it('"Try another store" switches to the best other store and checks again', async () => {
    await openCheckout();
    await screen.findByText('Not at this store');

    await press('Try another store for Plain Rice');

    expect(await screen.findByText('Quantico MCX')).toBeOnTheScreen();
    expect(await screen.findAllByText('Available')).toHaveLength(3);
    expect(checkedStores()).toEqual([1, 2]);
    expect(placeOrderButton()).toBeEnabled();
  });

  it('lists the stores with how much of the cart each has, and checks again when one is picked', async () => {
    await openCheckout();
    await screen.findByText('Only 1 left');

    await press('Change store');
    expect(screen.getByRole('button', { name: 'Quantico MCX, All 3 items' })).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Camp Pendleton MCX, 2 of 3 items' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Camp Lejeune MCX, 1 of 3 items' }),
    ).toBeOnTheScreen();

    await press('Camp Pendleton MCX, 2 of 3 items');

    expect(await screen.findByText('Not at this store')).toBeOnTheScreen();
    expect(screen.getByText('Camp Pendleton MCX')).toBeOnTheScreen();
    expect(screen.queryByText('Only 1 left')).not.toBeOnTheScreen();
    expect(checkedStores()).toEqual([1, 3]);
    expect(screen.queryByRole('button', { name: /3 items$/ })).not.toBeOnTheScreen();
  });

  it("doesn't keep the last store's check, or allow ordering, when the new store's check fails", async () => {
    fake.failCheckFor = 1;
    await openCheckout([2, 'Quantico MCX']);
    expect(await screen.findAllByText('Available')).toHaveLength(3);
    expect(placeOrderButton()).toBeEnabled();

    await press('Change store');
    await press('Camp Lejeune MCX, 1 of 3 items');

    expect(await screen.findByText(/Something went wrong/)).toBeOnTheScreen();
    expect(screen.queryByText('Available')).not.toBeOnTheScreen();
    expect(placeOrderButton()).toBeDisabled();
  });

  it('starts with the first store when no preferred store is chosen', async () => {
    renderRouter('src/app', { initialUrl: '/checkout' });
    await screen.findByText('Demo checkout: no payment is taken.');

    expect(await screen.findByText('Only 1 left')).toBeOnTheScreen();
    expect(checkedStores()).toEqual([1]);
  });
});

describe('placing an order', () => {
  it('shows the confirmation for a pickup order, then Done goes Home', async () => {
    await openCheckout([2, 'Quantico MCX']);
    await screen.findAllByText('Available');

    await press('Place order');

    expect(await screen.findByText('Order placed')).toBeOnTheScreen();
    expect(screen.getByText('Order R-1000')).toBeOnTheScreen();
    expect(screen.getByText('Pickup at')).toBeOnTheScreen();
    expect(screen.getByText('Quantico MCX')).toBeOnTheScreen();
    expect(screen.getByText('3 x Diet Cola')).toBeOnTheScreen();
    expect(screen.getByText('$9.25')).toBeOnTheScreen();
    expect(writes()).toEqual(['POST /me/orders']);
    expect(
      JSON.parse(String(fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')?.[1]?.body)),
    ).toEqual({
      store_id: 2,
      fulfillment: 'pickup',
    });

    await press('Done');
    expect(screen).toHavePathname('/');
  });

  it('"View orders" opens the list', async () => {
    await openCheckout([2, 'Quantico MCX']);
    await screen.findAllByText('Available');
    await press('Place order');
    await screen.findByText('Order placed');

    await press('View orders');

    expect(screen).toHavePathname('/orders');
    expect(await screen.findByText('R-1000')).toBeOnTheScreen();
  });

  it('needs an address for delivery, and sends it with the optional name', async () => {
    await openCheckout([2, 'Quantico MCX']);
    await screen.findAllByText('Available');
    expect(screen.queryByLabelText('Delivery address')).not.toBeOnTheScreen();

    await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Delivery' })));
    expect(screen.getByLabelText('Delivery address')).toBeOnTheScreen();
    expect(screen.getByLabelText('Name (optional)')).toBeOnTheScreen();
    expect(placeOrderButton()).toBeDisabled();

    fireEvent.changeText(screen.getByLabelText('Delivery address'), 'Hi');
    expect(placeOrderButton()).toBeDisabled();
    fireEvent.changeText(screen.getByLabelText('Delivery address'), '12 Main St, Quantico VA');
    fireEvent.changeText(screen.getByLabelText('Name (optional)'), 'Sam');
    expect(placeOrderButton()).toBeEnabled();

    await press('Place order');

    expect(await screen.findByText('Order placed')).toBeOnTheScreen();
    expect(screen.getByText('Delivery from')).toBeOnTheScreen();
    expect(screen.getByText('To: 12 Main St, Quantico VA')).toBeOnTheScreen();
    expect(
      JSON.parse(String(fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')?.[1]?.body)),
    ).toEqual({
      store_id: 2,
      fulfillment: 'delivery',
      delivery_address: '12 Main St, Quantico VA',
      contact_name: 'Sam',
    });
  });

  it('checks again and says so when the stock changed (409 items_unavailable)', async () => {
    await openCheckout([2, 'Quantico MCX']);
    await screen.findAllByText('Available');
    fake.failOrderOnce = 'items_unavailable';
    fake.stockAfterFailure = { ...fake.stock, 2: { 1: 5, 2: 2, 3: 4 } };

    await press('Place order');

    expect(
      await screen.findByText(
        'Stock changed while you were checking out. We checked your items again below.',
      ),
    ).toBeOnTheScreen();
    expect(await screen.findByText('Only 2 left')).toBeOnTheScreen();
    expect(checkedStores()).toEqual([2, 2]);
    expect(placeOrderButton()).toBeDisabled();
    expect(screen).toHavePathname('/checkout');
  });

  it('shows an empty cart instead of a check when the cart has nothing', async () => {
    fake.cart = [];

    await preferStore(1, 'Camp Lejeune MCX');
    renderRouter('src/app', { initialUrl: '/checkout' });

    expect(await screen.findByText('Your cart is empty')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Back to cart' })).toBeOnTheScreen();
  });
});

describe('Your orders', () => {
  const order = (id: number, number: string, extra: Partial<Order> = {}): Order => ({
    id,
    number,
    store: { id: 1, name: 'Camp Lejeune MCX' },
    fulfillment: 'pickup',
    delivery_address: null,
    contact_name: null,
    status: 'placed',
    placed_at: '2026-11-03T15:00:00Z',
    items: [{ product_id: 1, name: 'Sample Chips', quantity: 2, unit_price: '3.50' }],
    item_count: 2,
    total: '7.00',
    ...extra,
  });

  it('lists past orders in the order the API sends them, newest first', async () => {
    fake.orders = [
      order(2, 'R-1042', { fulfillment: 'delivery', total: null }),
      order(1, 'R-1041'),
    ];

    renderRouter('src/app', { initialUrl: '/orders' });

    expect(await screen.findByText('R-1042')).toBeOnTheScreen();
    const labels = screen
      .getAllByRole('button', { name: /^Order R-/ })
      .map((b) => b.props.accessibilityLabel);
    expect(labels).toEqual(['Order R-1042', 'Order R-1041']);
    expect(screen.getByText('Delivery')).toBeOnTheScreen();
    expect(screen.getByText('Nov 3, 2026 · 2 items · $7.00')).toBeOnTheScreen();
  });

  it('opens an order to show its items and total', async () => {
    fake.orders = [order(1, 'R-1041')];
    renderRouter('src/app', { initialUrl: '/orders' });

    await press('Order R-1041');

    expect(await screen.findByText('Order R-1041')).toBeOnTheScreen();
    expect(screen.getByText('2 x Sample Chips')).toBeOnTheScreen();
    expect(screen.getByText('$7.00')).toBeOnTheScreen();
    expect(screen).toHavePathname('/order/1');
  });

  it('says when there are no orders yet', async () => {
    renderRouter('src/app', { initialUrl: '/orders' });

    expect(await screen.findByText(/^No orders yet/)).toBeOnTheScreen();
  });
});
