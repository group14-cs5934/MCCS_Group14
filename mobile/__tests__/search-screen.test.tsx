import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { SEARCH_DEBOUNCE_MS } from '@/hooks/useProductSearch';
import type { Product } from '@/types/product';

// T037 acceptance: when I type, the search runs only after I pause typing, not on every
// keystroke.

function product(id: number, name: string): Product {
  return {
    id,
    barcode: '036000291452',
    name,
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
    created_at: '2026-10-11T19:19:16Z',
    updated_at: '2026-10-11T19:19:16Z',
  };
}

const GROUND_COFFEE = product(1, 'Starbucks Ground Coffee');
const FOLGERS = product(2, 'Folgers Classic Roast Coffee');

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

/** The `q` of each search request so far. */
function searchedFor(): string[] {
  return fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('q') ?? '');
}

/** Every parameter of each search request so far, e.g. { q: 'coffee', in_stock: 'true' }. */
function searchParams(): Record<string, string>[] {
  return fetchMock.mock.calls.map(([url]) => Object.fromEntries(new URL(url).searchParams));
}

const searchBox = () => screen.getByLabelText('Search products');

/** Opens the search screen and waits for it to appear. */
async function openSearch() {
  renderRouter('src/app', { initialUrl: '/search' });
  await screen.findByLabelText('Search products');
}

/** Types `text` one character at a time, as fast as a person typing (no pause long enough). */
function typeQuickly(text: string) {
  for (let length = 1; length <= text.length; length++) {
    fireEvent.changeText(searchBox(), text.slice(0, length));
    act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS / 3));
  }
}

/** Waits long enough for the typing pause to count, and for the search request to be sent. */
async function pause() {
  // Async act also lets the request read the sign-in token (T039) before calling fetch.
  await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
}

beforeEach(async () => {
  await AsyncStorage.clear(); // no preferred store (T078) unless a test saves one
  jest.useFakeTimers();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

it('searches once, only after typing pauses, not on every keystroke', async () => {
  await openSearch();
  respondWith(200, [GROUND_COFFEE, FOLGERS]);

  typeQuickly('coffee');
  expect(fetchMock).not.toHaveBeenCalled();

  await pause();
  expect(searchedFor()).toEqual(['coffee']);

  expect(await screen.findByText('Starbucks Ground Coffee')).toBeOnTheScreen();
  expect(screen.getByText('Folgers Classic Roast Coffee')).toBeOnTheScreen();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('searches again after each pause', async () => {
  await openSearch();
  respondWith(200, [GROUND_COFFEE, FOLGERS]);
  respondWith(200, [FOLGERS]);

  typeQuickly('coffee');
  await pause();
  await screen.findByText('Starbucks Ground Coffee');

  typeQuickly('coffee folgers');
  await pause();

  expect(await screen.findByText('Folgers Classic Roast Coffee')).toBeOnTheScreen();
  expect(screen.queryByText('Starbucks Ground Coffee')).not.toBeOnTheScreen();
  expect(searchedFor()).toEqual(['coffee', 'coffee folgers']);
});

it('cancels a search that is still running when typing resumes', async () => {
  await openSearch();
  const signals: AbortSignal[] = [];
  fetchMock.mockImplementation((_url, init) => {
    signals.push(init.signal as AbortSignal);
    return new Promise(() => {}); // never answers
  });

  typeQuickly('cof');
  await pause();
  typeQuickly('coffee');
  await pause();

  expect(searchedFor()).toEqual(['cof', 'coffee']);
  expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
});

it('sends the search text exactly as typed, trimmed', async () => {
  await openSearch();
  fetchMock.mockReturnValue(new Promise(() => {}));

  fireEvent.changeText(searchBox(), '  ground coffee & tea ');
  await pause();

  expect(searchedFor()).toEqual(['ground coffee & tea']);
});

it('does not search for blank text', async () => {
  await openSearch();

  fireEvent.changeText(searchBox(), '   ');
  await pause();

  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByText('Find a product')).toBeOnTheScreen();
});

it('shows a spinner while searching', async () => {
  await openSearch();
  fetchMock.mockReturnValue(new Promise(() => {}));

  typeQuickly('coffee');
  await pause();

  expect(screen.getByText('Searching…')).toBeOnTheScreen();
});

it('says so when nothing matches', async () => {
  await openSearch();
  respondWith(200, []);

  typeQuickly('xqzv');
  await pause();

  expect(await screen.findByText('No results')).toBeOnTheScreen();
  expect(screen.getByText(/No products match "xqzv"/)).toBeOnTheScreen();
});

it('shows an error with Try Again, which searches again', async () => {
  await openSearch();
  fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  respondWith(200, [GROUND_COFFEE]);

  typeQuickly('coffee');
  await pause();
  fireEvent.press(await screen.findByRole('button', { name: 'Try Again' }));

  expect(await screen.findByText('Starbucks Ground Coffee')).toBeOnTheScreen();
  expect(searchedFor()).toEqual(['coffee', 'coffee']);
});

it('clearing the search clears the results right away', async () => {
  await openSearch();
  respondWith(200, [GROUND_COFFEE]);

  typeQuickly('coffee');
  await pause();
  await screen.findByText('Starbucks Ground Coffee');

  fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));

  expect(searchBox()).toHaveDisplayValue('');
  expect(screen.queryByText('Starbucks Ground Coffee')).not.toBeOnTheScreen();
  expect(screen.getByText('Find a product')).toBeOnTheScreen();
  await pause();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

// T038 acceptance: each result shows name, price, and photo; tapping one opens its product page.
it('shows each result’s name, price, and photo, and tapping one opens its product page', async () => {
  await openSearch();
  respondWith(200, [
    {
      ...FOLGERS,
      image_url: 'https://images.example.com/folgers.jpg',
      price: {
        id: 9,
        product_id: 2,
        amount: '8.99',
        currency: 'USD',
        source: null,
        observed_at: '2026-10-11T19:19:16Z',
      },
    },
  ]);

  typeQuickly('folgers');
  await pause();

  expect(await screen.findByText('Folgers Classic Roast Coffee')).toBeOnTheScreen();
  expect(screen.getByText('$8.99')).toBeOnTheScreen();
  expect(screen.getByLabelText('Photo of Folgers Classic Roast Coffee')).toHaveProp('source', {
    uri: 'https://images.example.com/folgers.jpg',
  });

  // The product page then loads the product; leave that request pending, it's not tested here.
  fetchMock.mockReturnValue(new Promise(() => {}));
  fireEvent.press(screen.getByText('Folgers Classic Roast Coffee'));
  expect(screen).toHavePathname('/product/2');
});

// T096: search can be narrowed to products in stock at the shopper's own store (T078), or at any
// store if they haven't picked one, using the API's store and in_stock filters (T075).
describe('In stock filter', () => {
  const LEJEUNE = { id: 1, name: 'Camp Lejeune MCX', slug: 'camp-lejeune-mcx' };

  /** Saves user-1's preferred store, as the store picker does. */
  async function preferStore(store: { id: number; name: string; slug?: string }) {
    await AsyncStorage.setItem('preferred-store:user-1', JSON.stringify(store));
  }

  /** Answers searches with `results`, and GET /locations/1 with Camp Lejeune MCX. */
  function fakeApi(results: Product[]) {
    fetchMock.mockImplementation(async (url) => {
      const body = new URL(url).pathname.startsWith('/locations/')
        ? { ...LEJEUNE, address: null, hours: null }
        : results;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    });
  }

  /** The parameters of each search request so far (not the store lookups). */
  const searches = () =>
    searchParams().filter((_, index) =>
      new URL(fetchMock.mock.calls[index][0]).pathname.endsWith('/search'),
    );

  /** Turns the filter on or off; the search runs again at once, without waiting for a pause. */
  async function toggle(name: string) {
    await act(async () => fireEvent.press(screen.getByRole('switch', { name })));
  }

  it("narrows to products in stock at the shopper's store", async () => {
    await preferStore(LEJEUNE);
    fakeApi([FOLGERS]);
    await openSearch();
    typeQuickly('coffee');
    await pause();

    await toggle('In stock at Camp Lejeune MCX');
    expect(screen.getByRole('switch', { name: 'In stock at Camp Lejeune MCX' })).toBeChecked();
    await toggle('In stock at Camp Lejeune MCX');

    expect(searches()).toEqual([
      { q: 'coffee' },
      { q: 'coffee', store: 'camp-lejeune-mcx', in_stock: 'true' },
      { q: 'coffee' },
    ]);
  });

  it('narrows to in stock at any store without a store, and offers to choose one', async () => {
    fakeApi([FOLGERS]);
    await openSearch();
    typeQuickly('coffee');
    await pause();

    await toggle('In stock at any store');

    expect(searches()).toEqual([{ q: 'coffee' }, { q: 'coffee', in_stock: 'true' }]);
    fireEvent.press(screen.getByRole('button', { name: 'Choose your store to filter by it' }));
    expect(screen).toHavePathname('/stores');
  });

  it('says the filter is on when nothing matches', async () => {
    await preferStore(LEJEUNE);
    fakeApi([]);
    await openSearch();
    await screen.findByRole('switch', { name: 'In stock at Camp Lejeune MCX' });
    await toggle('In stock at Camp Lejeune MCX');

    typeQuickly('coffee');
    await pause();

    expect(
      await screen.findByText(
        'No products match "coffee" in stock at Camp Lejeune MCX. Try turning off "In stock".',
      ),
    ).toBeOnTheScreen();
  });

  it('looks up the slug of a store saved without one, so it can filter by it', async () => {
    await preferStore({ id: 1, name: 'Camp Lejeune MCX' });
    fakeApi([]);
    await openSearch();

    expect(
      await screen.findByRole('switch', { name: 'In stock at Camp Lejeune MCX' }),
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Choose your store to filter by it' }),
    ).not.toBeOnTheScreen();
    expect(JSON.parse((await AsyncStorage.getItem('preferred-store:user-1'))!)).toEqual(LEJEUNE);
  });
});
