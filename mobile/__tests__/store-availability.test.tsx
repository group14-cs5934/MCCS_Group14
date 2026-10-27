import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import type { Product } from '@/types/product';
import type { StoreStock } from '@/types/store';

// T079 acceptance: when I open a product, I see which stores have it in stock, with my preferred
// store (T078) listed first; when no store has it in stock, I see "Out of stock at all
// locations".
//
// GET /products/1/availability is faked below, in the API's order: in-stock stores first.

const PRODUCT: Product = {
  id: 1,
  barcode: '012000171741',
  name: 'Diet Pepsi Cola Soda- 20 fl oz Bottle',
  description: null,
  size: '20 fl oz',
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

/** One store's stock of the product; `extra` adds quantity, aisle, or the store's address. */
function stock(
  id: number,
  name: string,
  inStock: boolean,
  { address = null, ...extra }: Partial<StoreStock> & { address?: string | null } = {},
): StoreStock {
  return {
    store: { id, name, slug: name.toLowerCase().replace(/ /g, '-'), address, hours: null },
    in_stock: inStock,
    quantity: null,
    aisle: null,
    updated_at: '2026-10-26T12:00:00Z',
    ...extra,
  };
}

const LEJEUNE = stock(1, 'Camp Lejeune MCX', true, { quantity: 12, aisle: 'Aisle 7' });
const QUANTICO = stock(2, 'Quantico MCX', true, { address: 'MCB Quantico, VA' });
const PENDLETON = stock(3, 'Camp Pendleton MCX', false);

const api = {
  stores: [] as StoreStock[],
  fail: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const fetchMock = jest.fn(async (url: string) => {
  const { pathname } = new URL(url);
  if (pathname === '/products/1') return jsonResponse(200, PRODUCT);
  if (pathname === '/products/1/ratings') {
    return jsonResponse(200, { product_id: 1, average: null, count: 0 });
  }
  if (pathname === '/products/1/availability') {
    if (api.fail) return jsonResponse(500, { code: 'internal_error', message: 'Broken' });
    return jsonResponse(200, { product_id: 1, stores: api.stores });
  }
  if (pathname === '/locations')
    return jsonResponse(
      200,
      api.stores.map((row) => row.store),
    );
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
});
const originalFetch = globalThis.fetch;

beforeAll(() => Ionicons.loadFont());

beforeEach(async () => {
  await AsyncStorage.clear();
  api.stores = [LEJEUNE, QUANTICO, PENDLETON];
  api.fail = false;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

/** Saves the signed-in user's (user-1's) preferred store, as the store picker does. */
async function preferStore(id: number, name: string) {
  await AsyncStorage.setItem('preferred-store:user-1', JSON.stringify({ id, name }));
}

async function openProduct() {
  renderRouter('src/app', { initialUrl: '/product/1' });
  await screen.findByText(PRODUCT.name);
}

/** Each store row's screen-reader label, top to bottom. */
const storeRows = () =>
  screen.queryAllByLabelText(/, (In|Out of) stock/).map((row) => row.props.accessibilityLabel);

/** Opens the full list of stores ("Show all N stores"). */
async function showAllStores() {
  const toggle = await screen.findByRole('button', { name: /^Show all \d+ stores$/ });
  await act(async () => fireEvent.press(toggle));
}

it('shows which stores have the product, in-stock stores first', async () => {
  await openProduct();

  expect(await screen.findByText('In stock at 2 of 3 stores')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Available at' })).toBeOnTheScreen();
  await showAllStores();
  expect(storeRows()).toEqual([
    'Camp Lejeune MCX, In stock, 12 on hand · Aisle 7',
    'Quantico MCX, In stock',
    'Camp Pendleton MCX, Out of stock',
  ]);
  expect(screen.getByText('MCB Quantico, VA')).toBeOnTheScreen();
});

it('starts short, showing only the summary until the list is opened', async () => {
  await openProduct();

  expect(await screen.findByText('In stock at 2 of 3 stores')).toBeOnTheScreen();
  expect(storeRows()).toEqual([]);

  await showAllStores();
  expect(storeRows()).toHaveLength(3);

  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Hide stores' })));
  expect(storeRows()).toEqual([]);
  expect(screen.getByRole('button', { name: 'Show all 3 stores' })).toBeOnTheScreen();
});

it("shows only the shopper's own store until the list is opened", async () => {
  await preferStore(2, 'Quantico MCX');

  await openProduct();

  expect(await screen.findByText('In stock at 2 of 3 stores')).toBeOnTheScreen();
  expect(storeRows()).toEqual(['Quantico MCX, your store, In stock']);
});

it("has nothing to open when the shopper's store is the only one", async () => {
  api.stores = [QUANTICO];
  await preferStore(2, 'Quantico MCX');

  await openProduct();

  expect(await screen.findByText('In stock at 1 of 1 store')).toBeOnTheScreen();
  expect(storeRows()).toEqual(['Quantico MCX, your store, In stock']);
  expect(screen.queryByRole('button', { name: /^Show / })).not.toBeOnTheScreen();
});

it("lists the shopper's own store first, even when it's out of stock", async () => {
  await preferStore(3, 'Camp Pendleton MCX');

  await openProduct();

  expect(await screen.findByText('In stock at 2 of 3 stores')).toBeOnTheScreen();
  await showAllStores();
  expect(storeRows()).toEqual([
    'Camp Pendleton MCX, your store, Out of stock',
    'Camp Lejeune MCX, In stock, 12 on hand · Aisle 7',
    'Quantico MCX, In stock',
  ]);
  expect(screen.getByText('Your store')).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Choose your store to see it first' }),
  ).not.toBeOnTheScreen();
});

it('offers to choose again when the saved store is no longer listed', async () => {
  await preferStore(99, 'Closed MCX');

  await openProduct();

  expect(await screen.findByText('In stock at 2 of 3 stores')).toBeOnTheScreen();
  await showAllStores();
  expect(storeRows()[0]).toBe('Camp Lejeune MCX, In stock, 12 on hand · Aisle 7');
  expect(
    screen.getByRole('button', { name: 'Choose your store to see it first' }),
  ).toBeOnTheScreen();
});

it("doesn't offer a choice when there are no stores", async () => {
  api.stores = [];

  await openProduct();

  expect(await screen.findByText('No stores yet.')).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Choose your store to see it first' }),
  ).not.toBeOnTheScreen();
});

it('says "Out of stock at all locations" when no store has it', async () => {
  api.stores = [stock(1, 'Camp Lejeune MCX', false), stock(3, 'Camp Pendleton MCX', false)];

  await openProduct();

  // Said straight away, without opening the list.
  expect(await screen.findByText('Out of stock at all locations')).toBeOnTheScreen();
  await showAllStores();
  expect(storeRows()).toHaveLength(2);
});

it('offers to choose a store, then lists that store first', async () => {
  await openProduct();
  const choose = await screen.findByRole('button', { name: 'Choose your store to see it first' });

  await act(async () => fireEvent.press(choose));
  expect(screen).toHavePathname('/stores');
  const quantico = await screen.findByRole('button', { name: 'Quantico MCX' });
  await act(async () => fireEvent.press(quantico));

  expect(screen).toHavePathname('/product/1');
  expect(storeRows()[0]).toBe('Quantico MCX, your store, In stock');
});

it("offers to try again when the stores can't be checked", async () => {
  api.fail = true;
  await openProduct();

  expect(await screen.findByText("Couldn't check stores")).toBeOnTheScreen();
  // The rest of the page still shows.
  expect(screen.getByText('20 fl oz')).toBeOnTheScreen();

  api.fail = false;
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Try Again' })));

  expect(await screen.findByText('In stock at 2 of 3 stores')).toBeOnTheScreen();
});
