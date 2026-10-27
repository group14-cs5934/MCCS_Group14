import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api } from '@/api';
import { useAuth } from '@/auth';
import type { Store } from '@/types/store';

/**
 * The store a shopper picked: enough to show it, list it first, and filter searches by it
 * (T096), without loading it again. `slug` is missing for a store saved before it was kept.
 */
export type PreferredStore = Pick<Store, 'id' | 'name'> & { slug?: string };

type PreferredStoreValue = {
  /** The signed-in user's store, or null if they haven't picked one (or it's still loading). */
  store: PreferredStore | null;
  /** True while the saved store is read from the device. */
  loading: boolean;
  /** Saves the user's store on this device, or forgets it when given null. */
  setStore: (store: PreferredStore | null) => void;
};

const PreferredStoreContext = createContext<PreferredStoreValue | null>(null);

/** Each user's choice is saved under their own key, so people sharing a phone each keep theirs. */
const storageKey = (userId: string) => `preferred-store:${userId}`;

/** The saved store, or null if there's none or it isn't in the expected shape. */
function parse(saved: string | null): PreferredStore | null {
  try {
    const value: unknown = saved ? JSON.parse(saved) : null;
    if (typeof value !== 'object' || value === null) return null;
    const { id, name, slug } = value as Record<string, unknown>;
    if (typeof id !== 'number' || typeof name !== 'string') return null;
    return typeof slug === 'string' ? { id, name, slug } : { id, name };
  } catch {
    return null;
  }
}

/**
 * Provides the signed-in user's preferred store (T078), saved on the device so it's remembered
 * after the app is closed and reopened. Product pages list it first (T079).
 */
export function PreferredStoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  // Kept with the user ID it belongs to, so a previous user's store is never shown for the next.
  const [loaded, setLoaded] = useState<{ userId: string; store: PreferredStore | null } | null>(
    null,
  );

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    AsyncStorage.getItem(storageKey(userId))
      .catch(() => null) // unreadable storage is the same as nothing saved
      .then((saved) => {
        if (cancelled) return;
        // A store picked while this was loading is newer than what was saved, so it's kept.
        setLoaded((prev) => (prev?.userId === userId ? prev : { userId, store: parse(saved) }));
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const current = loaded && loaded.userId === userId ? loaded : null;

  // A store saved before its slug was kept can't filter searches (T096), so look it up once and
  // save it with the slug, instead of making the shopper pick their store again.
  const missingSlugId = current?.store && !current.store.slug ? current.store.id : null;
  useEffect(() => {
    if (!userId || missingSlugId === null) return;
    const controller = new AbortController();
    api.get<Store>(`/locations/${missingSlugId}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || !result.ok) return;
      const store = { id: result.data.id, name: result.data.name, slug: result.data.slug };
      // Only if it's still their store and still has no slug (they may have picked another).
      setLoaded((prev) =>
        prev?.userId === userId && prev.store?.id === store.id && !prev.store.slug
          ? { userId, store }
          : prev,
      );
      AsyncStorage.getItem(storageKey(userId))
        .then((saved) => {
          const stored = parse(saved);
          if (stored?.id === store.id && !stored.slug) {
            return AsyncStorage.setItem(storageKey(userId), JSON.stringify(store));
          }
        })
        .catch(() => {});
    });
    return () => controller.abort();
  }, [userId, missingSlugId]);

  const value = useMemo<PreferredStoreValue>(
    () => ({
      store: current?.store ?? null,
      loading: !!userId && !current,
      setStore: (store) => {
        if (!userId) return;
        setLoaded({ userId, store });
        // If saving fails, the choice still holds until the app closes.
        const key = storageKey(userId);
        const saved = store
          ? AsyncStorage.setItem(
              key,
              JSON.stringify({ id: store.id, name: store.name, slug: store.slug }),
            )
          : AsyncStorage.removeItem(key);
        saved.catch(() => {});
      },
    }),
    [current, userId],
  );

  return <PreferredStoreContext.Provider value={value}>{children}</PreferredStoreContext.Provider>;
}

export function usePreferredStore(): PreferredStoreValue {
  const value = useContext(PreferredStoreContext);
  if (!value) throw new Error('usePreferredStore must be used inside <PreferredStoreProvider>.');
  return value;
}
