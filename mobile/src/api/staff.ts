// Store staff endpoints (backend/app/api/staff.py): staff act on their own store, as far as their
// store role's permissions allow; admins on any. Lists are loaded with useApiGet on
// /staff/permissions, /staff/stores/{id}/stock, .../roles and .../staff.
import type { AdminStoreStock, StockBody } from '@/types/admin';
import type { Store } from '@/types/store';
import type { AdminUserAccount, StoreRole } from '@/types/user';

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

/** Body of POST and PATCH on a store's roles: a name and the permission keys it allows. */
export type StoreRoleBody = { name?: string; permissions?: string[] };

/**
 * POST /staff/stores/{id}/roles (manage_roles): adds a role (409 role_name_taken; 403
 * beyond_your_permissions for permissions the caller lacks).
 */
export function createStoreRole(storeId: number, body: StoreRoleBody, options?: CallOptions) {
  return api.post<StoreRole>(`/staff/stores/${storeId}/roles`, body, options);
}

/** PATCH /staff/stores/{id}/roles/{role_id} (manage_roles): changes only the fields sent. */
export function updateStoreRole(
  storeId: number,
  roleId: number,
  body: StoreRoleBody,
  options?: CallOptions,
) {
  return api.patch<StoreRole>(`/staff/stores/${storeId}/roles/${roleId}`, body, options);
}

/** DELETE /staff/stores/{id}/roles/{role_id} (manage_roles): 409 role_in_use while anyone has it. */
export function deleteStoreRole(storeId: number, roleId: number, options?: CallOptions) {
  return api.delete(`/staff/stores/${storeId}/roles/${roleId}`, options);
}

/**
 * POST /staff/stores/{id}/staff (manage_staff): makes someone staff at the store with the role,
 * by the email they signed up with (404 user_not_found, 409 already_staff or account_deactivated).
 */
export function addStaff(storeId: number, email: string, roleId: number, options?: CallOptions) {
  return api.post<AdminUserAccount>(
    `/staff/stores/${storeId}/staff`,
    { email, role_id: roleId },
    options,
  );
}

/** PATCH /staff/stores/{id}/staff/{user_id} (manage_staff): gives them another role. */
export function changeStaffRole(
  storeId: number,
  userId: string,
  roleId: number,
  options?: CallOptions,
) {
  return api.patch<AdminUserAccount>(
    `/staff/stores/${storeId}/staff/${userId}`,
    { role_id: roleId },
    options,
  );
}

/** DELETE /staff/stores/{id}/staff/{user_id} (manage_staff): makes them a regular user again. */
export function removeStaff(storeId: number, userId: string, options?: CallOptions) {
  return api.delete(`/staff/stores/${storeId}/staff/${userId}`, options);
}

/** PATCH /staff/stores/{id} (edit_store_info): changes the store's address and/or hours. */
export function updateStoreInfo(
  storeId: number,
  body: { address?: string; hours?: string },
  options?: CallOptions,
) {
  return api.patch<Store>(`/staff/stores/${storeId}`, body, options);
}
