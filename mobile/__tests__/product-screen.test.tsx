import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import type { Product } from '@/types/product';
import type { RatingSummary } from '@/types/rating';

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

/** What GET /products/{id}/ratings answers; each test starts with no ratings. */
let ratings: RatingSummary | Error = { product_id: 1, average: null, count: 0 };

/** The product requests made (the page also asks for the product's ratings once it loads). */
const productRequests = () =>
  fetchMock.mock.calls.filter(([url]) => !RATINGS_PATH.test(url) && !MY_RATING_PATH.test(url));

/** The URLs requested, in order. */
const requestedUrls = () => fetchMock.mock.calls.map(([url]) => url);

beforeEach(() => {
  fetchMock.mockReset();
  ratings = { product_id: 1, average: null, count: 0 };
  // Product responses are queued by each test with respondWith; the product loads first, so the
  // ratings requests that follow get `ratings`, and "not rated yet" for the user's own rating.
  fetchMock.mockImplementation(async (url) => {
    if (MY_RATING_PATH.test(url)) {
      return jsonResponse(404, { code: 'rating_not_found', message: 'Not rated' });
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
