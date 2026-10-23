import Ionicons from '@expo/vector-icons/Ionicons';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import type { Product } from '@/types/product';

// T057 acceptance: when I submit a rating, the average on the page updates. When I am not signed
// in, I am asked to sign in before rating. A rating can also be removed again.
//
// The app only shows products to signed-in users, so "not signed in" here means the API rejects
// the user's session (401), e.g. because it expired or was revoked.

// A plain require gets the same mock instance the app imports (see auth.test.tsx).
type SupabaseMock = typeof import('../__mocks__/@supabase/supabase-js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mockAuth } = require('@supabase/supabase-js') as SupabaseMock;

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

/**
 * A fake ratings API that remembers ratings like the real one: other shoppers' stars, plus the
 * signed-in user's own rating (null until they rate). Set `failWith` to make the next calls fail.
 */
const api = {
  others: [] as number[],
  mine: null as number | null,
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

function summary() {
  const stars = api.mine === null ? api.others : [...api.others, api.mine];
  const average = stars.length
    ? Math.round((stars.reduce((sum, value) => sum + value, 0) / stars.length) * 100) / 100
    : null;
  return { product_id: PRODUCT.id, average, count: stars.length };
}

function myRating() {
  const at = '2026-10-20T12:00:00Z';
  return { product_id: PRODUCT.id, stars: api.mine, created_at: at, updated_at: at };
}

async function fakeApi(url: string, init: RequestInit): Promise<Response> {
  const path = new URL(url).pathname;
  if (path === '/products/1') return jsonResponse(200, PRODUCT);
  if (path === '/products/1/ratings' && init.method === 'GET') return jsonResponse(200, summary());
  if (api.failWith) {
    return jsonResponse(api.failWith.status, { code: api.failWith.code, message: 'Failed' });
  }
  if (path === '/products/1/ratings/me' && init.method === 'DELETE') {
    if (api.mine === null) return jsonResponse(404, { code: 'rating_not_found', message: 'None' });
    api.mine = null;
    return jsonResponse(204, null);
  }
  if (path === '/products/1/ratings/me') {
    return api.mine === null
      ? jsonResponse(404, { code: 'rating_not_found', message: 'Not rated' })
      : jsonResponse(200, myRating());
  }
  if (path === '/products/1/ratings' && init.method === 'POST') {
    const body = JSON.parse(init.body as string);
    api.posted.push(body);
    api.mine = body.stars;
    return jsonResponse(200, myRating());
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
}

const fetchMock = jest.fn(fakeApi);
const originalFetch = globalThis.fetch;

beforeAll(() => Ionicons.loadFont());

beforeEach(() => {
  mockAuth.reset(); // signed in
  Object.assign(api, { others: [], mine: null, failWith: null, posted: [] });
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function openProduct() {
  renderRouter('src/app', { initialUrl: '/product/1' });
  await screen.findByText(PRODUCT.name);
}

const star = (count: number) =>
  screen.getByRole('radio', { name: `${count} ${count === 1 ? 'star' : 'stars'}` });

/** The highlighted stars in the "Your rating" row, e.g. 4 after tapping the fourth. */
const myStars = () =>
  screen.getAllByRole('radio').filter((radio) => radio.props.accessibilityState.checked);

describe('submitting a rating', () => {
  it('updates the average on the page', async () => {
    api.others = [2];
    await openProduct();
    expect(await screen.findByText('2.0')).toBeOnTheScreen();
    expect(screen.getByText('(1 rating)')).toBeOnTheScreen();

    await act(async () => fireEvent.press(star(4)));

    expect(await screen.findByText('3.0')).toBeOnTheScreen();
    expect(screen.getByText('(2 ratings)')).toBeOnTheScreen();
    expect(screen.getByText('Thanks! Your rating was saved.')).toBeOnTheScreen();
    expect(api.posted).toEqual([{ stars: 4 }]);
  });

  it('replaces "No ratings yet" with the first rating', async () => {
    await openProduct();
    expect(await screen.findByText('No ratings yet')).toBeOnTheScreen();
    expect(await screen.findByText('Tap a star to rate this product.')).toBeOnTheScreen();

    await act(async () => fireEvent.press(star(5)));

    expect(await screen.findByText('5.0')).toBeOnTheScreen();
    expect(screen.getByText('(1 rating)')).toBeOnTheScreen();
    expect(screen.queryByText('No ratings yet')).not.toBeOnTheScreen();
  });

  it('shows my earlier rating, and changing it updates the average without adding one', async () => {
    api.others = [2];
    api.mine = 4;
    await openProduct();
    expect(await screen.findByText('Tap a star to change your rating.')).toBeOnTheScreen();
    expect(star(4)).toBeChecked();
    expect(screen.getByText('3.0')).toBeOnTheScreen();

    await act(async () => fireEvent.press(star(2)));

    expect(await screen.findByText('2.0')).toBeOnTheScreen();
    expect(screen.getByText('(2 ratings)')).toBeOnTheScreen();
    expect(star(2)).toBeChecked();
  });

  it('puts the stars back and says so when the rating can’t be saved', async () => {
    api.others = [2];
    await openProduct();
    await screen.findByText('Tap a star to rate this product.');
    api.failWith = { status: 500, code: 'internal_error' };

    await act(async () => fireEvent.press(star(4)));

    expect(
      await screen.findByText("Couldn't save your rating. Please try again."),
    ).toBeOnTheScreen();
    expect(myStars()).toHaveLength(0);
    expect(screen.getByText('2.0')).toBeOnTheScreen(); // the average didn't change
  });
});

describe('when not signed in', () => {
  it('asks me to sign in when I try to rate', async () => {
    await openProduct();
    await screen.findByText('Tap a star to rate this product.');
    api.failWith = { status: 401, code: 'not_authenticated' };

    await act(async () => fireEvent.press(star(4)));

    expect(await screen.findByText('Sign in to rate this product.')).toBeOnTheScreen();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(api.mine).toBeNull();
  });

  it('asks me to sign in straight away if the API already rejects my session', async () => {
    api.failWith = { status: 401, code: 'not_authenticated' };

    await openProduct();

    expect(await screen.findByText('Sign in to rate this product.')).toBeOnTheScreen();
  });

  it('opens the sign-in screen when I tap Sign In', async () => {
    api.failWith = { status: 401, code: 'not_authenticated' };
    await openProduct();
    await screen.findByText('Sign in to rate this product.');

    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Sign In' })));

    expect(await screen.findByText('Welcome back.')).toBeOnTheScreen();
    expect(screen).toHavePathname('/sign-in');
    expect(mockAuth.signOut).toHaveBeenCalled();
  });
});

describe('removing a rating', () => {
  const removeButton = () => screen.queryByRole('button', { name: 'Remove rating' });

  it('only offers to remove a rating once I have one', async () => {
    await openProduct();
    await screen.findByText('Tap a star to rate this product.');
    expect(removeButton()).not.toBeOnTheScreen();

    await act(async () => fireEvent.press(star(3)));

    expect(await screen.findByRole('button', { name: 'Remove rating' })).toBeOnTheScreen();
  });

  it('clears my stars and takes my rating out of the average', async () => {
    api.others = [2];
    api.mine = 4;
    await openProduct();
    expect(await screen.findByText('3.0')).toBeOnTheScreen();

    await act(async () => fireEvent.press(removeButton()!));

    expect(await screen.findByText('Your rating was removed.')).toBeOnTheScreen();
    expect(await screen.findByText('2.0')).toBeOnTheScreen();
    expect(screen.getByText('(1 rating)')).toBeOnTheScreen();
    expect(myStars()).toHaveLength(0);
    expect(removeButton()).not.toBeOnTheScreen();
    expect(api.mine).toBeNull();
  });

  it('shows "No ratings yet" again when mine was the only rating', async () => {
    api.mine = 5;
    await openProduct();
    await screen.findByText('5.0');

    await act(async () => fireEvent.press(removeButton()!));

    expect(await screen.findByText('No ratings yet')).toBeOnTheScreen();
  });

  it('can rate again after removing', async () => {
    api.mine = 5;
    await openProduct();
    await screen.findByText('5.0');
    await act(async () => fireEvent.press(removeButton()!));
    await screen.findByText('No ratings yet');

    await act(async () => fireEvent.press(star(2)));

    expect(await screen.findByText('2.0')).toBeOnTheScreen();
    expect(star(2)).toBeChecked();
  });

  it('keeps my rating and says so when it can’t be removed', async () => {
    api.mine = 4;
    await openProduct();
    await screen.findByText('4.0');
    api.failWith = { status: 500, code: 'internal_error' };

    await act(async () => fireEvent.press(removeButton()!));

    expect(
      await screen.findByText("Couldn't remove your rating. Please try again."),
    ).toBeOnTheScreen();
    expect(star(4)).toBeChecked();
    expect(removeButton()).toBeOnTheScreen();
  });

  it('asks me to sign in if my session is rejected', async () => {
    api.mine = 4;
    await openProduct();
    await screen.findByText('4.0');
    api.failWith = { status: 401, code: 'not_authenticated' };

    await act(async () => fireEvent.press(removeButton()!));

    expect(await screen.findByText('Sign in to rate this product.')).toBeOnTheScreen();
  });
});
