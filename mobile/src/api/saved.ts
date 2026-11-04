// Saved products endpoints (the Saved tab loads GET /me/saved itself): the shopper's own list.
import type { SavedProduct } from '@/types/cart';

import { api, type CallOptions } from './client';

/** GET /me/saved/{id}: 404 not_saved when it isn't saved. */
export function getSavedProduct(productId: number, options?: CallOptions) {
  return api.get<SavedProduct>(`/me/saved/${productId}`, options);
}

/** PUT /me/saved/{id}: saves it (idempotent). */
export function saveProduct(productId: number) {
  return api.put<SavedProduct>(`/me/saved/${productId}`);
}

/** DELETE /me/saved/{id}: un-saves it (idempotent). */
export function unsaveProduct(productId: number) {
  return api.delete(`/me/saved/${productId}`);
}
