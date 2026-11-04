// Shapes of the saved products, cart, checkout and orders API; update them with the backend.

import type { IsoDateTime } from './product';
import type { Store } from './store';

/** A product as the saved list, cart and orders show it. */
export type ProductCard = {
  id: number;
  barcode: string;
  name: string;
  size: string | null;
  image_url: string | null;
  /** Latest price as a decimal string, e.g. "3.49"; null if it has none. */
  price: string | null;
};

/** GET /me/saved, PUT and GET /me/saved/{product_id}. */
export type SavedProduct = {
  product: ProductCard;
  saved_at: IsoDateTime;
  in_cart: boolean;
};

export type CartItem = {
  product: ProductCard;
  /** 1 to 99. */
  quantity: number;
  line_total: string | null;
};

/** The shopper's cart, oldest line first. */
export type Cart = {
  items: CartItem[];
  /** Sum of the quantities. */
  item_count: number;
  /** Sum of the priced lines; null when the cart is empty. */
  subtotal: string | null;
  /** Lines whose product has no price (left out of the subtotal). */
  unpriced_items: number;
};

export type CheckStatus = 'available' | 'limited' | 'unavailable';

export type CheckItem = {
  product: ProductCard;
  quantity: number;
  status: CheckStatus;
  /** For 'limited': how many the store has. */
  available_quantity: number | null;
};

/** A store and how many of the cart's items it fully has. */
export type StoreOption = {
  store: Store;
  available_items: number;
  total_items: number;
};

/** GET /me/cart/check: the cart against one store. */
export type CartCheck = {
  store: Store;
  all_available: boolean;
  items: CheckItem[];
  /** Every store, best first. */
  stores: StoreOption[];
};

export type Fulfillment = 'pickup' | 'delivery';

export type OrderItem = {
  product_id: number | null;
  name: string;
  quantity: number;
  unit_price: string | null;
};

/** A demo order: no payment is taken and stock isn't changed. */
export type Order = {
  id: number;
  /** Display number, e.g. "R-1042". */
  number: string;
  store: { id: number | null; name: string };
  fulfillment: Fulfillment;
  delivery_address: string | null;
  contact_name: string | null;
  status: 'placed';
  placed_at: IsoDateTime;
  items: OrderItem[];
  item_count: number;
  total: string | null;
};

/** Body of POST /me/orders. */
export type PlaceOrderBody = {
  store_id: number;
  fulfillment: Fulfillment;
  delivery_address?: string;
  contact_name?: string;
};
