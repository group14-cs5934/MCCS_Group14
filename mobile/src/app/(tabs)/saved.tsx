import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { addToCart } from '@/api/cart';
import { unsaveProduct } from '@/api/saved';
import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import ProductLine from '@/components/ProductLine';
import { useCartCount } from '@/hooks/useCartCount';
import { useFocusGet } from '@/hooks/useFocusGet';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';
import type { SavedProduct } from '@/types/cart';

/** Saved tab: the products the shopper saved, newest first, reloaded whenever the tab opens. */
export default function SavedScreen() {
  const router = useRouter();
  const { setCount } = useCartCount();
  const { loading, data, error, setData, retry } = useFocusGet<SavedProduct[]>('/me/saved');
  const [actionError, setActionError] = useState<string | null>(null);

  async function remove(item: SavedProduct) {
    setActionError(null);
    const result = await unsaveProduct(item.product.id);
    if (result.ok) {
      setData((rows) => (rows ?? []).filter((row) => row.product.id !== item.product.id));
    } else {
      setActionError(result.error.message);
    }
  }

  async function addItem(item: SavedProduct) {
    setActionError(null);
    const result = await addToCart(item.product.id);
    if (result.ok) {
      setCount(result.data.item_count);
      setData((rows) =>
        (rows ?? []).map((row) =>
          row.product.id === item.product.id ? { ...row, in_cart: true } : row,
        ),
      );
    } else {
      setActionError(result.error.message);
    }
  }

  return (
    <View style={sharedStyles.screen}>
      <AsyncContent
        loading={loading}
        error={data ? null : error?.message}
        onRetry={retry}
        loadingMessage="Loading saved products…"
      >
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => String(item.product.id)}
          contentContainerStyle={sharedStyles.screenContent}
          ListHeaderComponent={actionError ? <ErrorBanner message={actionError} /> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name="bookmark-outline"
                size={textStyles.display.fontSize}
                color={colors.textMuted}
              />
              <Text style={sharedStyles.heading}>Nothing saved yet</Text>
              <Text style={[sharedStyles.secondaryText, styles.center]}>
                Tap Save on a product to keep it here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <ProductLine
                product={item.product}
                onOpen={() => router.push(`/product/${item.product.id}`)}
              />
              <View style={styles.actions}>
                {item.in_cart ? (
                  <Button
                    title="In cart"
                    variant="secondary"
                    icon="checkmark"
                    disabled
                    onPress={() => {}}
                    accessibilityLabel={`${item.product.name} is in your cart`}
                    style={styles.action}
                  />
                ) : (
                  <Button
                    title="Add to cart"
                    icon="cart-outline"
                    onPress={() => addItem(item)}
                    accessibilityLabel={`Add ${item.product.name} to cart`}
                    style={styles.action}
                  />
                )}
                <Button
                  title="Remove"
                  variant="text"
                  onPress={() => remove(item)}
                  accessibilityLabel={`Remove ${item.product.name} from saved`}
                />
              </View>
            </Card>
          )}
        />
      </AsyncContent>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  actions: {
    ...sharedStyles.row,
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
  },
  center: {
    textAlign: 'center',
  },
});
