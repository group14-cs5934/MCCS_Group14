import Ionicons from '@expo/vector-icons/Ionicons';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import type { Product } from '@/types/product';
import type { Review } from '@/types/review';

// T069 acceptance: when I scroll to the bottom of the reviews, the next page loads.
//
// The reviews API is faked with 25 reviews served 10 per page, newest first, like the real one.

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

/** Review n of the product; higher numbers are newer. */
function review(n: number): Review {
  const at = `2026-10-${String(n).padStart(2, '0')}T12:00:00Z`;
  return {
    id: n,
    product_id: 1,
    title: n % 2 ? `Title ${n}` : null,
    body: `Review ${n}`,
    author: 'a***',
    stars: n % 5 || null,
    created_at: at,
    updated_at: at,
  };
}

const api = {
  reviews: [] as Review[], // newest first
  fail: false,
  hang: false,
  requests: [] as { offset: number; limit: number }[],
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

async function fakeApi(url: string, init: RequestInit): Promise<Response> {
  const { pathname, searchParams } = new URL(url);
  if (pathname === '/products/1') return jsonResponse(200, PRODUCT);
  if (pathname === '/products/1/ratings') {
    return jsonResponse(200, { product_id: 1, average: null, count: 0 });
  }
  if (pathname === '/products/1/reviews') {
    const offset = Number(searchParams.get('offset'));
    const limit = Number(searchParams.get('limit'));
    api.requests.push({ offset, limit });
    if (api.hang) {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    }
    if (api.fail) return jsonResponse(500, { code: 'internal_error', message: 'Broken' });
    const items = api.reviews.slice(offset, offset + limit);
    return jsonResponse(200, { items, total: api.reviews.length, limit, offset });
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
}

const fetchMock = jest.fn(fakeApi);
const originalFetch = globalThis.fetch;

beforeAll(() => Ionicons.loadFont());

beforeEach(() => {
  api.reviews = Array.from({ length: 25 }, (_, index) => review(25 - index));
  Object.assign(api, { fail: false, hang: false, requests: [] });
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function openReviews() {
  renderRouter('src/app', { initialUrl: '/product/1' });
  await screen.findByText(PRODUCT.name);
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Reviews' })));
}

/** Scrolls the product page to its very bottom. */
async function scrollToBottom() {
  await act(async () =>
    fireEvent.scroll(screen.getByTestId('product-scroll'), {
      nativeEvent: {
        contentOffset: { x: 0, y: 2000 },
        contentSize: { width: 400, height: 2600 },
        layoutMeasurement: { width: 400, height: 800 },
      },
    }),
  );
}

const shownReviews = () => screen.queryAllByText(/^Review \d+$/).map((node) => node.props.children);

it("doesn't ask for reviews until the Reviews tab is opened", async () => {
  renderRouter('src/app', { initialUrl: '/product/1' });
  await screen.findByText(PRODUCT.name);

  expect(api.requests).toEqual([]);
  expect(screen.getByText('UPC')).toBeOnTheScreen();
});

it('shows the first 10 reviews, newest first', async () => {
  await openReviews();

  expect(await screen.findByText('25 reviews')).toBeOnTheScreen();
  expect(shownReviews()).toEqual(Array.from({ length: 10 }, (_, i) => `Review ${25 - i}`));
  expect(api.requests).toEqual([{ offset: 0, limit: 10 }]);
  expect(screen.getByRole('tab', { name: 'Reviews' })).toBeSelected();
  expect(screen.queryByText('UPC')).toBeNull();
});

it('shows the title, author, date, and stars of a review', async () => {
  await openReviews();

  expect(await screen.findByText('Title 25')).toBeOnTheScreen();
  expect(screen.getByText('a*** · Oct 25, 2026')).toBeOnTheScreen();
  expect(screen.getAllByLabelText('4 out of 5 stars').length).toBeGreaterThan(0);
});

it('loads the next page when I scroll to the bottom of the reviews', async () => {
  await openReviews();
  await screen.findByText('Review 16');

  await scrollToBottom();

  expect(await screen.findByText('Review 6')).toBeOnTheScreen();
  expect(shownReviews()).toHaveLength(20);
  expect(api.requests).toEqual([
    { offset: 0, limit: 10 },
    { offset: 10, limit: 10 },
  ]);

  await scrollToBottom();

  expect(await screen.findByText('Review 1')).toBeOnTheScreen();
  expect(shownReviews()).toEqual(Array.from({ length: 25 }, (_, i) => `Review ${25 - i}`));
  expect(screen.queryByRole('button', { name: 'Show more reviews' })).toBeNull();
});

it('stops asking once every review is shown', async () => {
  await openReviews();
  await screen.findByText('Review 16');
  await scrollToBottom();
  await screen.findByText('Review 6');
  await scrollToBottom();
  await screen.findByText('Review 1');

  await scrollToBottom();

  expect(api.requests).toHaveLength(3);
});

it('asks for one page at a time, however often the scroll event fires', async () => {
  await openReviews();
  await screen.findByText('Review 16');
  api.hang = true;

  await scrollToBottom();
  await scrollToBottom();
  await scrollToBottom();

  expect(api.requests).toHaveLength(2);
  expect(screen.getByLabelText('Loading more reviews…')).toBeOnTheScreen();
});

it('loads the next page with Show more reviews too', async () => {
  await openReviews();
  await screen.findByText('Review 16');

  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Show more reviews' })));

  expect(await screen.findByText('Review 6')).toBeOnTheScreen();
});

it("doesn't load more while the Overview tab is showing", async () => {
  await openReviews();
  await screen.findByText('Review 16');
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Overview' })));

  await scrollToBottom();

  expect(api.requests).toHaveLength(1);
});

it('says when there are no reviews yet', async () => {
  api.reviews = [];
  await openReviews();

  expect(await screen.findByText('No reviews yet.')).toBeOnTheScreen();
});

it('shows an error with Try Again when reviews fail to load', async () => {
  api.fail = true;
  await openReviews();

  expect(await screen.findByText("Couldn't load reviews")).toBeOnTheScreen();

  api.fail = false;
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Try Again' })));

  expect(await screen.findByText('Review 25')).toBeOnTheScreen();
});

it('keeps the loaded reviews when a later page fails, and retries it', async () => {
  await openReviews();
  await screen.findByText('Review 16');
  api.fail = true;

  await scrollToBottom();

  expect(await screen.findByText("Couldn't load more reviews")).toBeOnTheScreen();
  expect(shownReviews()).toHaveLength(10);

  api.fail = false;
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Try Again' })));

  expect(await screen.findByText('Review 6')).toBeOnTheScreen();
  expect(shownReviews()).toHaveLength(20);
});
