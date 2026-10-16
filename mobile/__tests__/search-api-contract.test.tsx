import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { getApiBaseUrl } from '@/api';
import { SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH } from '@/hooks/useProductSearch';
import type { Product } from '@/types/product';
import { formatPrice } from '@/utils/formatPrice';

import apiResponse from './fixtures/search-api-response.json';

// T049 acceptance: when I search in the app, the results match what the API returns for the
// same query.
//
// fixtures/search-api-response.json is the real API's response to a search, recorded and kept
// up to date by backend/tests/test_search_contract.py (CI fails if the API stops returning
// exactly that). Here the app gets that same response and must show exactly those results.

const { query, results } = apiResponse as { query: string; results: Product[] };

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(results),
  } as unknown as Response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function search(text: string) {
  renderRouter('src/app', { initialUrl: '/search' });
  fireEvent.changeText(await screen.findByLabelText('Search products'), text);
  // Async act also lets the request read the sign-in token (T039) before calling fetch.
  await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
}

it('asks the API for the same query that was typed', async () => {
  await search(query);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${getApiBaseUrl()}/products/search?q=${query}`);
  expect(init.method).toBe('GET');
  await screen.findByText(results[0].name);
});

it('shows exactly the results the API returned, in the same order', async () => {
  await search(query);
  await screen.findByText(results[0].name);

  const rows = screen.getAllByRole('button', { name: /,/ });
  expect(rows.map((row) => row.props.accessibilityLabel)).toEqual(
    results.map((product) =>
      [
        product.name,
        product.size ?? product.category?.name,
        product.price ? formatPrice(product.price) : 'No price yet',
      ].join(', '),
    ),
  );
});

it('shows each result’s photo from the API', async () => {
  await search(query);
  await screen.findByText(results[0].name);

  for (const product of results.filter((result) => result.image_url)) {
    expect(screen.getByLabelText(`Photo of ${product.name}`)).toHaveProp('source', {
      uri: product.image_url,
    });
  }
  expect(results.some((result) => result.image_url)).toBe(true);
});

it('opens the product the API returned when a result is tapped', async () => {
  await search(query);
  const result = await screen.findByText(results[1].name);
  // The product page then loads the product; leave that request pending, it's not tested here.
  fetchMock.mockReturnValue(new Promise(() => {}));

  fireEvent.press(result);

  expect(screen).toHavePathname(`/product/${results[1].id}`);
});

it('never lets a search get longer than the API accepts', async () => {
  renderRouter('src/app', { initialUrl: '/search' });

  expect(await screen.findByLabelText('Search products')).toHaveProp(
    'maxLength',
    SEARCH_MAX_LENGTH,
  );
});
