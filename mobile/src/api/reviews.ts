import type { Review, ReviewPage } from '@/types/review';

import { api, type CallOptions } from './client';

/** GET /products/{id}/reviews: one page of the product's reviews, newest first. */
export function getReviews(
  productId: number,
  page: { offset: number; limit: number },
  options?: CallOptions,
) {
  return api.get<ReviewPage>(
    `/products/${productId}/reviews?limit=${page.limit}&offset=${page.offset}`,
    options,
  );
}

/** GET /products/{id}/reviews/me: the signed-in user's review, or a 404 if they haven't written one. */
export function getMyReview(productId: number, options?: CallOptions) {
  return api.get<Review>(`/products/${productId}/reviews/me`, options);
}

/** POST /products/{id}/reviews: saves the signed-in user's review (or replaces their earlier one). */
export function postReview(
  productId: number,
  review: { title: string | null; body: string },
  options?: CallOptions,
) {
  return api.post<Review>(`/products/${productId}/reviews`, review, options);
}
