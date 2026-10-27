import Ionicons from '@expo/vector-icons/Ionicons';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { getMe } from '@/api/me';
import type { AdminStoreStock, Store } from '@/types/admin';
import type { Product } from '@/types/product';
import type { Role } from '@/types/user';

// T091 acceptance: when required fields are missing, the form will not submit; when valid, the
// product and stock levels are saved.
//
// The form runs against a fake admin API that remembers what was saved; each test checks which
// requests the form sent.

const getMeMock = jest.mocked(getMe);

const STORES: Store[] = [
  { id: 1, name: 'Camp Lejeune MCX', slug: 'camp-lejeune-mcx', address: null, hours: null },
  { id: 2, name: 'Quantico MCX', slug: 'quantico-mcx', address: null, hours: null },
];

const AT = '2026-10-26T12:00:00Z';

function product(id: number, fields: Partial<Product> = {}): Product {
  return {
    id,
    barcode: '036000291452',
    name: 'Sample Chips',
    description: null,
    size: '184g',
    image_url: null,
    brand_id: null,
    category_id: null,
    brand: null,
    category: null,
    price: {
      id: 1,
      product_id: id,
      amount: '3.49',
      currency: 'USD',
      source: 'admin',
      observed_at: AT,
    },
    source: null,
    source_id: null,
    last_synced_at: null,
    created_at: AT,
    updated_at: AT,
    ...fields,
  } as Product;
}

type Sent = { method: string; path: string; body: unknown };

/** The fake API's data, reset before each test. */
let products: Map<number, Product>;
let stock: Map<string, AdminStoreStock>; // by "productId:storeId"
let sent: Sent[];
let barcodeTaken: boolean;
let failStockAt: number | null; // a store ID whose stock save fails

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (body === null ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

function stockFor(productId: number) {
  return {
    product_id: productId,
    stores: STORES.map(
      (store) =>
        stock.get(`${productId}:${store.id}`) ?? {
          store,
          in_stock: false,
          quantity: null,
          aisle: null,
          updated_at: null,
          admin_set_at: null,
        },
    ),
  };
}

async function fakeApi(url: string, init: RequestInit): Promise<Response> {
  const path = new URL(url).pathname;
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body as string) : undefined;
  if (method !== 'GET') sent.push({ method, path, body });

  if (path === '/locations') return jsonResponse(200, STORES);
  if (path === '/admin/products' && method === 'POST') {
    if (barcodeTaken) return jsonResponse(409, { code: 'barcode_taken', message: 'Taken' });
    const id = 100 + products.size;
    const { price, ...fields } = body;
    const created = product(id, {
      ...fields,
      size: fields.size ?? null,
      price: price ? { ...product(id).price!, amount: price } : null,
    });
    products.set(id, created);
    return jsonResponse(201, { ...created, admin_fields: Object.keys(body) });
  }
  let match = path.match(/^\/products\/(\d+)$/);
  if (match) {
    const found = products.get(Number(match[1]));
    return found ? jsonResponse(200, found) : jsonResponse(404, { code: 'product_not_found' });
  }
  match = path.match(/^\/admin\/products\/(\d+)$/);
  if (match && method === 'PATCH') {
    const id = Number(match[1]);
    const updated = { ...products.get(id)!, ...body, updated_at: new Date().toISOString() };
    products.set(id, updated);
    return jsonResponse(200, { ...updated, admin_fields: Object.keys(body) });
  }
  match = path.match(/^\/admin\/products\/(\d+)\/stock$/);
  if (match) return jsonResponse(200, stockFor(Number(match[1])));
  match = path.match(/^\/admin\/products\/(\d+)\/stock\/(\d+)$/);
  if (match) {
    const [productId, storeId] = [Number(match[1]), Number(match[2])];
    const key = `${productId}:${storeId}`;
    if (method === 'PUT' && storeId === failStockAt) {
      return jsonResponse(500, { code: 'internal_error', message: 'Down' });
    }
    if (method === 'PUT') {
      stock.set(key, {
        store: STORES.find((store) => store.id === storeId)!,
        in_stock: body.in_stock,
        quantity: body.quantity ?? null,
        aisle: null,
        updated_at: AT,
        admin_set_at: AT,
      });
      return jsonResponse(200, stock.get(key));
    }
    if (method === 'DELETE') {
      const row = stock.get(key);
      if (row) stock.set(key, { ...row, admin_set_at: null });
      return jsonResponse(204, null);
    }
  }
  return jsonResponse(404, { code: 'not_found', message: 'Not Found' });
}

const fetchMock = jest.fn(fakeApi);
const originalFetch = globalThis.fetch;

function signedInAs(role: Role) {
  getMeMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: 'user-1', email: 'someone@example.com', role },
  });
}

beforeAll(() => Ionicons.loadFont());

beforeEach(() => {
  products = new Map([[7, product(7)]]);
  stock = new Map();
  sent = [];
  barcodeTaken = false;
  failStockAt = null;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  signedInAs('admin');
});

afterEach(() => {
  getMeMock.mockReset();
  signedInAs('user'); // what jest.setup.ts gives every other test
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const fill = (label: string, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);

const chooseStock = (store: string, choice: string) =>
  fireEvent.press(screen.getByRole('radio', { name: `${store}: ${choice}` }));

async function press(name: string) {
  await act(async () => fireEvent.press(screen.getByRole('button', { name })));
}

async function openNewForm() {
  renderRouter('src/app', { initialUrl: '/admin-product/new' });
  await screen.findByLabelText('Barcode (required)');
}

async function openEditForm(id = 7) {
  renderRouter('src/app', { initialUrl: `/admin-product/${id}` });
  await screen.findByDisplayValue('Sample Chips');
}

describe('adding a product', () => {
  it('won’t submit when required fields are missing', async () => {
    await openNewForm();

    await press('Add product');

    expect(screen.getByText('Enter the barcode.')).toBeOnTheScreen();
    expect(screen.getByText('Enter the product name.')).toBeOnTheScreen();
    expect(screen.getByText('Fix the highlighted fields.')).toBeOnTheScreen();
    expect(sent).toEqual([]);
  });

  it('won’t submit invalid fields either', async () => {
    await openNewForm();
    fill('Barcode (required)', '049000418348'); // last digit mistyped
    fill('Name (required)', 'Coke');
    fill('Price (USD)', '1.999');
    chooseStock('Quantico MCX', 'In stock');
    fill('Quantity at Quantico MCX (optional)', '0');

    await press('Add product');

    expect(
      screen.getByText("That barcode's last digit is wrong. Check it for typos."),
    ).toBeOnTheScreen();
    expect(screen.getByText(/Enter a price above 0/)).toBeOnTheScreen();
    expect(screen.getByText('Enter a whole number above 0, or leave it empty.')).toBeOnTheScreen();
    expect(sent).toEqual([]);
  });

  it('saves the product and its stock at each store when valid', async () => {
    await openNewForm();
    fill('Barcode (required)', '049000418347');
    fill('Name (required)', ' Coca-Cola Classic ');
    fill('Price (USD)', '1.95');
    chooseStock('Camp Lejeune MCX', 'Out of stock');
    chooseStock('Quantico MCX', 'In stock');
    fill('Quantity at Quantico MCX (optional)', '5');

    await press('Add product');

    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/admin/products',
        body: { barcode: '049000418347', name: 'Coca-Cola Classic', price: '1.95' },
      },
      { method: 'PUT', path: '/admin/products/101/stock/1', body: { in_stock: false } },
      { method: 'PUT', path: '/admin/products/101/stock/2', body: { in_stock: true, quantity: 5 } },
    ]);
    // It opens the new product for editing, showing what was saved.
    expect(await screen.findByText('Product added.')).toBeOnTheScreen();
    expect(screen).toHavePathname('/admin-product/101');
    expect(screen.getByDisplayValue('Coca-Cola Classic')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Camp Lejeune MCX: Out of stock' })).toBeChecked();
  });

  it('shows a taken barcode on the barcode field', async () => {
    barcodeTaken = true;
    await openNewForm();
    fill('Barcode (required)', '049000418347');
    fill('Name (required)', 'Coke');

    await press('Add product');

    expect(await screen.findByText('Another product already has this barcode.')).toBeOnTheScreen();
    expect(screen).toHavePathname('/admin-product/new');
  });
});

describe('editing a product', () => {
  it('sends only the fields that changed', async () => {
    await openEditForm();
    fill('Name (required)', 'Classic Chips');

    await press('Save changes');

    expect(sent).toEqual([
      { method: 'PATCH', path: '/admin/products/7', body: { name: 'Classic Chips' } },
    ]);
    expect(await screen.findByText('Saved.')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Classic Chips')).toBeOnTheScreen();
  });

  it('saves stock changes, and hands a store back to automatic updates', async () => {
    stock.set('7:1', {
      store: STORES[0],
      in_stock: false,
      quantity: null,
      aisle: null,
      updated_at: AT,
      admin_set_at: AT, // an admin marked it out of stock earlier
    });
    await openEditForm();
    expect(screen.getByRole('radio', { name: 'Camp Lejeune MCX: Out of stock' })).toBeChecked();

    chooseStock('Camp Lejeune MCX', 'Automatic');
    chooseStock('Quantico MCX', 'Out of stock');
    await press('Save changes');

    expect(sent).toEqual([
      { method: 'DELETE', path: '/admin/products/7/stock/1', body: undefined },
      { method: 'PUT', path: '/admin/products/7/stock/2', body: { in_stock: false } },
    ]);
    expect(await screen.findByText('Saved.')).toBeOnTheScreen();
  });

  it('won’t submit if a required field is emptied', async () => {
    await openEditForm();
    fill('Name (required)', '  ');

    await press('Save changes');

    expect(screen.getByText('Enter the product name.')).toBeOnTheScreen();
    expect(sent).toEqual([]);
  });

  it('links to the product in the app', async () => {
    await openEditForm();

    await press('View in app');

    expect(screen).toHavePathname('/product/7');
  });
});

describe('who can use it', () => {
  it('shows "Admins only" to regular users', async () => {
    signedInAs('user');

    renderRouter('src/app', { initialUrl: '/admin-product/new' });

    expect(await screen.findByText('Admins only')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Barcode (required)')).not.toBeOnTheScreen();
  });
});

describe('when saving only partly works', () => {
  it('opens a new product for editing even if some of its stock couldn’t be saved', async () => {
    failStockAt = 2;
    await openNewForm();
    fill('Barcode (required)', '049000418347');
    fill('Name (required)', 'Coke');
    chooseStock('Camp Lejeune MCX', 'Out of stock');
    chooseStock('Quantico MCX', 'Out of stock');

    await press('Add product');

    expect(
      await screen.findByText(
        "Product added, but its stock at Quantico MCX couldn't be saved. Set it again below.",
      ),
    ).toBeOnTheScreen();
    expect(screen).toHavePathname('/admin-product/101');
    // Saving again edits the product it created; it doesn't try to add it a second time.
    sent = [];
    failStockAt = null;
    chooseStock('Quantico MCX', 'Out of stock');
    await press('Save changes');
    expect(sent).toEqual([
      { method: 'PUT', path: '/admin/products/101/stock/2', body: { in_stock: false } },
    ]);
  });

  it('reloads after an edit whose stock partly failed, so a retry only sends what’s left', async () => {
    failStockAt = 2;
    await openEditForm();
    fill('Name (required)', 'Classic Chips');
    chooseStock('Quantico MCX', 'Out of stock');

    await press('Save changes');

    expect(await screen.findByText(/^Saved, except the stock at Quantico MCX/)).toBeOnTheScreen();
    sent = [];
    failStockAt = null;
    chooseStock('Quantico MCX', 'Out of stock');
    await press('Save changes');
    expect(sent).toEqual([
      { method: 'PUT', path: '/admin/products/7/stock/2', body: { in_stock: false } },
    ]); // the name was already saved, so it isn't sent again
  });
});

describe('other edge cases', () => {
  it('says a price can’t be removed instead of pretending to save it', async () => {
    await openEditForm();
    fill('Price (USD)', '');

    await press('Save changes');

    expect(screen.getByText(/A price can't be removed/)).toBeOnTheScreen();
    expect(sent).toEqual([]);
  });

  it('says there’s nothing to save when nothing changed', async () => {
    await openEditForm();

    await press('Save changes');

    expect(screen.getByText('Nothing to save: no changes.')).toBeOnTheScreen();
    expect(sent).toEqual([]);
  });

  it('shows "Product not found" for a link that isn’t a product', async () => {
    renderRouter('src/app', { initialUrl: '/admin-product/abc' });

    expect(await screen.findByText('Product not found')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Barcode (required)')).not.toBeOnTheScreen();
  });
});
