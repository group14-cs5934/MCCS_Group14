import Ionicons from '@expo/vector-icons/Ionicons';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import type { Product } from '@/types/product';
import type { Review } from '@/types/review';

// T068 acceptance: when I submit a valid review, it appears in the list; when it is too long, I
// see an error and it is not posted.

const PRODUCT: Product = {
  id: 1,
  barcode: '012000171741',
  name: 'Diet Pepsi Cola Soda- 20 fl oz Bottle',
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

const AT = '2026-10-21T12:00:00Z';

/**
 * A fake reviews API that remembers reviews like the real one: other shoppers' reviews, plus the
 * signed-in user's own (null until they post one). Set `failWith` to make posting fail.
 */
const api = {
  others: [] as Review[],
  mine: null as Review | null,
  failWith: null as { status: number; code: string } | null,
  posted: [] as unknown[],
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
  const path = new URL(url).pathname;
  if (path === '/products/1') return jsonResponse(200, PRODUCT);
  if (path === '/products/1/ratings') {
    return jsonResponse(200, { product_id: 1, average: null, count: 0 });
  }
  if (path === '/products/1/ratings/me') {
    return jsonResponse(404, { code: 'rating_not_found', message: 'Not rated' });
  }
  if (path === '/products/1/reviews/me') {
    return api.mine
      ? jsonResponse(200, api.mine)
      : jsonResponse(404, { code: 'review_not_found', message: 'None' });
  }
  if (path === '/products/1/reviews' && init.method === 'POST') {
    if (api.failWith) {
      return jsonResponse(api.failWith.status, { code: api.failWith.code, message: 'Failed' });
    }
    const body = JSON.parse(init.body as string);
    api.posted.push(body);
    api.mine = {
      ...body,
      id: 100,
      product_id: 1,
      author: 'm***',
      stars: null,
      created_at: AT,
      updated_at: AT,
    };
    return jsonResponse(200, api.mine);
  }
  if (path === '/products/1/reviews') {
    const items = api.mine ? [api.mine, ...api.others] : api.others;
    return jsonResponse(200, { items, total: items.length, limit: 10, offset: 0 });
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
}

const fetchMock = jest.fn(fakeApi);
const originalFetch = globalThis.fetch;

beforeAll(() => Ionicons.loadFont());

beforeEach(() => {
  Object.assign(api, {
    others: [
      {
        id: 1,
        product_id: 1,
        title: null,
        body: 'Too sweet for me.',
        author: 'b***',
        stars: 2,
        created_at: '2026-10-01T12:00:00Z',
        updated_at: '2026-10-01T12:00:00Z',
      },
    ],
    mine: null,
    failWith: null,
    posted: [],
  });
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
  await screen.findByText('Too sweet for me.');
}

async function write(fields: { title?: string; body: string }) {
  if (fields.title !== undefined) {
    fireEvent.changeText(screen.getByLabelText('Title (optional)'), fields.title);
  }
  fireEvent.changeText(screen.getByLabelText('Review'), fields.body);
}

async function press(name: string) {
  await act(async () => fireEvent.press(screen.getByRole('button', { name })));
}

const postCalls = () =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'POST');

it('posts a valid review, which then appears in the list', async () => {
  await openReviews();
  await write({ title: 'Crisp and cold', body: 'Exactly what I wanted on a hot day.' });

  await press('Post review');

  expect(await screen.findByText('Thanks! Your review was posted.')).toBeOnTheScreen();
  expect(api.posted).toEqual([
    { title: 'Crisp and cold', body: 'Exactly what I wanted on a hot day.' },
  ]);
  expect(await screen.findByText('2 reviews')).toBeOnTheScreen();
  // The text field holds it too, so look for it among the listed reviews' text.
  expect(screen.getAllByText('Exactly what I wanted on a hot day.').length).toBeGreaterThan(0);
  expect(screen.getByText('m*** · Oct 21, 2026')).toBeOnTheScreen();
});

it('shows an error for a review that is too long, and does not post it', async () => {
  await openReviews();
  await write({ body: 'a'.repeat(2001) });

  expect(screen.getByText('2,001 / 2,000')).toBeOnTheScreen();
  await press('Post review');

  expect(
    screen.getByText('Your review is 2,001 characters; keep it to 2,000 or fewer.'),
  ).toBeOnTheScreen();
  expect(postCalls()).toHaveLength(0);
  expect(screen.getByText('1 review')).toBeOnTheScreen();
});

it('shows an error for an empty review, and does not post it', async () => {
  await openReviews();
  await write({ body: '   ' });

  await press('Post review');

  expect(screen.getByText('Write your review before posting.')).toBeOnTheScreen();
  expect(postCalls()).toHaveLength(0);
});

it('shows an error for a title that is too long', async () => {
  await openReviews();
  await write({ title: 't'.repeat(101), body: 'Fine.' });

  await press('Post review');

  expect(
    screen.getByText('Your title is 101 characters; keep it to 100 or fewer.'),
  ).toBeOnTheScreen();
  expect(postCalls()).toHaveLength(0);
});

it('sends no title when it is left blank', async () => {
  await openReviews();
  await write({ title: '  ', body: '  Good.  ' });

  await press('Post review');

  expect(api.posted).toEqual([{ title: null, body: 'Good.' }]);
});

it('starts with my earlier review, and updating replaces it', async () => {
  api.mine = {
    id: 100,
    product_id: 1,
    title: 'First take',
    body: 'Pretty good.',
    author: 'm***',
    stars: null,
    created_at: AT,
    updated_at: AT,
  };
  await openReviews();

  expect(await screen.findByText('Your review')).toBeOnTheScreen();
  expect(screen.getByLabelText('Review').props.value).toBe('Pretty good.');
  await write({ body: 'Even better the second time.' });

  await press('Update review');

  expect(await screen.findByText('Thanks! Your review was posted.')).toBeOnTheScreen();
  expect(api.posted).toEqual([{ title: 'First take', body: 'Even better the second time.' }]);
  expect(await screen.findByText('2 reviews')).toBeOnTheScreen();
});

it('asks me to sign in when my session is rejected', async () => {
  api.failWith = { status: 401, code: 'not_authenticated' };
  await openReviews();
  await write({ body: 'Fine.' });

  await press('Post review');

  expect(await screen.findByText('Sign in to review this product.')).toBeOnTheScreen();
});

it('keeps my text and shows the problem when posting fails', async () => {
  api.failWith = { status: 500, code: 'internal_error' };
  await openReviews();
  await write({ body: 'Fine.' });

  await press('Post review');

  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText(/Something went wrong/)).toBeOnTheScreen();
  expect(screen.getByLabelText('Review').props.value).toBe('Fine.');
  expect(screen.getByText('1 review')).toBeOnTheScreen();
});
