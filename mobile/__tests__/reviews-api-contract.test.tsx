import Ionicons from '@expo/vector-icons/Ionicons';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { getApiBaseUrl } from '@/api';
import type { Product } from '@/types/product';
import type { ReviewPage } from '@/types/review';

import apiResponse from './fixtures/reviews-api-response.json';

// T073 acceptance: when a review is posted in the app, it is stored in the database and visible
// to other users.
//
// backend/tests/test_reviews_integration.py posts reviews through the real API and database as
// two shoppers, then records what a third shopper gets back in fixtures/reviews-api-response.json
// (CI fails if the API stops returning that). Here the app gets that same response and must show
// exactly those reviews; and the review it posts must be the request the integration test sends.

const page = apiResponse as ReviewPage;
const PRODUCT_ID = page.items[0].product_id;

const PRODUCT: Product = {
  id: PRODUCT_ID,
  barcode: '036000291452',
  name: 'Sample Chips',
  description: null,
  size: '184g',
  image_url: null,
  brand_id: null,
  category_id: null,
  brand: null,
  category: null,
  price: null,
  source: null,
  source_id: null,
  last_synced_at: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const fetchMock = jest.fn(async (url: string, init: RequestInit): Promise<Response> => {
  const path = new URL(url).pathname;
  if (path === `/products/${PRODUCT_ID}`) return jsonResponse(200, PRODUCT);
  if (path === `/products/${PRODUCT_ID}/reviews` && init.method === 'GET') {
    return jsonResponse(200, page);
  }
  if (path === `/products/${PRODUCT_ID}/reviews` && init.method === 'POST') {
    return jsonResponse(200, page.items[0]);
  }
  if (path.endsWith('/ratings')) {
    return jsonResponse(200, { product_id: PRODUCT_ID, average: 3.5, count: 2 });
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
});
const originalFetch = globalThis.fetch;

beforeAll(() => Ionicons.loadFont());

beforeEach(() => {
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function openReviews() {
  renderRouter('src/app', { initialUrl: `/product/${PRODUCT_ID}` });
  await screen.findByText(PRODUCT.name);
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Reviews' })));
}

it('shows exactly the reviews the API returned, in the same order', async () => {
  await openReviews();

  expect(await screen.findByText(`${page.total} reviews`)).toBeOnTheScreen();
  const bodies = screen.queryAllByText(/./).map((node) => node.props.children);
  const shown = bodies.filter((text) => page.items.some((review) => review.body === text));
  expect(shown).toEqual(page.items.map((review) => review.body));
});

it("shows each review's author, date, title, and the author's stars", async () => {
  await openReviews();
  await screen.findByText(page.items[0].body);

  for (const review of page.items) {
    const date = new Date(review.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    expect(screen.getByText(`${review.author} · ${date}`)).toBeOnTheScreen();
    if (review.title) expect(screen.getByText(review.title)).toBeOnTheScreen();
    if (review.stars) {
      expect(screen.getByLabelText(`${review.stars} out of 5 stars`)).toBeOnTheScreen();
    }
  }
});

it('posts a review as the same request the integration test sends', async () => {
  await openReviews();
  await screen.findByText(page.items[0].body);
  fireEvent.changeText(screen.getByLabelText('Title (optional)'), 'Good value');
  fireEvent.changeText(screen.getByLabelText('Review'), 'Cheaper here than off base.');

  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Post review' })));

  const post = fetchMock.mock.calls.find(([, init]) => init.method === 'POST');
  expect(post?.[0]).toBe(`${getApiBaseUrl()}/products/${PRODUCT_ID}/reviews`);
  expect(JSON.parse(post?.[1].body as string)).toEqual({
    title: 'Good value',
    body: 'Cheaper here than off base.',
  });
});
