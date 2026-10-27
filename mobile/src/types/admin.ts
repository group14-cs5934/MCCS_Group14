// Shapes of the admin product and stock API (backend/app/schemas/admin_product.py and store.py);
// update both together.

import type { Product } from '@/types/product';
import type { Store } from '@/types/store';

// Shoppers use stores too, so the type lives in store.ts; re-exported for the admin screens.
export type { Store };

/** A product as admins see it: also which fields an admin set (the sync leaves those alone). */
export type AdminProduct = Product & { admin_fields: string[] };

/** One store's stock of a product, from GET /admin/products/{id}/stock. */
export type AdminStoreStock = {
  store: Store;
  in_stock: boolean;
  quantity: number | null;
  aisle: string | null;
  updated_at: string | null;
  /** When an admin set it; null when automatic updates (the product monitor) manage it. */
  admin_set_at: string | null;
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
export type StockBody = { in_stock: boolean; quantity?: number };
