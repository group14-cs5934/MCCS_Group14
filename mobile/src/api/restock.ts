// Restock endpoints (backend/app/api/staff.py): low and out-of-stock products at a store, with
// requests to reorder them, and the anonymous counters of product views and scans they draw on.
import type {
  ActivityKind,
  ReorderPoint,
  RestockFilter,
  RestockItem,
  RestockRequest,
  RestockSummary,
} from '@/types/restock';

import { api, type CallOptions } from './client';

/**
 * POST /products/{id}/activity: counts a product page view or a barcode scan, for the shopper's
 * chosen store if there is one. Fire and forget: it never throws and its result is ignored.
 */
export function recordActivity(productId: number, kind: ActivityKind, storeId?: number | null) {
  return api.post<null>(`/products/${productId}/activity`, {
    kind,
    ...(storeId != null && { store_id: storeId }),
  });
}

/** GET /staff/stores/{id}/restock/summary (view_restock): how many are out, low, requested. */
export function getRestockSummary(storeId: number, options?: CallOptions) {
  return api.get<RestockSummary>(`/staff/stores/${storeId}/restock/summary`, options);
}

/** GET /staff/stores/{id}/restock (view_restock): out before low, then by interest. */
export function getRestockItems(
  storeId: number,
  query: { status: RestockFilter; limit: number; offset: number },
  options?: CallOptions,
) {
  const params = new URLSearchParams({
    status: query.status,
    limit: String(query.limit),
    offset: String(query.offset),
  });
  return api.get<RestockItem[]>(`/staff/stores/${storeId}/restock?${params}`, options);
}

/** GET /staff/stores/{id}/restock/requests (view_restock): newest first. */
export function getRestockRequests(
  storeId: number,
  query: { status: 'open' | 'all'; limit: number; offset: number },
  options?: CallOptions,
) {
  const params = new URLSearchParams({
    status: query.status,
    limit: String(query.limit),
    offset: String(query.offset),
  });
  return api.get<RestockRequest[]>(`/staff/stores/${storeId}/restock/requests?${params}`, options);
}

/**
 * POST /staff/stores/{id}/restock/{product_id}/requests (request_restock): asks for a reorder
 * (409 restock_already_requested while one is open).
 */
export function requestRestock(
  storeId: number,
  productId: number,
  body: { quantity: number; note?: string },
  options?: CallOptions,
) {
  return api.post<RestockRequest>(
    `/staff/stores/${storeId}/restock/${productId}/requests`,
    body,
    options,
  );
}

/** DELETE .../restock/{product_id}/requests/open (request_restock): 404 no_open_request. */
export function cancelRestockRequest(storeId: number, productId: number, options?: CallOptions) {
  return api.delete(`/staff/stores/${storeId}/restock/${productId}/requests/open`, options);
}

/** PUT .../restock/{product_id}/reorder-point (request_restock): null uses the store's default. */
export function setReorderPoint(
  storeId: number,
  productId: number,
  reorderPoint: number | null,
  options?: CallOptions,
) {
  return api.put<ReorderPoint>(
    `/staff/stores/${storeId}/restock/${productId}/reorder-point`,
    { reorder_point: reorderPoint },
    options,
  );
}

/** PUT /staff/stores/{id}/restock/settings (request_restock): the store's default reorder point. */
export function setDefaultReorderPoint(
  storeId: number,
  defaultReorderPoint: number,
  options?: CallOptions,
) {
  return api.put<RestockSummary>(
    `/staff/stores/${storeId}/restock/settings`,
    { default_reorder_point: defaultReorderPoint },
    options,
  );
}
