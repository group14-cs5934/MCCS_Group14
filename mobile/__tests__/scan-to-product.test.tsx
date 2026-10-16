import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';

import { getApiBaseUrl } from '@/api';
import { SCAN_HOLD_MS } from '@/components/BarcodeScanner';
import type { Product } from '@/types/product';

// T043 acceptance: when I scan a product in the catalog, its product page shows the correct name
// and price.
// T050 acceptance: when a scan returns unknown, I see "Product not found" with Retry and Search
// buttons; tapping Search opens the search screen.
//
// This runs the whole app side of a scan: the camera reads a barcode, the app asks the API for
// that barcode, and the product page shows what came back. The API is faked with products from
// the sample catalog (backend/scripts/sample_products.json); backend/tests/test_seed_dev.py
// checks that the real API finds each of those products by the barcode the app sends here.

// Stand-in for the native camera with access already allowed. CameraView is a plain view, so a
// test can fire the same event the real camera sends when it reads a barcode.
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

/** A sample catalog product as the API returns it, priced in USD (or with no price). */
function catalogProduct(id: number, barcode: string, name: string, amount: string | null): Product {
  const seeded = '2026-10-16T12:00:00Z';
  return {
    id,
    barcode,
    name,
    description: null,
    size: null,
    image_url: null,
    brand_id: null,
    category_id: null,
    brand: null,
    category: null,
    price: amount
      ? {
          id,
          product_id: id,
          amount,
          currency: 'USD',
          source: 'UPCitemdb',
          observed_at: seeded,
        }
      : null,
    created_at: seeded,
    updated_at: seeded,
  };
}

const DIET_PEPSI = catalogProduct(
  2,
  '012000171741',
  'Diet Pepsi Cola Soda- 20 fl oz Bottle',
  '1.59',
);
const PEPSI = catalogProduct(3, '012000001291', 'Pepsi Cola Soda - 20 fl oz Bottle', null);
const KNIFE = catalogProduct(
  4,
  '4002293401102',
  'Wusthof Gourmet 3-Inch Serrated Paring Knife',
  '12.99',
);
const CATALOG = [DIET_PEPSI, PEPSI, KNIFE];

/** What the API answers for a barcode that isn't in the catalog (backend T044). */
const UNKNOWN_BARCODE_RESPONSE = {
  code: 'product_not_found',
  message: 'Product not found',
  actions: ['retry_scan', 'manual_search'],
};
/** A real, correctly formed barcode that isn't in CATALOG. */
const UNKNOWN_UPC = '012345678905';

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  // The fake API: GET /products/barcode/{code} returns the catalog product with that barcode, or
  // the real API's unknown-barcode 404, which tells the app to offer retry and manual search.
  fetchMock.mockImplementation(async (url) => {
    const code = url.match(/\/products\/barcode\/(\d+)$/)?.[1];
    const product = CATALOG.find((candidate) => candidate.barcode === code);
    const [status, body] = product ? [200, product] : [404, UNKNOWN_BARCODE_RESPONSE];
    return {
      ok: status === 200,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

/** Holds the open camera on a barcode long enough for it to count; it reads it every 100 ms. */
async function holdOn(type: string, data: string) {
  const camera = await screen.findByTestId('scanner-camera');
  // renderRouter turns on Jest's fake timers, which also fake the clock the scanner times with,
  // so time only passes here.
  fireEvent(camera, 'barcodeScanned', { type, data });
  for (let waited = 0; waited < SCAN_HOLD_MS; waited += 100) {
    jest.setSystemTime(Date.now() + 100);
    fireEvent(camera, 'barcodeScanned', { type, data });
  }
  // Let a request that settles right away (e.g. fails to connect) update the page inside act.
  await act(async () => {});
}

/** Opens the Scan tab and scans a barcode the scanner reports as `type`/`data`. */
async function scan(type: string, data: string) {
  renderRouter('src/app', { initialUrl: '/scan' });
  await holdOn(type, data);
}

it('shows the scanned product’s name and price', async () => {
  await scan('upc_a', DIET_PEPSI.barcode);

  expect(await screen.findByText(DIET_PEPSI.name)).toBeOnTheScreen();
  expect(screen.getByText('$1.59')).toBeOnTheScreen();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(`${getApiBaseUrl()}/products/barcode/012000171741`);
});

it('finds the same product when iOS reads the barcode as EAN-13', async () => {
  // iOS reports a UPC-A barcode as EAN-13 with a 0 in front.
  await scan('ean13', '0012000171741');

  expect(await screen.findByText(DIET_PEPSI.name)).toBeOnTheScreen();
  expect(screen.getByText('$1.59')).toBeOnTheScreen();
  expect(fetchMock.mock.calls[0][0]).toBe(`${getApiBaseUrl()}/products/barcode/012000171741`);
});

it('finds the product from the short UPC-E barcode on small packages', async () => {
  // 01212901 is the short form of the bottle's UPC-A 012000001291.
  await scan('upc_e', '01212901');

  expect(await screen.findByText(PEPSI.name)).toBeOnTheScreen();
  expect(screen.getByText('No price yet')).toBeOnTheScreen();
  expect(fetchMock.mock.calls[0][0]).toBe(`${getApiBaseUrl()}/products/barcode/012000001291`);
});

it('shows a product with a 13-digit EAN barcode', async () => {
  await scan('ean13', KNIFE.barcode);

  expect(await screen.findByText(KNIFE.name)).toBeOnTheScreen();
  expect(screen.getByText('$12.99')).toBeOnTheScreen();
});

describe('when the scanned barcode is unknown', () => {
  it('shows "Product not found" with Retry and Search buttons', async () => {
    await scan('upc_a', UNKNOWN_UPC);

    expect(await screen.findByText('Product not found')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Search' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeOnTheScreen();
    expect(fetchMock.mock.calls[0][0]).toBe(`${getApiBaseUrl()}/products/barcode/${UNKNOWN_UPC}`);
  });

  it('opens the search screen when Search is tapped, and Back returns to the scanner', async () => {
    await scan('upc_a', UNKNOWN_UPC);

    fireEvent.press(await screen.findByRole('button', { name: 'Search' }));

    expect(screen).toHavePathname('/search');
    expect(await screen.findByLabelText('Search products')).toBeOnTheScreen();

    act(() => router.back());
    expect(screen).toHavePathname('/scan');
  });

  it('goes back to the scanner to scan again when Retry is tapped', async () => {
    await scan('upc_a', UNKNOWN_UPC);

    fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));

    expect(screen).toHavePathname('/scan');
    expect(screen.getByTestId('scanner-camera')).toBeOnTheScreen();
  });

  it('can scan a known product after Retry', async () => {
    await scan('upc_a', UNKNOWN_UPC);
    fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));

    await holdOn('upc_a', DIET_PEPSI.barcode);

    expect(await screen.findByText(DIET_PEPSI.name)).toBeOnTheScreen();
  });

  it('still offers Try Again, not Retry and Search, when the server can’t be reached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await scan('upc_a', DIET_PEPSI.barcode);

    expect(await screen.findByRole('button', { name: 'Try Again' })).toBeOnTheScreen();
    expect(screen.queryByText('Product not found')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeOnTheScreen();
  });
});
