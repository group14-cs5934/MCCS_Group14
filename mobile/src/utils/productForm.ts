// The admin product form's rules (T091): what it checks before saving, and what it sends. Kept
// out of the screen so they can be tested on their own. The API checks the same rules again.

import type { AdminProductBody, AdminStoreStock, StockBody } from '@/types/admin';
import type { Product } from '@/types/product';
import { hasValidCheckDigit } from '@/utils/barcode';

/** What's typed into the form; every field is text. */
export type ProductFormValues = {
  barcode: string;
  name: string;
  description: string;
  size: string;
  imageUrl: string;
  price: string;
};

export type ProductFormErrors = Partial<Record<keyof ProductFormValues, string>>;

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  barcode: '',
  name: '',
  description: '',
  size: '',
  imageUrl: '',
  price: '',
};

/** The longest each field can be, matching the API (backend/app/schemas/product.py). */
export const MAX_LENGTHS = { name: 200, description: 2000, size: 50 } as const;

const BARCODE_LENGTHS = [8, 12, 13, 14];
const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

/** The form filled in with a product's current values. */
export function formValuesFrom(product: Product): ProductFormValues {
  return {
    barcode: product.barcode,
    name: product.name,
    description: product.description ?? '',
    size: product.size ?? '',
    imageUrl: product.image_url ?? '',
    price: product.price?.amount ?? '',
  };
}

/** A message for each field that's missing or invalid; empty means the form can be saved. */
export function validateProductForm(values: ProductFormValues): ProductFormErrors {
  const errors: ProductFormErrors = {};
  const barcode = values.barcode.trim();
  if (!barcode) {
    errors.barcode = 'Enter the barcode.';
  } else if (!/^\d+$/.test(barcode) || !BARCODE_LENGTHS.includes(barcode.length)) {
    errors.barcode = 'A barcode is 8, 12, 13, or 14 digits.';
  } else if (!hasValidCheckDigit(barcode)) {
    errors.barcode = "That barcode's last digit is wrong. Check it for typos.";
  }

  if (!values.name.trim()) errors.name = 'Enter the product name.';

  const price = values.price.trim();
  if (price && (!PRICE_PATTERN.test(price) || Number(price) <= 0)) {
    errors.price = 'Enter a price above 0 with up to 2 decimals, like 3.49.';
  }

  const imageUrl = values.imageUrl.trim();
  if (imageUrl && !/^https:\/\/\S+$/.test(imageUrl)) {
    errors.imageUrl = 'Use a full https:// link. Phones block plain http images.';
  }
  return errors;
}

export const hasProductErrors = (errors: ProductFormErrors) => Object.keys(errors).length > 0;

/** The values as the API takes them: trimmed, with empty optional fields as null. */
function toBody(values: ProductFormValues): Required<AdminProductBody> {
  const optional = (text: string) => text.trim() || null;
  return {
    barcode: values.barcode.trim(),
    name: values.name.trim(),
    description: optional(values.description),
    size: optional(values.size),
    image_url: optional(values.imageUrl),
    price: values.price.trim(),
  };
}

/** The body for adding a product: every field filled in. */
export function createBody(values: ProductFormValues): AdminProductBody {
  const { price, ...fields } = toBody(values);
  const body: AdminProductBody = { barcode: fields.barcode, name: fields.name };
  for (const key of ['description', 'size', 'image_url'] as const) {
    if (fields[key] !== null) body[key] = fields[key];
  }
  if (price) body.price = price;
  return body;
}

/**
 * The body for editing a product: only the fields that changed, so the product sync keeps
 * updating the ones the admin didn't touch (the API protects every field it's sent). An emptied
 * price is left unchanged, because a product's price history can't be removed.
 */
export function editBody(original: ProductFormValues, values: ProductFormValues): AdminProductBody {
  const before = toBody(original);
  const after = toBody(values);
  const body: AdminProductBody = {};
  for (const key of ['barcode', 'name', 'description', 'size', 'image_url'] as const) {
    if (after[key] !== before[key]) (body as Record<string, unknown>)[key] = after[key];
  }
  if (after.price && Number(after.price) !== Number(before.price || NaN)) body.price = after.price;
  return body;
}

// --- Stock ---

/** Who decides a store's stock: automatic updates, or the admin (in or out of stock). */
export type StockChoice = 'auto' | 'in' | 'out';

export type StockFormRow = {
  storeId: number;
  storeName: string;
  choice: StockChoice;
  /** Units on hand, as typed; only used when in stock. */
  quantity: string;
  /** What automatic updates last said, shown for 'auto' rows, e.g. "In stock (12)". */
  current: string;
};

/** The stock rows for a product's stores, as they are now. */
export function stockRowsFrom(stores: AdminStoreStock[]): StockFormRow[] {
  return stores.map((row) => ({
    storeId: row.store.id,
    storeName: row.store.name,
    choice: row.admin_set_at ? (row.in_stock ? 'in' : 'out') : 'auto',
    quantity: row.admin_set_at && row.quantity ? String(row.quantity) : '',
    current: describeStock(row),
  }));
}

function describeStock(row: AdminStoreStock): string {
  if (!row.updated_at) return 'No stock record yet';
  if (!row.in_stock) return 'Out of stock';
  return row.quantity ? `In stock (${row.quantity})` : 'In stock';
}

/** A message for each store whose quantity isn't a whole number above 0, by store ID. */
export function validateStock(rows: StockFormRow[]): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const row of rows) {
    const quantity = row.quantity.trim();
    if (row.choice === 'in' && quantity && !/^[1-9]\d*$/.test(quantity)) {
      errors[row.storeId] = 'Enter a whole number above 0, or leave it empty.';
    }
  }
  return errors;
}

export type StockChange =
  { storeId: number; action: 'set'; body: StockBody } | { storeId: number; action: 'clear' };

/**
 * What to save for each store that changed: the admin's choice for 'in' and 'out', and handing a
 * store back for 'auto' (when an admin had set it). Stores that didn't change aren't sent.
 */
export function stockChanges(original: StockFormRow[], rows: StockFormRow[]): StockChange[] {
  const before = new Map(original.map((row) => [row.storeId, row]));
  const changes: StockChange[] = [];
  for (const row of rows) {
    const was = before.get(row.storeId);
    const quantity = row.choice === 'in' ? row.quantity.trim() : '';
    if (was && was.choice === row.choice && (row.choice !== 'in' || was.quantity === quantity)) {
      continue;
    }
    if (row.choice === 'auto') {
      if (was && was.choice !== 'auto') changes.push({ storeId: row.storeId, action: 'clear' });
      continue;
    }
    const body: StockBody = { in_stock: row.choice === 'in' };
    if (quantity) body.quantity = Number(quantity);
    changes.push({ storeId: row.storeId, action: 'set', body });
  }
  return changes;
}
