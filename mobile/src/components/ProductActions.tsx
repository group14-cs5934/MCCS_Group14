import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { addToCart } from '@/api/cart';
import { getSavedProduct, saveProduct, unsaveProduct } from '@/api/saved';
import Button from '@/components/Button';
import ErrorBanner from '@/components/ErrorBanner';
import { useCartCount } from '@/hooks/useCartCount';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';

/**
 * Save and Add to cart on the product page. Save flips at once and goes back if the API refuses;
 * adding shows a short confirmation with a link to the cart.
 */
export default function ProductActions({ productId }: { productId: number }) {
  const router = useRouter();
  const { setCount } = useCartCount();
  // Null until the API says whether it's saved (it answers 404 when not).
  const [saved, setSaved] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
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
      setAdded(true);
    } else {
      setAdded(false);
      setError(result.error.message);
    }
  }

  return (
    <View style={styles.container}>
      <View style={sharedStyles.row}>
        <Button
          title={saved ? 'Saved' : 'Save'}
          variant="secondary"
          icon={saved ? 'bookmark' : 'bookmark-outline'}
          onPress={toggleSaved}
          style={styles.button}
        />
        <Button
          title="Add to cart"
          icon="cart-outline"
          loading={adding}
          onPress={add}
          style={styles.button}
        />
      </View>
      {added ? (
        <View style={styles.added} accessibilityLiveRegion="polite">
          <Text style={styles.addedText}>Added to cart</Text>
          <Button title="View cart" variant="text" onPress={() => router.push('/cart')} />
        </View>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  button: {
    flex: 1,
    marginHorizontal: spacing.xs,
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
