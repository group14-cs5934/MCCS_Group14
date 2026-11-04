// Shapes of the restock API (GET /staff/stores/{id}/restock and friends) and of the activity
// counter (POST /products/{id}/activity); update both together with the backend.

/** The product as the restock lists show it. */
export type RestockProduct = {
  id: number;
  barcode: string;
  name: string;
  size: string | null;
  image_url: string | null;
};

/** GET .../restock/summary: what needs restocking at a store. */
export type RestockSummary = {
  out: number;
  low: number;
  open_requests: number;
  /** The reorder point of every product that has none of its own. */
  default_reorder_point: number;
};

/** A request to reorder a product. It closes by itself once the stock is back above its point. */
export type RestockRequest = {
  id: number;
  product: RestockProduct;
  quantity: number;
  note: string | null;
  status: 'open' | 'restocked' | 'cancelled';
  requested_at: string;
  /** The requester's email. */
  requested_by: string | null;
  closed_at: string | null;
};

/** How much a product was looked at and how often it ran out. */
export type RestockStats = {
  views_30d: number;
  scans_30d: number;
  /** % change in views + scans against the 30 days before; null if there is no earlier data. */
  interest_change: number | null;
  /** Among the most viewed or scanned products at this store. */
  popular: boolean;
  stockouts_30d: number;
  stockouts_90d: number;
  days_out_30d: number;
  /** Estimated from quantity drops; null if quantities are unknown. */
  sold_per_day: number | null;
  /** At that rate, when in stock. */
  days_left: number | null;
};

/** One low or out-of-stock product (GET .../restock). */
export type RestockItem = {
  product: RestockProduct;
  status: 'out' | 'low';
  quantity: number | null;
  aisle: string | null;
  reorder_point: number;
  reorder_point_is_default: boolean;
  stats: RestockStats;
  /** The most recent request for this product here, open or not. */
  last_request: RestockRequest | null;
  suggested_quantity: number | null;
  /** A ready-to-show sentence. */
  advice: string | null;
};

export type RestockFilter = 'all' | 'out' | 'low';

/** Response of PUT .../restock/{product_id}/reorder-point. */
export type ReorderPoint = {
  reorder_point: number;
  reorder_point_is_default: boolean;
};

/** What a product-page open is counted as. */
export type ActivityKind = 'view' | 'scan';
