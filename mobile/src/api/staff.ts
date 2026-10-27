// Store staff endpoints (backend/app/api/staff.py): a worker or manager acts on their own store;
// admins on any. Lists are loaded with useApiGet on /staff/stores/{id}/stock and .../staff.
import type { AdminStoreStock, StockBody } from '@/types/admin';
import type { AdminUserAccount } from '@/types/user';

import { api, type CallOptions } from './client';

/** PUT /staff/stores/{id}/stock/{product_id}: sets the product's stock at the store. */
export function setStoreStock(
  storeId: number,
  productId: number,
  body: StockBody,
  options?: CallOptions,
) {
  return api.put<AdminStoreStock>(`/staff/stores/${storeId}/stock/${productId}`, body, options);
}

/** DELETE /staff/stores/{id}/stock/{product_id}: hands it back to automatic updates. */
export function clearStoreStock(storeId: number, productId: number, options?: CallOptions) {
  return api.delete(`/staff/stores/${storeId}/stock/${productId}`, options);
}

/**
 * POST /staff/stores/{id}/staff (managers): makes someone a worker at the store, by the email they
 * signed up with (404 user_not_found, 409 already_staff or account_deactivated).
 */
export function addWorker(storeId: number, email: string, options?: CallOptions) {
  return api.post<AdminUserAccount>(`/staff/stores/${storeId}/staff`, { email }, options);
}

/** DELETE /staff/stores/{id}/staff/{user_id} (managers): makes a worker a regular user again. */
export function removeStaff(storeId: number, userId: string, options?: CallOptions) {
  return api.delete(`/staff/stores/${storeId}/staff/${userId}`, options);
}
