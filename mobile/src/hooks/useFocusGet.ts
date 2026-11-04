import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { api, type ApiError } from '@/api';

export type FocusGetState<T> = {
  /** True until the first load finishes, or while retrying. Later reloads keep showing the data. */
  loading: boolean;
  data: T | null;
  error: ApiError | null;
  /** Replaces the data, e.g. with the cart a change returned, or updates what's there now. */
  setData: (data: T | ((prev: T | null) => T)) => void;
  /** Fetch it again with the spinner, e.g. from a Try Again button. */
  retry: () => void;
};

/**
 * Loads GET `path` and loads it again every time the screen gains focus (e.g. its tab is opened),
 * so a list changed elsewhere is up to date. The old data stays on screen while it reloads.
 */
export function useFocusGet<T>(path: string): FocusGetState<T> {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; done: boolean }>({
    data: null,
    error: null,
    done: false,
  });

  const load = useCallback(
    (signal: AbortSignal) => {
      api.get<T>(path, { signal }).then((result) => {
        if (signal.aborted) return;
        setState((prev) =>
          result.ok
            ? { data: result.data, error: null, done: true }
            : { data: prev.data, error: result.error, done: true },
        );
      });
    },
    [path],
  );

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      load(controller.signal);
      return () => controller.abort();
    }, [load]),
  );

  const setData = useCallback(
    (data: T | ((prev: T | null) => T)) =>
      setState((prev) => ({
        data: typeof data === 'function' ? (data as (prev: T | null) => T)(prev.data) : data,
        error: null,
        done: true,
      })),
    [],
  );
  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, done: false }));
    load(new AbortController().signal);
  }, [load]);

  return { loading: !state.done, data: state.data, error: state.error, setData, retry };
}
