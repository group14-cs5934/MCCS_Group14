import type { AdminProduct, AdminProductBody, AdminProductStock, StockBody } from '@/types/admin';
import type { AdminReview } from '@/types/review';
import type { AdminUserAccount, UserUpdateBody } from '@/types/user';

import { api, type CallOptions } from './client';

/** POST /admin/products: adds a product (409 barcode_taken if another has its barcode). */
export function createProduct(body: AdminProductBody, options?: CallOptions) {
  return api.post<AdminProduct>('/admin/products', body, options);
}

/** PATCH /admin/products/{id}: changes only the fields sent. */
export function updateProduct(productId: number, body: AdminProductBody, options?: CallOptions) {
  return api.patch<AdminProduct>(`/admin/products/${productId}`, body, options);
}

/** GET /admin/products/{id}/stock: the product at every store, with which ones an admin set. */
export function getProductStock(productId: number, options?: CallOptions) {
  return api.get<AdminProductStock>(`/admin/products/${productId}/stock`, options);
}

/** PUT /admin/products/{id}/stock/{store_id}: sets the product's stock at one store. */
export function setStock(
  productId: number,
  storeId: number,
  body: StockBody,
  options?: CallOptions,
) {
  return api.put(`/admin/products/${productId}/stock/${storeId}`, body, options);
}

/** DELETE /admin/products/{id}/stock/{store_id}: hands a store's stock back to automatic updates. */
export function clearStock(productId: number, storeId: number, options?: CallOptions) {
  return api.delete(`/admin/products/${productId}/stock/${storeId}`, options);
}

/**
 * PATCH /admin/users/{id}: changes a user's role and/or deactivates or reactivates them (404
 * user_not_found; 409 cannot_change_own_account for an admin's own role or account).
 */
export function updateUser(userId: string, body: UserUpdateBody, options?: CallOptions) {
  return api.patch<AdminUserAccount>(`/admin/users/${userId}`, body, options);
}

/**
 * PATCH /admin/reviews/{id}: hides a review from the product page, or shows it again (404
 * review_not_found). A hidden review stays in the database.
 */
export function setReviewHidden(reviewId: number, hidden: boolean, options?: CallOptions) {
  return api.patch<AdminReview>(`/admin/reviews/${reviewId}`, { hidden }, options);
}

/** DELETE /admin/reviews/{id}: removes a review for good (404 review_not_found). */
export function deleteReview(reviewId: number, options?: CallOptions) {
  return api.delete(`/admin/reviews/${reviewId}`, options);
}
