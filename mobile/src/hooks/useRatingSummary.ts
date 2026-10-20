import { useState } from 'react';

import { useApiGet } from '@/hooks/useApiGet';
import type { RatingSummary } from '@/types/rating';

export type RatingSummaryState = {
  loading: boolean;
  summary: RatingSummary | null;
  /** True if the ratings couldn't be loaded (the rest of the product page still works). */
  failed: boolean;
  /** Load the average again, e.g. after the user rates the product. */
  reload: () => void;
};

/**
 * Loads a product's average rating and count from GET /products/{id}/ratings. While it reloads,
 * the last average stays on screen, so the page doesn't flicker after a rating is saved.
 */
export function useRatingSummary(productId: number): RatingSummaryState {
  const { loading, data, error, reload } = useApiGet<RatingSummary>(
    `/products/${productId}/ratings`,
  );
  // Remembered across reloads. Setting state while rendering is React's pattern for "storing
  // information from previous renders": it re-renders straight away, before anything is shown.
  const [lastLoaded, setLastLoaded] = useState<RatingSummary | null>(null);
  if (data && data !== lastLoaded) {
    setLastLoaded(data);
  }
  const summary = data ?? (lastLoaded?.product_id === productId ? lastLoaded : null);

  return { loading: loading && !summary, summary, failed: !loading && error !== null, reload };
}
