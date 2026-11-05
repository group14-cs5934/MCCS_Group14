import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// T016 acceptance: when the app opens, the home screen shows Scan and Search entry points.
// Redesign: scan-first header, "Recently viewed" (saved on the device), "Popular at {store}"
// (GET /locations/{id}/popular, faked below) and an account button.

const card = (id: number, name: string, price: string | null) => ({
  id,
  barcode: String(100 + id),
  name,
  size: null,
  image_url: null,
  price,
});

const POPULAR = [
  {
    product: card(7, 'Diet Cola', '6.49'),
    in_stock: true,
    quantity: 40,
    low: false,
    aisle: 'Aisle 7',
  },
  {
    product: card(8, 'Spring Water', '4.29'),
    in_stock: true,
    quantity: 3,
    low: true,
    aisle: 'Aisle 9',
  },
  {
    product: card(9, 'Protein Bar', '2.19'),
    in_stock: false,
    quantity: 0,
    low: false,
    aisle: 'Aisle 12',
  },
  {
    product: card(10, 'Plain Rice', '1.99'),
    in_stock: null,
    quantity: null,
    low: false,
    aisle: null,
  },
].map((row) => ({ ...row, interest: 5, rating: null, rating_count: 0 }));

/** True while GET /locations/{id}/popular fails. */
let popularFail = false;

const fetchMock = jest.fn(async (url: string) => {
  const { pathname } = new URL(url);
  const ok = pathname === '/locations/1/popular' && !popularFail;
  return {
    ok,
    status: ok ? 200 : 404,
    headers: { get: () => null },
    text: async () => JSON.stringify(ok ? POPULAR : { code: 'not_found', message: 'Not Found' }),
  } as unknown as Response;
});
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  await AsyncStorage.clear();
  popularFail = false;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('home screen', () => {
  it('opens on Home with Scan and Search entry points', async () => {
    renderRouter('src/app');

    expect(screen).toHavePathname('/');
    expect(await screen.findByText('What are you shopping for?')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Scan a barcode' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Search products or brands' })).toBeOnTheScreen();
    expect(screen.getByText('Choose store')).toBeOnTheScreen();
  });

  it('opens the Scan tab from Scan a barcode', async () => {
    renderRouter('src/app');

    fireEvent.press(await screen.findByRole('button', { name: 'Scan a barcode' }));
    expect(screen).toHavePathname('/scan');
  });

  it('opens Search from the search box', async () => {
    renderRouter('src/app');

    fireEvent.press(await screen.findByRole('button', { name: 'Search products or brands' }));
    expect(screen).toHavePathname('/search');
  });

  it('shows the initials of the signed-in email on the account button', async () => {
    renderRouter('src/app');

    expect(await screen.findByText('SH')).toBeOnTheScreen(); // shopper@example.com
  });
});

describe('recently viewed', () => {
  it('is hidden with nothing viewed', async () => {
    renderRouter('src/app');

    await screen.findByText('What are you shopping for?');
    expect(screen.queryByText('Recently viewed')).not.toBeOnTheScreen();
  });

  it('shows the products saved on this device and opens one', async () => {
    await AsyncStorage.setItem(
      'recent-products:user-1',
      JSON.stringify([
        {
          id: 3,
          name: 'Lays Sour Cream',
          image_url: null,
          price: '3.49',
          rating: 4.4,
          viewed_at: '2026-11-01T12:00:00Z',
        },
        {
          id: 4,
          name: 'Oat Milk',
          image_url: null,
          price: null,
          rating: null,
          viewed_at: '2026-10-31T12:00:00Z',
        },
      ]),
    );
    renderRouter('src/app');

    expect(await screen.findByText('Recently viewed')).toBeOnTheScreen();
    expect(screen.getByText('Lays Sour Cream')).toBeOnTheScreen();
    expect(screen.getByText('$3.49')).toBeOnTheScreen();
    expect(screen.getByText('4.4')).toBeOnTheScreen();
    expect(screen.getByText('Oat Milk')).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Open Lays Sour Cream' }));
    expect(screen).toHavePathname('/product/3');
  });
});

describe('popular at the store', () => {
  beforeEach(() =>
    AsyncStorage.setItem(
      'preferred-store:user-1',
      JSON.stringify({ id: 1, name: 'Quantico MCX', slug: 'quantico-mcx' }),
    ),
  );

  it('lists the store’s popular products with stock, aisle and price', async () => {
    renderRouter('src/app');

    expect(await screen.findByText('Popular at Quantico MCX')).toBeOnTheScreen();
    expect(await screen.findByText('Diet Cola')).toBeOnTheScreen();
    expect(screen.getByText('$6.49')).toBeOnTheScreen();
    expect(screen.getByText('Aisle 7')).toBeOnTheScreen();
    expect(screen.getByText('In stock')).toBeOnTheScreen();
    expect(screen.getByText('Low stock')).toBeOnTheScreen();
    expect(screen.getByText('Out of stock')).toBeOnTheScreen();
    expect(screen.getByText('Plain Rice')).toBeOnTheScreen(); // no stock record: no badge

    fireEvent.press(screen.getByRole('button', { name: 'Open Spring Water' }));
    expect(screen).toHavePathname('/product/8');
  });

  it('shows nothing when it cannot load', async () => {
    popularFail = true;
    renderRouter('src/app');

    await screen.findByText('Quantico MCX');
    await act(async () => {});
    expect(screen.queryByText(/^Popular at/)).not.toBeOnTheScreen();
  });

  it('is hidden with no store chosen', async () => {
    await AsyncStorage.clear();
    renderRouter('src/app');

    await screen.findByText('Choose store');
    expect(screen.queryByText(/^Popular at/)).not.toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/popular'),
      expect.anything(),
    );
  });
});

describe('account', () => {
  it('opens the Account screen from the initials button', async () => {
    renderRouter('src/app');

    fireEvent.press(await screen.findByRole('button', { name: 'Account' }));
    expect(screen).toHavePathname('/account');
  });
});
