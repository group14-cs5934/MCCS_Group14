import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';

import { SCAN_HOLD_MS } from '@/components/BarcodeScanner';
import { SEARCH_DEBOUNCE_MS } from '@/hooks/useProductSearch';
import type { Product } from '@/types/product';

// T048 acceptance: when scan, search, and product page are tested together, all flows complete
// without errors.
//
// Each test walks a whole Sprint 2 flow through the real app, starting from the Home tab, the way
// a shopper would: scanning, searching, opening products, and going back. The API is one fake
// that answers every endpoint those screens call, like the real one. The test fails if the app
// logs an error or warning anywhere along the way. The same flows on a phone are in the README
// ("Sprint 2 end-to-end check").

jest.mock('expo-camera', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    CameraView: (props: object) => createElement(View, props),
    useCameraPermissions: () => [
      { granted: true, canAskAgain: true, status: 'granted', expires: 'never' },
      jest.fn(),
      jest.fn(),
    ],
  };
});

function product(id: number, barcode: string, name: string, amount: string | null): Product {
  const at = '2026-10-16T12:00:00Z';
  return {
    id,
    barcode,
    name,
    description: null,
    size: '20 fl oz',
    image_url: null,
    brand_id: null,
    category_id: 1,
    brand: null,
    category: { id: 1, name: 'Soda', slug: 'soda', description: null },
    price: amount
      ? { id, product_id: id, amount, currency: 'USD', source: 'upcitemdb', observed_at: at }
      : null,
    source: 'upcitemdb',
    source_id: `0${barcode}`,
    last_synced_at: at,
    created_at: at,
    updated_at: at,
  };
}

const DIET_PEPSI = product(2, '012000171741', 'Diet Pepsi Cola Soda- 20 fl oz Bottle', '1.59');
const PEPSI = product(3, '012000001291', 'Pepsi Cola Soda - 20 fl oz Bottle', null);
const COKE = product(4, '049000418347', 'Coca-Cola Classic Soda 16.9 Ounce', '1.95');
const CATALOG = [DIET_PEPSI, PEPSI, COKE];
const UNKNOWN_UPC = '012345678905';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const notFound = { code: 'product_not_found', message: 'Product not found' };

/** The fake API: every endpoint the scan, search, and product screens call. */
async function fakeApi(url: string): Promise<Response> {
  const { pathname, searchParams } = new URL(url);
  const barcode = pathname.match(/^\/products\/barcode\/(\d+)$/)?.[1];
  if (barcode) {
    const found = CATALOG.find((candidate) => candidate.barcode === barcode);
    return found
      ? jsonResponse(200, found)
      : jsonResponse(404, { ...notFound, actions: ['retry_scan', 'manual_search'] });
  }
  if (pathname === '/products/search') {
    const query = (searchParams.get('q') ?? '').toLowerCase();
    return jsonResponse(
      200,
      CATALOG.filter((candidate) => query && candidate.name.toLowerCase().includes(query)),
    );
  }
  const id = Number(pathname.match(/^\/products\/(\d+)/)?.[1]);
  if (pathname.endsWith('/ratings')) {
    return jsonResponse(200, { product_id: id, average: 4.5, count: 2 });
  }
  if (pathname.endsWith('/ratings/me')) {
    return jsonResponse(404, { code: 'rating_not_found', message: 'Not rated' });
  }
  const found = CATALOG.find((candidate) => candidate.id === id);
  return found ? jsonResponse(200, found) : jsonResponse(404, notFound);
}

const fetchMock = jest.fn(fakeApi);
const originalFetch = globalThis.fetch;
let consoleError: jest.SpyInstance;
let consoleWarn: jest.SpyInstance;

beforeEach(() => {
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  consoleError = jest.spyOn(console, 'error');
  consoleWarn = jest.spyOn(console, 'warn');
});

afterEach(() => {
  // "Without errors": nothing went wrong in the app along the way.
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function scanBarcode(data: string, type = 'upc_a') {
  const camera = await screen.findByTestId('scanner-camera');
  fireEvent(camera, 'barcodeScanned', { type, data });
  for (let waited = 0; waited < SCAN_HOLD_MS; waited += 100) {
    jest.setSystemTime(Date.now() + 100);
    fireEvent(camera, 'barcodeScanned', { type, data });
  }
  await act(async () => {});
}

async function typeSearch(text: string) {
  fireEvent.changeText(await screen.findByLabelText('Search products'), text);
  await act(async () => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
}

async function expectProductPage(shown: Product, price: string) {
  expect(await screen.findByText(shown.name)).toBeOnTheScreen();
  expect(screen).toHavePathname(expect.stringMatching(/^\/product\//));
  expect(screen.getByText(price)).toBeOnTheScreen();
  expect(await screen.findByText('4.5')).toBeOnTheScreen(); // its average rating loaded too
}

it('scan: Home -> Scan tab -> scan a product -> its page -> back to the scanner', async () => {
  renderRouter('src/app', { initialUrl: '/' });
  fireEvent.press(await screen.findByRole('button', { name: 'Scan Product' }));
  expect(screen).toHavePathname('/scan');

  await scanBarcode(DIET_PEPSI.barcode);

  await expectProductPage(DIET_PEPSI, '$1.59');
  fireEvent.press(screen.getByRole('button', { name: 'Go back' }));
  expect(screen).toHavePathname('/scan');
  expect(screen.getByTestId('scanner-camera')).toBeOnTheScreen();
});

it('search: Home -> Search manually -> type -> open a result -> back to the results', async () => {
  renderRouter('src/app', { initialUrl: '/' });
  fireEvent.press(await screen.findByRole('button', { name: 'Search manually' }));
  expect(screen).toHavePathname('/search');

  await typeSearch('pepsi');
  fireEvent.press(await screen.findByLabelText(/^Diet Pepsi Cola Soda/));

  await expectProductPage(DIET_PEPSI, '$1.59');
  act(() => router.back());
  expect(screen).toHavePathname('/search');
  expect(screen.getByLabelText(/^Pepsi Cola Soda/)).toBeOnTheScreen(); // results are still there
});

it('unknown scan -> Product not found -> Search -> find it by name -> its page', async () => {
  renderRouter('src/app', { initialUrl: '/scan' });
  await scanBarcode(UNKNOWN_UPC);
  expect(await screen.findByText('Product not found')).toBeOnTheScreen();

  fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await typeSearch('coca');
  fireEvent.press(await screen.findByLabelText(/^Coca-Cola Classic/));

  await expectProductPage(COKE, '$1.95');
});

it('scan, then search, then scan again in one session', async () => {
  renderRouter('src/app', { initialUrl: '/scan' });

  await scanBarcode('0012000001291', 'ean13'); // iOS reads UPC-A as EAN-13
  await expectProductPage(PEPSI, 'No price yet');
  fireEvent.press(screen.getByRole('button', { name: 'Close product page' }));

  act(() => router.push('/search'));
  await typeSearch('diet');
  fireEvent.press(await screen.findByLabelText(/^Diet Pepsi Cola Soda/));
  await expectProductPage(DIET_PEPSI, '$1.59');

  act(() => router.replace('/scan'));
  await scanBarcode(COKE.barcode);
  await expectProductPage(COKE, '$1.95');
});

it('a search with no matches says so instead of failing', async () => {
  renderRouter('src/app', { initialUrl: '/search' });

  await typeSearch('kombucha');

  expect(await screen.findByText(/No products/i)).toBeOnTheScreen();
});
