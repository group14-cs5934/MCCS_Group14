import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { getCart } from '@/api/cart';
import { useAuth } from '@/auth';

type CartCountValue = {
  /** How many items (counting quantities) are in the signed-in user's cart. */
  count: number;
  /** Shows a new count, e.g. from the cart a change just returned, without asking the API again. */
  setCount: (count: number) => void;
};

const CartCountContext = createContext<CartCountValue | null>(null);

/**
 * Keeps the number on the Cart tab. It loads when someone signs in, and screens that change the
 * cart (the product page, Saved, Cart, checkout) call `setCount` with what the API returned.
 */
export function CartCountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  // Kept with the user it belongs to, so a previous user's count is never shown for the next.
  const [loaded, setLoaded] = useState<{ userId: string; count: number } | null>(null);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    getCart({ signal: controller.signal }).then((result) => {
      // A count set for this user while this loaded is newer, so it stays.
      if (result.ok && !controller.signal.aborted) {
        setLoaded((prev) =>
          prev?.userId === userId ? prev : { userId, count: result.data.item_count },
        );
      }
    });
    return () => controller.abort();
  }, [userId]);

  const setCount = useCallback(
    (count: number) => {
      if (userId) setLoaded({ userId, count });
    },
    [userId],
  );

  const value = useMemo<CartCountValue>(
    () => ({ count: loaded && loaded.userId === userId ? loaded.count : 0, setCount }),
    [loaded, userId, setCount],
  );

  return <CartCountContext.Provider value={value}>{children}</CartCountContext.Provider>;
}

export function useCartCount(): CartCountValue {
  const value = useContext(CartCountContext);
  if (!value) throw new Error('useCartCount must be used inside <CartCountProvider>.');
  return value;
}
