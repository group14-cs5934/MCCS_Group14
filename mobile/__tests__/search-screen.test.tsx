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

beforeEach(() => {
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
