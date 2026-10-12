import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import type { Product } from '@/types/product';

// T025: when the app requests a seeded product, the API returns it and the app displays it.
// This covers the app half with the API response faked; the API ↔ database half is covered by
// backend/tests/test_product_lookup.py, and the full stack is checked by hand (README: full stack).

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

/** The next API request gets this response. */
function respondWith(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
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
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/products\/1$/);
});

it('looks the product up by barcode when opened from a scan', async () => {
  respondWith(200, SAMPLE_CHIPS);

  renderRouter('src/app', { initialUrl: '/product/barcode/036000291452' });

  expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/products\/barcode\/036000291452$/);
});

it('says when a product has no price yet', async () => {
  respondWith(200, { ...SAMPLE_CHIPS, price: null });

  renderRouter('src/app', { initialUrl: '/product/1' });

  expect(await screen.findByText('No price yet')).toBeOnTheScreen();
});

it('shows an error for a missing product, and Try Again loads it again', async () => {
  respondWith(404, { detail: 'Product not found' });
  renderRouter('src/app', { initialUrl: '/product/1' });

  expect(await screen.findByRole('alert')).toBeOnTheScreen();
  expect(screen.queryByText('Sample Chips')).not.toBeOnTheScreen();

  respondWith(200, SAMPLE_CHIPS);
  fireEvent.press(screen.getByRole('button', { name: 'Try Again' }));

  expect(await screen.findByText('Sample Chips')).toBeOnTheScreen();
  expect(fetchMock).toHaveBeenCalledTimes(2);
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
