import Ionicons from '@expo/vector-icons/Ionicons';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { getMe } from '@/api/me';
import type { Product } from '@/types/product';
import type { AdminReview } from '@/types/review';

// T098 acceptance: when an admin hides a review from the admin screen, it disappears from the
// product page. Admins can also show it again, and delete reviews.
//
// The API is faked like the real one: GET /admin/reviews lists every review (hidden ones too), and
// the product page's GET /products/1/reviews leaves hidden ones out.

const getMeMock = jest.mocked(getMe);

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

function review(id: number, email: string, body: string, stars: number): AdminReview {
  const at = `2026-10-${String(20 + id).padStart(2, '0')}T12:00:00Z`;
  return {
    id,
    product_id: 1,
    title: null,
    body,
    author: `${email[0]}***`,
    stars,
    created_at: at,
    updated_at: at,
    user_id: `u-${id}`,
    author_email: email,
    hidden: false,
    hidden_at: null,
  };
}

const LOVE_IT = 'Love it, crisp and sweet.';
const SPAM = 'Buy cheap soda at spam.example!';

const api = {
  reviews: [] as AdminReview[], // newest first
  /** What PATCH and DELETE /admin/reviews/{id} answer instead, if set. */
  moderationFails: null as { status: number; code: string } | null,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

async function fakeApi(url: string, init?: RequestInit): Promise<Response> {
  const { pathname, searchParams } = new URL(url);
  const method = init?.method ?? 'GET';
  const reviewId = Number(pathname.match(/^\/admin\/reviews\/(\d+)$/)?.[1]);

  if (pathname === '/admin/products') return jsonResponse(200, []);
  if (pathname === '/admin/reviews') {
    const hidden = searchParams.get('hidden');
    return jsonResponse(
      200,
      api.reviews.filter((item) => hidden === null || String(item.hidden) === hidden),
    );
  }
  if (reviewId && (method === 'PATCH' || method === 'DELETE')) {
    if (api.moderationFails) {
      return jsonResponse(api.moderationFails.status, { ...api.moderationFails, message: 'No' });
    }
    if (method === 'DELETE') {
      api.reviews = api.reviews.filter((item) => item.id !== reviewId);
      return jsonResponse(204, undefined);
    }
    const { hidden } = JSON.parse(init!.body as string) as { hidden: boolean };
    api.reviews = api.reviews.map((item) =>
      item.id === reviewId
        ? { ...item, hidden, hidden_at: hidden ? '2026-10-26T12:00:00Z' : null }
        : item,
    );
    return jsonResponse(
      200,
      api.reviews.find((item) => item.id === reviewId),
    );
  }

  if (pathname === '/products/1') return jsonResponse(200, PRODUCT);
  if (pathname === '/products/1/ratings') {
    return jsonResponse(200, { product_id: 1, average: null, count: 0 });
  }
  if (pathname === '/products/1/reviews') {
    // Like the real API: hidden reviews are left out, and don't count in the total.
    const items = api.reviews
      .filter((item) => !item.hidden)
      .map(({ id, product_id, title, body, author, stars, created_at, updated_at }) => ({
        id,
        product_id,
        title,
        body,
        author,
        stars,
        created_at,
        updated_at,
      }));
    return jsonResponse(200, { items, total: items.length, limit: 10, offset: 0 });
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
}

const fetchMock = jest.fn(fakeApi);
const originalFetch = globalThis.fetch;

/** Each PATCH or DELETE sent to /admin/reviews/{id}: method, path, and body. */
const moderationRequests = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH' || init?.method === 'DELETE')
    .map(([url, init]) => ({
      method: init!.method,
      path: new URL(url).pathname,
      ...(init!.body ? { body: JSON.parse(init!.body as string) } : {}),
    }));

beforeAll(() => Ionicons.loadFont());

beforeEach(() => {
  api.reviews = [
    review(2, 'spammer@example.com', SPAM, 1),
    review(1, 'alice@example.com', LOVE_IT, 5),
  ];
  api.moderationFails = null;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  getMeMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: 'user-1', email: 'admin@example.com', role: 'admin' },
  });
});

afterEach(() => {
  getMeMock.mockReset();
  // What jest.setup.ts gives every other test.
  getMeMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: 'user-1', email: 'shopper@example.com', role: 'user' },
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function openAdminReviews() {
  renderRouter('src/app', { initialUrl: '/admin' });
  await screen.findByText('No products yet.');
  fireEvent.press(screen.getByRole('tab', { name: 'Reviews' }));
  await screen.findByText(SPAM);
}

/** From a review in the admin area, opens its product page's Reviews tab. */
async function openProductReviewsFrom(email: string) {
  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: `View the product reviewed by ${email}` })),
  );
  expect(screen).toHavePathname('/product/1');
  await screen.findByText(PRODUCT.name);
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Reviews' })));
}

it('lists every review newest first, with its author, stars, and product', async () => {
  await openAdminReviews();

  expect(screen.getByText('2 reviews')).toBeOnTheScreen();
  expect(screen.getByText('spammer@example.com')).toBeOnTheScreen();
  expect(screen.getByText(LOVE_IT)).toBeOnTheScreen();
  expect(screen.getByLabelText('5 out of 5 stars')).toBeOnTheScreen();
  expect(screen.getByText('Product #1 · Oct 22, 2026')).toBeOnTheScreen();
  const bodies = screen.queryAllByText(/^(Love it|Buy cheap)/).map((node) => node.props.children);
  expect(bodies).toEqual([SPAM, LOVE_IT]);
});

it('hiding a review takes it off the product page', async () => {
  await openAdminReviews();

  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: 'Hide review by spammer@example.com' })),
  );

  expect(moderationRequests()).toEqual([
    { method: 'PATCH', path: '/admin/reviews/2', body: { hidden: true } },
  ]);
  // It stays in the admin list, marked hidden, so it can be shown again.
  expect(screen.getByText(SPAM)).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Show review by spammer@example.com' }),
  ).toBeOnTheScreen();

  await openProductReviewsFrom('spammer@example.com');

  expect(await screen.findByText(LOVE_IT)).toBeOnTheScreen();
  expect(screen.queryByText(SPAM)).not.toBeOnTheScreen();
  expect(screen.getByText('1 review')).toBeOnTheScreen();
});

it('showing a hidden review puts it back on the product page', async () => {
  api.reviews = api.reviews.map((item) => (item.id === 2 ? { ...item, hidden: true } : item));
  await openAdminReviews();

  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: 'Show review by spammer@example.com' })),
  );

  expect(moderationRequests()).toEqual([
    { method: 'PATCH', path: '/admin/reviews/2', body: { hidden: false } },
  ]);
  await openProductReviewsFrom('spammer@example.com');
  expect(await screen.findByText(SPAM)).toBeOnTheScreen();
  expect(screen.getByText('2 reviews')).toBeOnTheScreen();
});

it('filters to only hidden or only visible reviews', async () => {
  api.reviews = api.reviews.map((item) => (item.id === 2 ? { ...item, hidden: true } : item));
  await openAdminReviews();

  fireEvent.press(screen.getByRole('button', { name: 'Show hidden reviews' }));

  expect(await screen.findByText('1 hidden review')).toBeOnTheScreen();
  expect(screen.queryByText(LOVE_IT)).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Show hidden reviews' })).toBeSelected();
  const lastList = fetchMock.mock.calls.filter(([url]) => url.includes('/admin/reviews?')).at(-1)!;
  expect(new URL(lastList[0]).searchParams.get('hidden')).toBe('true');

  fireEvent.press(screen.getByRole('button', { name: 'Show visible reviews' }));

  expect(await screen.findByText('1 visible review')).toBeOnTheScreen();
  expect(screen.queryByText(SPAM)).not.toBeOnTheScreen();
});

it('deletes a review after the admin confirms', async () => {
  await openAdminReviews();

  fireEvent.press(screen.getByRole('button', { name: 'Delete review by spammer@example.com' }));
  expect(screen.getByText(/^Delete this review for good\?/)).toBeOnTheScreen();
  expect(moderationRequests()).toHaveLength(0);

  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: 'Delete review by spammer@example.com' })),
  );

  expect(moderationRequests()).toEqual([{ method: 'DELETE', path: '/admin/reviews/2' }]);
  expect(screen.queryByText(SPAM)).not.toBeOnTheScreen();
  expect(screen.getByText('1 review')).toBeOnTheScreen();
});

it('keeps the question open after a failed delete, so the admin can try again', async () => {
  api.moderationFails = { status: 500, code: 'internal_error' };
  await openAdminReviews();

  fireEvent.press(screen.getByRole('button', { name: 'Delete review by spammer@example.com' }));
  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: 'Delete review by spammer@example.com' })),
  );

  expect(screen.getByText(/^Couldn't delete this review\./)).toBeOnTheScreen();
  expect(screen.getByText(/^Delete this review for good\?/)).toBeOnTheScreen();

  api.moderationFails = null;
  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: 'Delete review by spammer@example.com' })),
  );

  expect(screen.queryByText(SPAM)).not.toBeOnTheScreen();
  expect(moderationRequests()).toHaveLength(2);
});

it('sends nothing when the admin cancels a delete', async () => {
  await openAdminReviews();

  fireEvent.press(screen.getByRole('button', { name: 'Delete review by spammer@example.com' }));
  fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByText(/^Delete this review for good\?/)).not.toBeOnTheScreen();
  expect(screen.getByText(SPAM)).toBeOnTheScreen();
  expect(moderationRequests()).toHaveLength(0);
});

it('says when a review no longer exists', async () => {
  api.moderationFails = { status: 404, code: 'review_not_found' };
  await openAdminReviews();

  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: 'Hide review by spammer@example.com' })),
  );

  expect(screen.getByText('This review no longer exists.')).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Hide review by spammer@example.com' }),
  ).toBeOnTheScreen();
});

it('shows "Admins only" if the API refuses the change', async () => {
  api.moderationFails = { status: 403, code: 'forbidden' };
  await openAdminReviews();

  await act(async () =>
    fireEvent.press(screen.getByRole('button', { name: 'Hide review by spammer@example.com' })),
  );

  expect(screen.getByText('Admins only')).toBeOnTheScreen();
});
