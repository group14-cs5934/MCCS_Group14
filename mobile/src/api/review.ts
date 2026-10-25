
import { api, type CallOptions } from './client';

export type Review = {
  id: number;
  product_id: number;
  user_id: string;
  title: string | null;
  body: string;
  created_at: string;
  updated_at: string;
};

export type ReviewList = {
  items: Review[];
  total: number;
};

export function getReviews(
  productId: number,
  options?: CallOptions
) {
  return api.get<ReviewList>(
    `/products/${productId}/reviews`,
    options
  );
}

export function saveReview(
  productId: number,
  body: string,
  title?: string
) {
  return api.post<Review>(
    `/products/${productId}/reviews`,
    {
      body,
      title: title?.trim() || null,
    }
  );
}

export function deleteMyReview(productId: number) {
  return api.delete(
    `/products/${productId}/reviews/me`
  );
}
