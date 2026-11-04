import { useEffect, useRef } from 'react';

import { recordActivity } from '@/api';
import { usePreferredStore } from '@/hooks/usePreferredStore';
import type { ActivityKind } from '@/types/restock';

/**
 * Counts one view (or scan) of a product for the shopper's chosen store, once per product the page
 * opens on: not again on a re-render, a refresh or a change of store. Fire and forget: it waits for
 * nothing, shows nothing and never retries. Pass undefined while the product is still loading.
 */
export function useRecordActivity(productId: number | undefined, kind: ActivityKind): void {
  const { store, loading } = usePreferredStore();
  const storeId = store?.id;
  const counted = useRef<number | null>(null);

  useEffect(() => {
    // Waits for the saved store to load, so the count goes to the right store.
    if (productId === undefined || loading || counted.current === productId) return;
    counted.current = productId;
    void recordActivity(productId, kind, storeId);
  }, [productId, kind, storeId, loading]);
}
