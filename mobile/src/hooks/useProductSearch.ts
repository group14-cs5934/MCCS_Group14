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

/** Narrows a search (T096); they combine the way the API's store and in_stock parameters do. */
export type SearchFilters = {
  /** Only products this store (its slug) carries; with inStock, only those in stock there. */
  store?: string | null;
  /** Only products in stock: at `store`, or at any store. */
  inStock?: boolean;
};

/**
 * Searches product names with GET /products/search (small typos are fine), optionally only
 * products a store carries or has in stock. Searches as soon as `query` or `filters` change, so
 * pass the query through useDebouncedValue to search only when typing pauses. A blank query
 * searches nothing. A search still running when they change is cancelled.
 */
export function useProductSearch(query: string, filters?: SearchFilters): ProductSearchState {
  const trimmed = query.trim();
  const store = filters?.store;
  const inStock = filters?.inStock;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    request: string;
    result: ApiResult<Product[]>;
  } | null>(null);
  // e.g. /products/search?q=chips&store=camp-lejeune-mcx&in_stock=true. Built here, not in a
  // helper function: the React Compiler can't keep reload's memoization across that call.
  const path =
    `/products/search?q=${encodeURIComponent(trimmed)}` +
    (store ? `&store=${encodeURIComponent(store)}` : '') +
    (inStock ? '&in_stock=true' : '');
  // Names the search this render wants, so an older search's results are never shown as current.
  const request = `${path}#${attempt}`;

  useEffect(() => {
    if (!trimmed) {
      return;
    }
    const controller = new AbortController();
    api
      .get<Product[]>(path, {
        signal: controller.signal,
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setLoaded({ request, result });
        }
      });
    return () => controller.abort();
  }, [trimmed, path, request]);

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
