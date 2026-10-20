import { useCallback, useEffect, useState } from 'react';

import { api, type ApiError, type ApiResult } from '@/api';

export type ApiGetState<T> = {
  /** True until the current request finishes, including while retrying. */
  loading: boolean;
  /** The response, once it loads. */
  data: T | null;
  /** Set when loading failed; `error.message` is safe to show. */
  error: ApiError | null;
  /** Fetch it again, e.g. from a Try Again button. */
  reload: () => void;
};

/**
 * Loads GET `path` from the API. The request is cancelled if the screen closes or the path changes
 * before it finishes, and an older request's result is never shown for a newer path.
 */
export function useApiGet<T>(path: string): ApiGetState<T> {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ request: string; result: ApiResult<T> } | null>(null);
  // Names the request this render wants, so an older request's result is never shown as current.
  const request = `${path}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    api.get<T>(path, { signal: controller.signal }).then((result) => {
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
    data: result?.ok ? result.data : null,
    error: result && !result.ok ? result.error : null,
    reload,
  };
}
