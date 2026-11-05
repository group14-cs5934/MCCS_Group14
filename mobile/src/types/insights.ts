import type { ProductCard } from '@/types/cart';

/** GET /locations/{store_id}/popular: a product shoppers looked at a lot at the store lately. */
export type PopularProduct = {
  product: ProductCard;
  /** App views plus scans at this store in the last 30 days. */
  interest: number;
  /** Null when the store has no stock record for it. */
  in_stock: boolean | null;
  quantity: number | null;
  /** In stock but at or below the store's reorder point for it (as in the restock list). */
  low: boolean;
  aisle: string | null;
  /** Average stars, or null if unrated. */
  rating: number | null;
  rating_count: number;
};

/** GET /admin/overview: counts across every store. */
export type AdminOverview = {
  products: number;
  /** Accounts that aren't deactivated. */
  users: number;
  staff: number;
  admins: number;
  stores: number;
  /** Reviews written in the last 24 hours (hidden ones included). */
  reviews_today: number;
  /** Product and store pairs marked out of stock. */
  out_of_stock: number;
  /** In stock at or below the store's reorder point. */
  low_stock: number;
  /** Restock requests not yet closed. */
  open_reorders: number;
};
