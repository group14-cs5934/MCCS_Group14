import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import type { ProductCard } from '@/types/cart';
import type { Product } from '@/types/product';

// Saved products and the cart: the Save toggle and Add to cart on the product page, the Saved tab,
// the Cart tab with its count badge, quantities, Remove and Save for later. The API is faked
// below to the contract (it keeps the shopper's saved list and cart in memory).

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
const PLAIN: ProductCard = {
  id: 3,
  barcode: '000000000003',
  name: 'Plain Rice',
  size: '1 lb',
  image_url: null,
  price: null,
};
const CATALOG = [CHIPS, COLA, PLAIN];

const CHIPS_PAGE: Product = {
  ...CHIPS,
  description: null,
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

const fake = {
  saved: [] as number[],
  cart: [] as { id: number; quantity: number }[],
  failSave: false,
};

const product = (id: number) => CATALOG.find((p) => p.id === id)!;

function cartBody() {
  const items = fake.cart.map(({ id, quantity }) => {
    const { price } = product(id);
    return {
      product: product(id),
      quantity,
      line_total: price ? (Number(price) * quantity).toFixed(2) : null,
    };
  });
  const priced = items.filter((item) => item.line_total !== null);
  return {
    items,
    item_count: fake.cart.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: items.length
      ? priced.reduce((sum, item) => sum + Number(item.line_total), 0).toFixed(2)
      : null,
    unpriced_items: items.length - priced.length,
  };
}

const savedBody = (id: number) => ({
  product: product(id),
  saved_at: '2026-11-01T12:00:00Z',
  in_cart: fake.cart.some((line) => line.id === id),
});

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const notFound = (code: string) => jsonResponse(404, { code, message: code });

const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const { pathname } = new URL(url);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  let match: RegExpMatchArray | null;

  if (pathname === '/products/1') return jsonResponse(200, CHIPS_PAGE);
  if (pathname === '/products/1/ratings') {
    return jsonResponse(200, { product_id: 1, average: null, count: 0 });
  }
  if (pathname === '/products/1/availability') {
    return jsonResponse(200, { product_id: 1, stores: [] });
  }

  if (pathname === '/me/saved') return jsonResponse(200, [...fake.saved].reverse().map(savedBody));
  if ((match = pathname.match(/^\/me\/saved\/(\d+)$/))) {
    const id = Number(match[1]);
    if (method === 'PUT') {
      if (fake.failSave) return jsonResponse(500, { code: 'internal_error', message: 'Broken' });
      if (!fake.saved.includes(id)) fake.saved.push(id);
      return jsonResponse(200, savedBody(id));
    }
    if (method === 'DELETE') {
      fake.saved = fake.saved.filter((saved) => saved !== id);
      return jsonResponse(204);
    }
    return fake.saved.includes(id) ? jsonResponse(200, savedBody(id)) : notFound('not_saved');
  }

  if (pathname === '/me/cart') return jsonResponse(200, cartBody());
  if ((match = pathname.match(/^\/me\/cart\/(\d+)(\/save-for-later)?$/))) {
    const id = Number(match[1]);
    const line = fake.cart.find((row) => row.id === id);
    if (match[2]) {
      if (!line) return notFound('not_in_cart');
      fake.cart = fake.cart.filter((row) => row.id !== id);
      if (!fake.saved.includes(id)) fake.saved.push(id);
    } else if (method === 'POST') {
      if (line) line.quantity += body.quantity ?? 1;
      else fake.cart.push({ id, quantity: body.quantity ?? 1 });
    } else if (method === 'PUT') {
      if (line) line.quantity = body.quantity;
      else fake.cart.push({ id, quantity: body.quantity });
    } else {
      fake.cart = fake.cart.filter((row) => row.id !== id);
    }
    return jsonResponse(200, cartBody());
  }
  return notFound('not_found');
});
const originalFetch = globalThis.fetch;

beforeAll(() => Ionicons.loadFont());

beforeEach(async () => {
  await AsyncStorage.clear();
  fake.saved = [];
  fake.cart = [];
  fake.failSave = false;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

/** The requests that changed something, e.g. "PUT /me/saved/1" (not the page's view count). */
const writes = () =>
  fetchMock.mock.calls
    .filter(([url, init]) => init?.method && init.method !== 'GET' && !url.endsWith('/activity'))
    .map(([url, init]) => `${init?.method} ${new URL(url).pathname}`);

const press = async (name: string | RegExp) => {
  const button = await screen.findByRole('button', { name });
  await act(async () => fireEvent.press(button));
};

const cartTab = () => screen.getByRole('button', { name: /^Cart, tab/ });

describe('Save on the product page', () => {
  it('shows whether the product is saved, and saves and un-saves it', async () => {
    renderRouter('src/app', { initialUrl: '/product/1' });

    // Not saved yet: the API answers 404 not_saved.
    await press('Save');
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeOnTheScreen();
    expect(fake.saved).toEqual([1]);

    await press('Saved');
    expect(await screen.findByRole('button', { name: 'Save' })).toBeOnTheScreen();
    expect(fake.saved).toEqual([]);
    expect(writes()).toEqual(['PUT /me/saved/1', 'DELETE /me/saved/1']);
  });

  it('starts as Saved when the product is already saved', async () => {
    fake.saved = [1];

    renderRouter('src/app', { initialUrl: '/product/1' });

    expect(await screen.findByRole('button', { name: 'Saved' })).toBeOnTheScreen();
  });

  it('puts the toggle back and shows an error when saving fails', async () => {
    fake.failSave = true;
    renderRouter('src/app', { initialUrl: '/product/1' });

    await press('Save');

    expect(await screen.findByRole('alert')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Saved' })).not.toBeOnTheScreen();
  });
});

describe('Saved tab', () => {
  it('lists saved products, newest first, with size and price', async () => {
    fake.saved = [1, 3];

    renderRouter('src/app', { initialUrl: '/saved' });

    expect(await screen.findByText('Plain Rice')).toBeOnTheScreen();
    expect(screen.getByText('Sample Chips')).toBeOnTheScreen();
    expect(screen.getByText('12 oz')).toBeOnTheScreen();
    expect(screen.getByText('$3.50')).toBeOnTheScreen();
    expect(screen.getByText('No price yet')).toBeOnTheScreen();
    const names = screen
      .getAllByRole('button', { name: /^Open / })
      .map((b) => b.props.accessibilityLabel);
    expect(names).toEqual(['Open Plain Rice', 'Open Sample Chips']);
  });

  it('opens the product when its row is tapped', async () => {
    fake.saved = [1];
    renderRouter('src/app', { initialUrl: '/saved' });

    await press('Open Sample Chips');

    expect(screen).toHavePathname('/product/1');
  });

  it('removes a product from Saved', async () => {
    fake.saved = [1, 2];
    renderRouter('src/app', { initialUrl: '/saved' });
    await screen.findByText('Sample Chips');

    await press('Remove Sample Chips from saved');

    expect(screen.queryByText('Sample Chips')).not.toBeOnTheScreen();
    expect(screen.getByText('Diet Cola')).toBeOnTheScreen();
    expect(writes()).toEqual(['DELETE /me/saved/1']);
  });

  it('adds a saved product to the cart, then says In cart', async () => {
    fake.saved = [1];
    fake.cart = [{ id: 2, quantity: 1 }];
    renderRouter('src/app', { initialUrl: '/saved' });
    await screen.findByText('Sample Chips');

    await press('Add Sample Chips to cart');

    expect(
      await screen.findByRole('button', { name: 'Sample Chips is in your cart' }),
    ).toBeDisabled();
    expect(writes()).toEqual(['POST /me/cart/1']);
    // The Cart tab's badge counts both products.
    expect(within(cartTab()).getByText('2')).toBeOnTheScreen();
  });

  it('shows "In cart" for a product that is already in the cart', async () => {
    fake.saved = [1];
    fake.cart = [{ id: 1, quantity: 1 }];

    renderRouter('src/app', { initialUrl: '/saved' });

    expect(
      await screen.findByRole('button', { name: 'Sample Chips is in your cart' }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Add Sample Chips/ })).not.toBeOnTheScreen();
  });

  it('shows a hint when nothing is saved', async () => {
    renderRouter('src/app', { initialUrl: '/saved' });

    expect(await screen.findByText('Nothing saved yet')).toBeOnTheScreen();
    expect(screen.getByText('Tap Save on a product to keep it here.')).toBeOnTheScreen();
  });

  it('reloads when the tab is opened again', async () => {
    renderRouter('src/app', { initialUrl: '/saved' });
    await screen.findByText('Nothing saved yet');

    fake.saved = [2];
    await press(/^Home, tab/);
    await press(/^Saved, tab/);

    expect(await screen.findByText('Diet Cola')).toBeOnTheScreen();
  });
});

describe('Add to cart', () => {
  it('confirms with a View cart link, and the Cart tab badge counts what was added', async () => {
    renderRouter('src/app', { initialUrl: '/product/1' });

    await press('Add to cart');
    expect(await screen.findByText('Added to cart')).toBeOnTheScreen();
    await press('Add to cart');
    expect(writes()).toEqual(['POST /me/cart/1', 'POST /me/cart/1']);

    await press('View cart');
    expect(screen).toHavePathname('/cart');
    expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
    expect(within(cartTab()).getByText('2')).toBeOnTheScreen();
  });

  it('shows the count on the tab from the start', async () => {
    fake.cart = [{ id: 1, quantity: 3 }];
    // The cart count is read once someone signs in (stubbed by default: see jest.setup.ts).
    const { getCart } = jest.requireMock('@/api/cart');
    getCart.mockResolvedValueOnce({ ok: true, status: 200, data: cartBody() });

    renderRouter('src/app');

    expect(
      await within(await screen.findByRole('button', { name: /^Cart, tab/ })).findByText('3'),
    ).toBeOnTheScreen();
  });
});

describe('Cart tab', () => {
  it('shows an empty state', async () => {
    renderRouter('src/app', { initialUrl: '/cart' });

    expect(await screen.findByText('Your cart is empty')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Checkout' })).not.toBeOnTheScreen();
  });

  it('lists the lines with the subtotal, and notes unpriced items', async () => {
    fake.cart = [
      { id: 1, quantity: 2 },
      { id: 3, quantity: 1 },
    ];

    renderRouter('src/app', { initialUrl: '/cart' });

    expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
    expect(screen.getByText('Plain Rice')).toBeOnTheScreen();
    expect(screen.getAllByText('$7.00')).toHaveLength(2); // the line and the subtotal
    expect(screen.getByText('1 item has no price yet and is not included.')).toBeOnTheScreen();
  });

  it('changes the quantity with the stepper, from 1 up', async () => {
    fake.cart = [{ id: 2, quantity: 1 }];
    renderRouter('src/app', { initialUrl: '/cart' });
    await screen.findByText('Diet Cola');
    expect(screen.getByRole('button', { name: 'Decrease quantity of Diet Cola' })).toBeDisabled();

    await press('Increase quantity of Diet Cola');

    expect(await screen.findByLabelText('Quantity 2')).toBeOnTheScreen();
    expect(screen.getAllByText('$2.50')).toHaveLength(2);
    expect(writes()).toEqual(['PUT /me/cart/2']);
    expect(
      JSON.parse(
        String(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body),
      ),
    ).toEqual({ quantity: 2 });
    expect(within(cartTab()).getByText('2')).toBeOnTheScreen();

    await press('Decrease quantity of Diet Cola');
    expect(await screen.findByLabelText('Quantity 1')).toBeOnTheScreen();
  });

  it('stops at 99', async () => {
    fake.cart = [{ id: 2, quantity: 99 }];

    renderRouter('src/app', { initialUrl: '/cart' });

    await screen.findByText('Diet Cola');
    expect(screen.getByRole('button', { name: 'Increase quantity of Diet Cola' })).toBeDisabled();
  });

  it('removes a line', async () => {
    fake.cart = [
      { id: 1, quantity: 1 },
      { id: 2, quantity: 1 },
    ];
    renderRouter('src/app', { initialUrl: '/cart' });
    await screen.findByText('Sample Chips');

    await press('Remove Sample Chips from cart');

    expect(screen.queryByText('Sample Chips')).not.toBeOnTheScreen();
    expect(screen.getByText('Diet Cola')).toBeOnTheScreen();
    expect(writes()).toEqual(['DELETE /me/cart/1']);
    expect(within(cartTab()).getByText('1')).toBeOnTheScreen();
  });

  it('saves a line for later: it leaves the cart and appears in Saved', async () => {
    fake.cart = [{ id: 1, quantity: 1 }];
    renderRouter('src/app', { initialUrl: '/cart' });
    await screen.findByText('Sample Chips');

    await press('Save Sample Chips for later');

    expect(await screen.findByText('Your cart is empty')).toBeOnTheScreen();
    expect(writes()).toEqual(['POST /me/cart/1/save-for-later']);
    expect(fake.saved).toEqual([1]);
  });

  it('opens checkout', async () => {
    fake.cart = [{ id: 1, quantity: 1 }];
    renderRouter('src/app', { initialUrl: '/cart' });
    await screen.findByText('Sample Chips');

    await press('Checkout');

    expect(screen).toHavePathname('/checkout');
  });

  it('links to Your orders, even when the cart is empty', async () => {
    renderRouter('src/app', { initialUrl: '/cart' });
    await screen.findByText('Your cart is empty');

    await press('Your orders');

    expect(screen).toHavePathname('/orders');
  });
});
