import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addToCart } from '@/api/cart';
import { getSavedProduct, saveProduct, unsaveProduct } from '@/api/saved';
import Button from '@/components/Button';
import ErrorBanner from '@/components/ErrorBanner';
import { useCartCount } from '@/hooks/useCartCount';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';

/** How long the "Added to cart" strip stays before it clears. */
const ADDED_VISIBLE_MS = 4000;

/**
 * The product page's bottom bar: Save and Add to cart. Save flips at once and goes back if the API refuses;
 * adding shows a short confirmation with a link to the cart.
 */
export default function ProductActions({ productId }: { productId: number }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setCount } = useCartCount();
  // Null until the API says whether it's saved (it answers 404 when not).
  const [saved, setSaved] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  // Counts adds (0 = none showing), so adding again restarts the clear-after timer.
  const [added, setAdded] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getSavedProduct(productId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      // Anything but a clear answer is shown as not saved, and tapping Save still works.
      setSaved((prev) => prev ?? result.ok);
    });
    return () => controller.abort();
  }, [productId]);

  // The "Added to cart" strip clears itself after a few seconds.
  useEffect(() => {
    if (added === 0) return;
    const timer = setTimeout(() => setAdded(0), ADDED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [added]);

  async function toggleSaved() {
    // One change at a time, so a quick second tap can't race the first.
    if (saving) return;
    const next = !saved;
    setSaved(next);
    setSaving(true);
    setError(null);
    const result = await (next ? saveProduct(productId) : unsaveProduct(productId));
    setSaving(false);
    if (!result.ok) {
      setSaved(!next);
      setError(result.error.message);
    }
  }

  async function add() {
    setAdding(true);
    setError(null);
    const result = await addToCart(productId);
    setAdding(false);
    if (result.ok) {
      setCount(result.data.item_count);
      setAdded((n) => n + 1);
    } else {
      setAdded(0);
      setError(result.error.message);
    }
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + spacing.md }]}>
      {error ? <ErrorBanner message={error} /> : null}
      {added > 0 ? (
        <View style={styles.added} accessibilityLiveRegion="polite">
          <Text style={styles.addedText}>Added to cart</Text>
          <Button title="View cart" variant="text" onPress={() => router.dismissTo('/cart')} />
        </View>
      ) : null}
      <View style={styles.bar}>
        <Button
          title={saved ? 'Saved' : 'Save'}
          variant="secondary"
          icon={saved ? 'bookmark' : 'bookmark-outline'}
          onPress={toggleSaved}
          style={styles.save}
        />
        <Button
          title="Add to cart"
          variant="action"
          icon="cart-outline"
          loading={adding}
          onPress={add}
          style={styles.add}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  bar: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  save: {
    flex: 1,
  },
  add: {
    flex: 1.6,
  },
  added: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
  },
  addedText: {
    ...textStyles.bodyStrong,
    color: colors.accent,
  },
});
