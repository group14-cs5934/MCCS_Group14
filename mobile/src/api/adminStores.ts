import type { Store } from '@/types/store';

import { api, type CallOptions } from './client';

/** What an admin sends for a store; null clears the address or hours. See StoreCreate/StoreUpdate. */
export type StoreBody = {
  name?: string;
  /** Without one, the API makes a slug from the name. */
  slug?: string;
  address?: string | null;
  hours?: string | null;
};

/** POST /admin/stores: adds a store (409 slug_taken; 422 lists each invalid field in details). */
export function createStore(body: StoreBody, options?: CallOptions) {
  return api.post<Store>('/admin/stores', body, options);
}

/** PATCH /admin/stores/{id}: changes only the fields sent (404 store_not_found; 409 slug_taken). */
export function updateStore(storeId: number, body: StoreBody, options?: CallOptions) {
  return api.patch<Store>(`/admin/stores/${storeId}`, body, options);
}

/** DELETE /admin/stores/{id}: removes the store and its stock records (404 store_not_found). */
export function deleteStore(storeId: number, options?: CallOptions) {
  return api.delete(`/admin/stores/${storeId}`, options);
}
