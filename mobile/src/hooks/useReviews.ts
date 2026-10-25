import { useCallback, useEffect, useRef, useState } from 'react';

import { getReviews } from '@/api';
import type { Review } from '@/types/review';

/** Reviews loaded per request; the API sends them newest first. */
export const REVIEWS_PAGE_SIZE = 10;

type Status =
  | 'idle' // not asked for yet (the Reviews tab hasn't been opened)
  | 'loading' // loading the first page
  | 'loading-more'
  | 'ready'
  | 'failed' // the first page couldn't be loaded
  | 'more-failed'; // a later page couldn't be loaded; the ones already shown stay

export type ReviewsState = {
  reviews: Review[];
  /** How many reviews the product has in all (more than `reviews` until every page is loaded). */
  total: number;
  /** True while the first page loads. */
  loading: boolean;
  /** True while the next page loads. */
  loadingMore: boolean;
  /** Why the first page couldn't be loaded, safe to show. */
  error: string | null;
  /** Why the next page couldn't be loaded, safe to show. */
  moreError: string | null;
  /** True while there are reviews not loaded yet. */
  hasMore: boolean;
  /** Load the next page, e.g. when the shopper scrolls to the bottom. Does nothing while a page
   * is loading or once every review is shown, so it's safe to call on every scroll event. */
  loadMore: () => void;
  /** Load the reviews again from the first page, e.g. after the shopper posts one. */
  reload: () => void;
};

/**
 * A product's reviews, a page at a time, from GET /products/{id}/reviews. Nothing is requested
 * until `enabled` is true, so the product page only asks once the Reviews tab is opened.
 */
export function useReviews(productId: number, enabled = true): ReviewsState {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  // Read by loadMore, which is called on every scroll event, so it never starts a second request.
  const loaded = useRef<Review[]>([]);
  const busy = useRef(false);
  const pending = useRef<AbortController | null>(null);

  // Requests the page that starts at `offset`; state only changes once the response arrives.
  const fetchPage = useCallback(
    (offset: number) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      busy.current = true;

      getReviews(
        productId,
        { offset, limit: REVIEWS_PAGE_SIZE },
        { signal: controller.signal },
      ).then((result) => {
        if (controller.signal.aborted) return;
        busy.current = false;
        if (!result.ok) {
          setError(result.error.message);
          setStatus(offset === 0 ? 'failed' : 'more-failed');
          return;
        }
        // A review posted since the last page shifts the pages by one, so skip any repeats.
        const earlier = offset === 0 ? [] : loaded.current;
        const seen = new Set(earlier.map((review) => review.id));
        const next = [...earlier, ...result.data.items.filter((review) => !seen.has(review.id))];
        loaded.current = next;
        setReviews(next);
        setTotal(result.data.total);
        setError(null);
        setStatus('ready');
      });
    },
    [productId],
  );

  useEffect(() => {
    if (!enabled) return;
    fetchPage(0);
    return () => {
      pending.current?.abort();
      busy.current = false;
    };
  }, [enabled, fetchPage]);

  const hasMore = status !== 'idle' && status !== 'failed' && reviews.length < total;

  const loadMore = useCallback(() => {
    if (busy.current || !hasMore) return;
    setStatus('loading-more');
    fetchPage(loaded.current.length);
  }, [fetchPage, hasMore]);

  const reload = useCallback(() => {
    setStatus('loading');
    fetchPage(0);
  }, [fetchPage]);

  return {
    reviews,
    total,
    loading: status === 'loading' || (enabled && status === 'idle'),
    loadingMore: status === 'loading-more',
    error: status === 'failed' ? error : null,
    moreError: status === 'more-failed' ? error : null,
    hasMore,
    loadMore,
    reload,
  };
}
