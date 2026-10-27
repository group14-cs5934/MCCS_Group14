// Shapes of the stores API (backend/app/schemas/store.py); update both together.

/** An MCCS store, from GET /locations. */
export type Store = {
  id: number;
  name: string;
  slug: string;
  address: string | null;
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

/** GET /products/{id}/availability: every store, in-stock stores first. */
export type ProductAvailability = {
  product_id: number;
  stores: StoreStock[];
};
