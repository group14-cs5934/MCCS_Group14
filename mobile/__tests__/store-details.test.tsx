import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import type { Product } from '@/types/product';
import type { Store } from '@/types/store';
import { directionsUrl } from '@/utils/directions';

// T080 acceptance: when I open a store, I see its address and hours; tapping the map link opens
// directions. Stores open from the store list (their details button) and from "Available at" on
// a product page.
//
// GET /locations, /locations/{id}, and the product page's requests are faked below. Opening maps
// is faked with a spy on Linking.openURL.

const LEJEUNE: Store = {
  id: 1,
  name: 'Camp Lejeune MCX',
  slug: 'camp-lejeune-mcx',
  address: 'Bldg. 1231 Birch St., Camp Lejeune, NC 28547',
  hours: 'Mon–Sat 9 AM–9 PM · Sun 10 AM–6 PM',
};
const ONLINE: Store = {
  id: 2,
  name: 'MCX Online Store',
  slug: 'mcx-online',
  address: null,
  hours: null,
};

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
  const storeId = Number(pathname.match(/^\/locations\/(\d+)$/)?.[1]);
  const store = [LEJEUNE, ONLINE].find((item) => item.id === storeId);
  if (pathname === '/locations') return jsonResponse(200, [LEJEUNE, ONLINE]);
  if (store) return jsonResponse(200, store);
  if (pathname === '/products/1') return jsonResponse(200, PRODUCT);
  if (pathname === '/products/1/ratings') {
    return jsonResponse(200, { product_id: 1, average: null, count: 0 });
  }
  if (pathname === '/products/1/availability') {
    const stores = [LEJEUNE, ONLINE].map((item) => ({
      store: item,
      in_stock: item === LEJEUNE,
      quantity: null,
      aisle: null,
      updated_at: null,
    }));
    return jsonResponse(200, { product_id: 1, stores });
  }
  if (pathname.startsWith('/locations/')) {
    return jsonResponse(404, { code: 'store_not_found', message: 'Store not found' });
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
});
const originalFetch = globalThis.fetch;
const openURL = jest.spyOn(Linking, 'openURL');

beforeAll(() => Ionicons.loadFont());

beforeEach(async () => {
  await AsyncStorage.clear();
  fetchMock.mockClear();
  openURL.mockReset().mockResolvedValue(true);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  openURL.mockRestore();
});

/** Opens a store's page from the store list's details button. */
async function openFromStoreList(name: string) {
  renderRouter('src/app', { initialUrl: '/stores' });
  const details = await screen.findByRole('button', { name: `${name} details` });
  await act(async () => fireEvent.press(details));
}

it('shows the address and hours, and the map link opens directions', async () => {
  await openFromStoreList('Camp Lejeune MCX');

  expect(screen).toHavePathname('/store/1');
  expect(
    await screen.findByLabelText('Address: Bldg. 1231 Birch St., Camp Lejeune, NC 28547'),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Hours: Mon–Sat 9 AM–9 PM · Sun 10 AM–6 PM')).toBeOnTheScreen();

  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Get directions' })));

  expect(openURL).toHaveBeenCalledWith(
    'https://www.google.com/maps/dir/?api=1&destination=' +
      encodeURIComponent('Camp Lejeune MCX, Bldg. 1231 Birch St., Camp Lejeune, NC 28547'),
  );
});

it("says when a store's address and hours aren't listed, with no map link", async () => {
  await openFromStoreList('MCX Online Store');

  expect(await screen.findByLabelText('Hours: Hours not listed')).toBeOnTheScreen();
  expect(screen.getByLabelText('Address: Not listed')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Get directions' })).not.toBeOnTheScreen();
});

it("says so when maps can't be opened", async () => {
  openURL.mockRejectedValueOnce(new Error('No app can open this'));
  await openFromStoreList('Camp Lejeune MCX');

  const directions = await screen.findByRole('button', { name: 'Get directions' });
  await act(async () => fireEvent.press(directions));

  expect(screen.getByText(/^Couldn't open maps\./)).toBeOnTheScreen();
});

it('can make the store the shopper’s own', async () => {
  await openFromStoreList('Camp Lejeune MCX');

  const make = await screen.findByRole('button', { name: 'Make this my store' });
  await act(async () => fireEvent.press(make));

  expect(screen.getByText('Your store')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Make this my store' })).not.toBeOnTheScreen();
  expect(JSON.parse((await AsyncStorage.getItem('preferred-store:user-1'))!)).toEqual({
    id: 1,
    name: 'Camp Lejeune MCX',
    slug: 'camp-lejeune-mcx', // so searches can filter by it (T096)
  });
});

it('opens from a store in "Available at" on a product page', async () => {
  renderRouter('src/app', { initialUrl: '/product/1' });
  // The list starts closed (no store is the shopper's yet), so open it first.
  const showAll = await screen.findByRole('button', { name: 'Show all 2 stores' });
  await act(async () => fireEvent.press(showAll));
  const row = screen.getByRole('button', { name: /^Camp Lejeune MCX, In stock/ });

  await act(async () => fireEvent.press(row));

  expect(screen).toHavePathname('/store/1');
  expect(await screen.findByLabelText(/^Hours: Mon–Sat/)).toBeOnTheScreen();
});

it('says when a store no longer exists', async () => {
  renderRouter('src/app', { initialUrl: '/store/999' });

  expect(await screen.findByText('Store not found')).toBeOnTheScreen();
});

it("doesn't ask the API about a link that isn't a store ID", async () => {
  renderRouter('src/app', { initialUrl: '/store/not-a-store' });

  expect(await screen.findByText('Store not found')).toBeOnTheScreen();
  expect(fetchMock.mock.calls.some(([url]) => url.includes('/locations/'))).toBe(false);
});

describe('directionsUrl', () => {
  it('leaves out a missing address', () => {
    expect(directionsUrl({ name: 'Quantico MCX', address: null })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Quantico%20MCX',
    );
  });
});
