import type { MyRating } from '@/types/rating';

import { api, type CallOptions } from './client';

/** GET /products/{id}/ratings/me: the signed-in user's rating, or a 404 if they haven't rated. */
export function getMyRating(productId: number, options?: CallOptions) {
  return api.get<MyRating>(`/products/${productId}/ratings/me`, options);
}

/** POST /products/{id}/ratings: saves the signed-in user's 1-5 star rating (or changes it). */
export function rateProduct(productId: number, stars: number, options?: CallOptions) {
  return api.post<MyRating>(`/products/${productId}/ratings`, { stars }, options);
}

/** DELETE /products/{id}/ratings/me: removes the signed-in user's rating (404 if they had none). */
export function removeMyRating(productId: number, options?: CallOptions) {
  return api.delete(`/products/${productId}/ratings/me`, options);
}
