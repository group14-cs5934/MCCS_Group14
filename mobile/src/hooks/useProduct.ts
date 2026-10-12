import { useCallback, useEffect, useState } from 'react';

import { api, type ApiError, type ApiResult } from '@/api';
import type { Product } from '@/types/product';

export type ProductState = {
  /** True until the current request finishes, including while retrying. */
  loading: boolean;
  product: Product | null;
  /** Set when loading failed; `error.message` is safe to show, `error.status` is 404 if missing. */
  error: ApiError | null;
  /** Fetch the product again, e.g. from a Try Again button. */
  reload: () => void;
};

/** Loads one product from GET /products/{id}. */
export function useProduct(id: string): ProductState {
  return useProductAt(`/products/${encodeURIComponent(id)}`);
}

/** Loads the product with this barcode from GET /products/barcode/{code}, e.g. after a scan. */
export function useProductByBarcode(barcode: string): ProductState {
  return useProductAt(`/products/barcode/${encodeURIComponent(barcode)}`);
}

/**
 * Loads the product at this API path. The request is cancelled if the screen closes or the path
 * changes before it finishes.
 */
function useProductAt(path: string): ProductState {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ request: string; result: ApiResult<Product> } | null>(
    null,
  );
  // Names the request this render wants, so an older request's result is never shown as current.
  const request = `${path}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    api.get<Product>(path, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setLoaded({ request, result });
      }
    });
    return () => controller.abort();
  }, [path, request]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  const result = loaded?.request === request ? loaded.result : null;

  return {
    loading: result === null,
    product: result?.ok ? result.data : null,
    error: result && !result.ok ? result.error : null,
    reload,
  };
}
