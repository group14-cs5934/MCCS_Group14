import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import type { Product } from '@/types/product';
import type { RatingSummary } from '@/types/rating';
import type { StoreStock } from '@/types/store';

// T025: when the app requests a seeded product, the API returns it and the app displays it.
// This covers the app half with the API response faked; the API ↔ database half is covered by
// backend/tests/test_product_lookup.py, and the full stack is checked by hand (README: full stack).
// T056: when a product has ratings, its page shows the average and count; with no ratings it
// shows "No ratings yet".

/** The dev seed script's product (backend/scripts/seed_dev.py), with a price added. */
const SAMPLE_CHIPS: Product = {
  id: 1,
  barcode: '036000291452',
  name: 'Sample Chips',
  description: 'Sample snack product for development.',
  size: '184g',
  image_url: null,
  brand_id: null,
  category_id: 1,
  brand: null,
  category: { id: 1, name: 'Snacks', slug: 'snacks', description: null },
  price: {
    id: 1,
    product_id: 1,
    amount: '3.49',
    currency: 'USD',
    source: null,
    observed_at: '2026-10-11T19:19:16Z',
  },
  source: null,
  source_id: null,
  last_synced_at: null,
  created_at: '2026-10-11T19:19:16Z',
  updated_at: '2026-10-11T19:19:16Z',
};

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** The next product request gets this response. */
function respondWith(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(jsonResponse(status, body));
}

const RATINGS_PATH = /\/products\/\d+\/ratings$/;
const MY_RATING_PATH = /\/products\/\d+\/ratings\/me$/;
const AVAILABILITY_PATH = /\/products\/\d+\/availability$/;
const ACTIVITY_PATH = /\/products\/\d+\/activity$/;
const SAVED_PATH = /\/me\/saved\/\d+$/;
const REVIEWS_PATH = /\/products\/\d+\/reviews(\/me)?(\?.*)?$/;

/** What GET /products/{id}/ratings answers; each test starts with no ratings. */
let ratings: RatingSummary | Error = { product_id: 1, average: null, count: 0 };

/** What GET /products/{id}/availability answers. */
let stores: StoreStock[] = [];

/**
 * The product requests made (the page also asks for the product's ratings and which stores have
 * it once it loads, counts the view, asks whether it's saved, and loads the Reviews tab).
 */
const productRequests = () =>
  fetchMock.mock.calls.filter(
    ([url]) =>
      !RATINGS_PATH.test(url) &&
      !MY_RATING_PATH.test(url) &&
      !AVAILABILITY_PATH.test(url) &&
      !ACTIVITY_PATH.test(url) &&
      !SAVED_PATH.test(url) &&
      !REVIEWS_PATH.test(url),
  );

/** The URLs requested, in order. */
const requestedUrls = () => fetchMock.mock.calls.map(([url]) => url);

beforeEach(() => {
  fetchMock.mockReset();
  ratings = { product_id: 1, average: null, count: 0 };
  stores = [];
  // Product responses are queued by each test with respondWith; the product loads first, so the
  // ratings requests that follow get `ratings`, and "not rated yet" for the user's own rating.
  fetchMock.mockImplementation(async (url) => {
    if (MY_RATING_PATH.test(url)) {
      return jsonResponse(404, { code: 'rating_not_found', message: 'Not rated' });
    }
    if (SAVED_PATH.test(url)) {
      return jsonResponse(404, { code: 'not_saved', message: 'Not saved' }); // see cart.test.tsx
    }
    if (AVAILABILITY_PATH.test(url)) {
      return jsonResponse(200, { product_id: 1, stores }); // see store-availability.test.tsx
    }
    if (!RATINGS_PATH.test(url)) {
      return jsonResponse(500, { code: 'internal_error', message: 'Not set up by this test' });
    }
    if (ratings instanceof Error) {
      throw ratings;
    }
    return jsonResponse(200, ratings);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

it('shows a spinner while the product loads', async () => {
  // The request stays in flight until the screen closes and cancels it.
  fetchMock.mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      }),
  );

  renderRouter('src/app', { initialUrl: '/product/1' });

  expect(await screen.findByText('Loading product…')).toBeOnTheScreen();
});

it('requests the product from the API and displays it', async () => {
  respondWith(200, SAMPLE_CHIPS);

  renderRouter('src/app', { initialUrl: '/product/1' });

  expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
  expect(screen.getByText('$3.49')).toBeOnTheScreen();
  expect(screen.getByText('Snacks')).toBeOnTheScreen();
  expect(productRequests()).toHaveLength(1);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/products\/1$/);
});

it('looks the product up by barcode when opened from a scan', async () => {
  respondWith(200, SAMPLE_CHIPS);

  renderRouter('src/app', { initialUrl: '/product/barcode/036000291452' });

  expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
  expect(productRequests()).toHaveLength(1);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/products\/barcode\/036000291452$/);
});

it('has Save and Add to cart in the bottom bar, and no Rate it or Scan another buttons', async () => {
  respondWith(200, SAMPLE_CHIPS);

  renderRouter('src/app', { initialUrl: '/product/1' });

  await screen.findByText('Sample Chips');
  expect(screen.getByRole('button', { name: 'Save' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Add to cart' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Rate it' })).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Scan another' })).not.toBeOnTheScreen();
  expect(screen.getAllByRole('button', { name: 'Add to cart' })).toHaveLength(1);
});

it('says when a product has no price yet', async () => {
  respondWith(200, { ...SAMPLE_CHIPS, price: null });

  renderRouter('src/app', { initialUrl: '/product/1' });

  expect(await screen.findByText('No price yet')).toBeOnTheScreen();
});

it('shows an error for a missing product, and Try Again loads it again', async () => {
  respondWith(404, { code: 'product_not_found', message: 'Product not found' });
  renderRouter('src/app', { initialUrl: '/product/1' });

  expect(await screen.findByRole('alert')).toBeOnTheScreen();
  expect(screen.queryByText('Sample Chips')).not.toBeOnTheScreen();

  respondWith(200, SAMPLE_CHIPS);
  fireEvent.press(screen.getByRole('button', { name: 'Try Again' }));

  expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
  expect(productRequests()).toHaveLength(2);
});

it('shows a friendly error instead of crashing when the API is unreachable', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

  renderRouter('src/app', { initialUrl: '/product/1' });

  expect(
    await screen.findByText(
      "Can't reach the server. Check your internet connection and try again.",
    ),
  ).toBeOnTheScreen();
});

describe('ratings', () => {
  it('shows the average and count when the product has ratings', async () => {
    ratings = { product_id: 1, average: 3, count: 2 };
    respondWith(200, SAMPLE_CHIPS);

    renderRouter('src/app', { initialUrl: '/product/1' });

    expect(await screen.findByText('3.0')).toBeOnTheScreen();
    expect(screen.getByText('(2 ratings)')).toBeOnTheScreen();
    expect(screen.getByLabelText('Rated 3.0 out of 5 from 2 ratings')).toBeOnTheScreen();
    expect(screen.queryByText('No ratings yet')).not.toBeOnTheScreen();
    expect(requestedUrls()).toContainEqual(expect.stringMatching(/\/products\/1\/ratings$/));
  });

  it('shows "No ratings yet" when nobody has rated the product', async () => {
    respondWith(200, SAMPLE_CHIPS);

    renderRouter('src/app', { initialUrl: '/product/1' });

    expect(await screen.findByText('No ratings yet')).toBeOnTheScreen();
  });

  it('says "1 rating" for a single rating, and rounds the average to one decimal', async () => {
    ratings = { product_id: 1, average: 4, count: 1 };
    respondWith(200, SAMPLE_CHIPS);

    renderRouter('src/app', { initialUrl: '/product/1' });

    expect(await screen.findByText('(1 rating)')).toBeOnTheScreen();
    expect(screen.getByText('4.0')).toBeOnTheScreen();
  });

  it('shows large counts with separators and a rounded average', async () => {
    ratings = { product_id: 1, average: 4.57, count: 1234 };
    respondWith(200, SAMPLE_CHIPS);

    renderRouter('src/app', { initialUrl: '/product/1' });

    expect(await screen.findByText('4.6')).toBeOnTheScreen();
    expect(screen.getByText('(1,234 ratings)')).toBeOnTheScreen();
  });

  it('loads the ratings of the scanned product by its ID', async () => {
    respondWith(200, { ...SAMPLE_CHIPS, id: 42 });

    renderRouter('src/app', { initialUrl: '/product/barcode/036000291452' });

    await screen.findByText('No ratings yet');
    expect(requestedUrls()).toContainEqual(expect.stringMatching(/\/products\/42\/ratings$/));
  });

  it('still shows the product when the ratings can’t be loaded', async () => {
    ratings = new TypeError('Network request failed');
    respondWith(200, SAMPLE_CHIPS);

    renderRouter('src/app', { initialUrl: '/product/1' });

    expect(await screen.findByText('Ratings unavailable')).toBeOnTheScreen();
    expect(screen.getByText('Sample Chips')).toBeOnTheScreen();
    expect(screen.getByText('$3.49')).toBeOnTheScreen();
  });
});

describe('stock panel', () => {
  beforeEach(() => AsyncStorage.clear());

  function stock(id: number, name: string, inStock: boolean, extra: Partial<StoreStock> = {}) {
    return {
      store: { id, name, slug: `store-${id}`, address: null, hours: null },
      in_stock: inStock,
      quantity: null,
      aisle: null,
      updated_at: null,
      ...extra,
    } satisfies StoreStock;
  }

  it("shows the shopper's own store first, with its aisle and shelf count", async () => {
    stores = [
      stock(1, 'Camp Lejeune MCX', true),
      stock(2, 'Quantico MCX', true, { aisle: 'Aisle 7', quantity: 18 }),
      stock(3, 'Camp Pendleton MCX', true),
      stock(4, 'Twentynine Palms MCX', false),
    ];
    await AsyncStorage.setItem(
      'preferred-store:user-1',
      JSON.stringify({ id: 2, name: 'Quantico MCX' }),
    );
    respondWith(200, SAMPLE_CHIPS);

    renderRouter('src/app', { initialUrl: '/product/1' });

    expect(await screen.findByText('In stock at Quantico MCX')).toBeOnTheScreen();
    expect(screen.getByText('Aisle 7 · 18 on the shelf')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'In stock at 2 other stores' })).toBeOnTheScreen();
  });

  it("says when the shopper's own store is out of it", async () => {
    stores = [stock(1, 'Camp Lejeune MCX', true), stock(2, 'Quantico MCX', false)];
    await AsyncStorage.setItem(
      'preferred-store:user-1',
      JSON.stringify({ id: 2, name: 'Quantico MCX' }),
    );
    respondWith(200, SAMPLE_CHIPS);

    renderRouter('src/app', { initialUrl: '/product/1' });

    expect(await screen.findByText('Out of stock at Quantico MCX')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'In stock at 1 other store' })).toBeOnTheScreen();
  });

  it('summarises all stores when no store is chosen, and the link opens the Stores tab', async () => {
    stores = [stock(1, 'Camp Lejeune MCX', true), stock(2, 'Quantico MCX', false)];
    respondWith(200, SAMPLE_CHIPS);

    renderRouter('src/app', { initialUrl: '/product/1' });

    expect(await screen.findByText('Available at 1 store')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'See all stores' }));
    expect(screen.getByRole('tab', { name: 'Stores' })).toBeSelected();
    expect(await screen.findByText('Available at')).toBeOnTheScreen();
  });
});

describe('recently scanned', () => {
  beforeEach(() => AsyncStorage.clear());

  it('remembers the product for the signed-in user once it has loaded', async () => {
    ratings = { product_id: 1, average: 4.5, count: 2 };
    respondWith(200, SAMPLE_CHIPS);

    renderRouter('src/app', { initialUrl: '/product/1' });
    await screen.findByText('4.5');

    await waitFor(async () => {
      const saved = JSON.parse((await AsyncStorage.getItem('recent-products:user-1')) ?? '[]');
      expect(saved).toEqual([
        expect.objectContaining({
          id: 1,
          name: 'Sample Chips',
          image_url: null,
          price: '3.49',
          rating: 4.5,
        }),
      ]);
    });
  });

  it('is saved once per product, however often the page re-renders', async () => {
    respondWith(200, SAMPLE_CHIPS);
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    setItem.mockClear();

    renderRouter('src/app', { initialUrl: '/product/1' });
    await screen.findByText('No ratings yet');
    const saves = () => setItem.mock.calls.filter(([key]) => key === 'recent-products:user-1');
    await waitFor(() => expect(saves()).toHaveLength(1));
    fireEvent.press(screen.getByRole('tab', { name: 'Nutrition' }));
    fireEvent.press(screen.getByRole('tab', { name: 'Reviews' }));

    expect(saves()).toHaveLength(1);
    setItem.mockRestore();
  });
});
