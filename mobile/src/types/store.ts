// Shapes of the stores API (backend/app/schemas/store.py); update both together.

/** An MCCS store, from GET /locations and GET /locations/{id}. */
export type Store = {
  id: number;
  name: string;
  slug: string;
  address: string | null;
  /** Opening hours as the store words them, e.g. "Mon–Sat 9 AM–9 PM"; null if not listed. */
  hours: string | null;
};

/** Whether one store has a product. Mirrors StoreAvailability. */
export type StoreStock = {
  store: Store;
  /** False when out of stock, or when the store has no record of the product. */
  in_stock: boolean;
  /** Units on hand, if known. */
  quantity: number | null;
  /** Where it is in the store, e.g. "Aisle 7", if known. */
  aisle: string | null;
  /** When this store's stock was last updated; null if never. */
  updated_at: string | null;
};

/** A product and its stock at one store, as store staff see it (GET /staff/stores/{id}/stock). */
export type StaffStockRow = {
  product: {
    id: number;
    barcode: string;
    name: string;
    size: string | null;
    image_url: string | null;
  };
  /** False when out of stock, or when the store has no record of the product. */
  in_stock: boolean;
  quantity: number | null;
  aisle: string | null;
  /** When this store's stock was last updated; null if never. */
  updated_at: string | null;
  /** When an admin or the store's staff set it by hand; null when automatic updates manage it. */
  admin_set_at: string | null;
};

/** GET /products/{id}/availability: every store, in-stock stores first. */
export type ProductAvailability = {
  product_id: number;
  stores: StoreStock[];
};
