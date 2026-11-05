// Shapes of the admin product and stock API (backend/app/schemas/admin_product.py and store.py);
// update both together.

import type { Product } from '@/types/product';
import type { Store } from '@/types/store';

// Shoppers use stores too, so the type lives in store.ts; re-exported for the admin screens.
export type { Store };

/** How a product stands across every store (GET /admin/products), for the list's stock line. */
export type StockSummary = {
  /** Every store. */
  stores: number;
  in_stock: number;
  /** Of those in stock, how many are at or below the store's reorder point. */
  low: number;
  out: number;
  /** Stores with no stock record for the product. */
  unknown: number;
};

/** A product as admins see it: also which fields an admin set (the sync leaves those alone). */
export type AdminProduct = Product & { admin_fields: string[]; stock?: StockSummary | null };

/** One store's stock of a product, from GET /admin/products/{id}/stock. */
export type AdminStoreStock = {
  store: Store;
  in_stock: boolean;
  quantity: number | null;
  aisle: string | null;
  updated_at: string | null;
  /** When an admin set it; null when automatic updates (the product monitor) manage it. */
  admin_set_at: string | null;
  /** In stock but at or below the store's reorder point, when the API says. */
  low?: boolean;
};

export type AdminProductStock = {
  product_id: number;
  stores: AdminStoreStock[];
};

/** What POST /admin/products and PATCH /admin/products/{id} take. */
export type AdminProductBody = {
  barcode?: string;
  name?: string;
  description?: string | null;
  size?: string | null;
  image_url?: string | null;
  price?: string;
};

/** What PUT /admin/products/{id}/stock/{store_id} takes. */
/** Leaving out `aisle` keeps the store's aisle; null clears it. */
export type StockBody = { in_stock: boolean; quantity?: number; aisle?: string | null };
