// Cart endpoints and the checkout check; every call returns the updated cart.
import type { Cart, CartCheck } from '@/types/cart';

import { api, type CallOptions } from './client';

/** GET /me/cart. */
export function getCart(options?: CallOptions) {
  return api.get<Cart>('/me/cart', options);
}

/** POST /me/cart/{id}: adds to the quantity already there (capped at 99). */
export function addToCart(productId: number, quantity = 1) {
  return api.post<Cart>(`/me/cart/${productId}`, { quantity });
}

/** PUT /me/cart/{id}: sets the quantity (1 to 99). */
export function setCartQuantity(productId: number, quantity: number) {
  return api.put<Cart>(`/me/cart/${productId}`, { quantity });
}

/** DELETE /me/cart/{id}. */
export function removeFromCart(productId: number) {
  return api.delete<Cart>(`/me/cart/${productId}`);
}

/** POST /me/cart/{id}/save-for-later: moves it from the cart to Saved. */
export function saveForLater(productId: number) {
  return api.post<Cart>(`/me/cart/${productId}/save-for-later`);
}

/** GET /me/cart/check: whether `storeId` has everything in the cart, and how the other stores do. */
export function checkCart(storeId: number, options?: CallOptions) {
  return api.get<CartCheck>(`/me/cart/check?store_id=${storeId}`, options);
}
