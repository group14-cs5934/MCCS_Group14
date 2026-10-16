import { useCallback, useEffect, useState } from 'react';

import { api, type ApiError, type ApiResult } from '@/api';
import type { Product } from '@/types/product';

/** How long typing has to pause before the search screen searches. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Longest search the API accepts (the q parameter in backend/app/api/products.py). */
export const SEARCH_MAX_LENGTH = 100;

export type ProductSearchState = {
  /** What was searched for, trimmed; '' means nothing has been searched yet. */
  query: string;
  /** True until the current search finishes, including while retrying. */
  loading: boolean;
  /** Matching products, best match first; [] for no matches. Null until the search finishes. */
  results: Product[] | null;
  /** Set when the search failed; `error.message` is safe to show. */
  error: ApiError | null;
  /** Run the search again, e.g. from a Try Again button. */
  reload: () => void;
};

/**
 * Searches product names with GET /products/search (small typos are fine). Searches as soon as
 * `query` changes, so pass it through useDebouncedValue to search only when typing pauses. A
 * blank query searches nothing. A search still running when the query changes is cancelled.
 */
export function useProductSearch(query: string): ProductSearchState {
  const trimmed = query.trim();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    request: string;
    result: ApiResult<Product[]>;
  } | null>(null);
  // Names the search this render wants, so an older search's results are never shown as current.
  const request = `${trimmed}#${attempt}`;

  useEffect(() => {
    if (!trimmed) {
      return;
    }
    const controller = new AbortController();
    api
      .get<Product[]>(`/products/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setLoaded({ request, result });
        }
      });
    return () => controller.abort();
  }, [trimmed, request]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  if (!trimmed) {
    return { query: '', loading: false, results: null, error: null, reload };
  }
  const result = loaded?.request === request ? loaded.result : null;
  return {
    query: trimmed,
    loading: result === null,
    results: result?.ok ? result.data : null,
    error: result && !result.ok ? result.error : null,
    reload,
  };
}
