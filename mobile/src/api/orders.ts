// Demo order endpoint: placing an order takes no payment and doesn't change stock. The orders
// screens load GET /me/orders and GET /me/orders/{id} with useApiGet.
import type { Order, PlaceOrderBody } from '@/types/cart';

import { api } from './client';

/** POST /me/orders: orders the cart from one store and empties it. */
export function placeOrder(body: PlaceOrderBody) {
  return api.post<Order>('/me/orders', body);
}
