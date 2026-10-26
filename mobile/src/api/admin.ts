import type { AdminProduct, AdminProductBody, AdminProductStock, StockBody } from '@/types/admin';

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
