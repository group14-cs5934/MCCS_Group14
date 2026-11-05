import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/auth';

/** A product the user opened lately, as Home's "Recently viewed" row shows it. */
export type RecentProduct = {
  id: number;
  name: string;
  image_url: string | null;
  /** Exact decimal as a string, e.g. "3.49", or null with no price. */
  price: string | null;
  /** Average stars, or null if unrated or not loaded. */
  rating: number | null;
  /** ISO time it was last opened. */
  viewed_at: string;
};

/** How many products are kept, newest first. */
export const MAX_RECENT_PRODUCTS = 10;

/** Each user's list is saved under their own key, so people sharing a phone each keep theirs. */
const storageKey = (userId: string) => `recent-products:${userId}`;

function parse(saved: string | null): RecentProduct[] {
  try {
    const value: unknown = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is RecentProduct =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'number' &&
        typeof item.name === 'string',
    );
  } catch {
    return [];
  }
}

/** The user's recently opened products, newest first (empty if none or unreadable). */
export async function loadRecentProducts(userId: string): Promise<RecentProduct[]> {
  const saved = await AsyncStorage.getItem(storageKey(userId)).catch(() => null);
  return parse(saved);
}

/**
 * Puts a product at the front of the user's recent list (moving it if it's already there) and
 * keeps the newest MAX_RECENT_PRODUCTS. Saved on this device only; failures are ignored.
 */
export async function rememberProduct(
  userId: string,
  product: Omit<RecentProduct, 'viewed_at'>,
): Promise<void> {
  const current = await loadRecentProducts(userId);
  const next = [
    { ...product, viewed_at: new Date().toISOString() },
    ...current.filter((item) => item.id !== product.id),
  ].slice(0, MAX_RECENT_PRODUCTS);
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next)).catch(() => undefined);
}

/** The signed-in user's recent products, read again whenever the screen gains focus. */
export function useRecentProducts(): { products: RecentProduct[]; loading: boolean } {
  const { user } = useAuth();
  const userId = user?.id;
  const [loaded, setLoaded] = useState<{ userId: string; products: RecentProduct[] } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let cancelled = false;
      loadRecentProducts(userId).then((products) => {
        if (!cancelled) setLoaded({ userId, products });
      });
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  const current = loaded && loaded.userId === userId ? loaded : null;
  return { products: current?.products ?? [], loading: !!userId && !current };
}
