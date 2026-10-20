import { useApiGet } from '@/hooks/useApiGet';
import type { RatingSummary } from '@/types/rating';

export type RatingSummaryState = {
  loading: boolean;
  summary: RatingSummary | null;
  /** True if the ratings couldn't be loaded (the rest of the product page still works). */
  failed: boolean;
};

/** Loads a product's average rating and count from GET /products/{id}/ratings. */
export function useRatingSummary(productId: number): RatingSummaryState {
  const { loading, data, error } = useApiGet<RatingSummary>(`/products/${productId}/ratings`);
  return { loading, summary: data, failed: error !== null };
}
