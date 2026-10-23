import type { ReviewPage } from '@/types/review';

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
