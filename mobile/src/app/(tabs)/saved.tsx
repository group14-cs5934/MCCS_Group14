import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addToCart } from '@/api/cart';
import { unsaveProduct } from '@/api/saved';
import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import ErrorBanner from '@/components/ErrorBanner';
import { ProductImage } from '@/components/ProductLine';
import { useCartCount } from '@/hooks/useCartCount';
import { useFocusGet } from '@/hooks/useFocusGet';
import { colors, radius, shadows, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { SavedProduct } from '@/types/cart';

/** Saved tab: the products the shopper saved, newest first, reloaded whenever the tab opens. */
export default function SavedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  const rows = data ?? [];
  // An odd last card gets an empty neighbor so it stays half width.
  const cells: (SavedProduct | null)[] = rows.length % 2 === 1 ? [...rows, null] : rows;

  return (
    <View style={sharedStyles.screen}>
      <AsyncContent
        loading={loading}
        error={data ? null : error?.message}
        onRetry={retry}
        loadingMessage="Loading saved products…"
      >
        <FlatList
          data={cells}
          numColumns={2}
          keyExtractor={(item, index) => (item ? String(item.product.id) : `empty-${index}`)}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}
          columnWrapperStyle={styles.columns}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.titleRow}>
                <Text style={[sharedStyles.title, styles.title]}>Saved</Text>
                <Pressable
                  onPress={() => router.push('/orders')}
                  accessibilityRole="button"
                  accessibilityLabel="Your orders"
                  style={({ pressed }) => [styles.ordersPill, pressed && styles.pressed]}
                >
                  <Ionicons name="receipt-outline" size={sizes.icon} color={colors.textPrimary} />
                  <Text style={styles.ordersText}>Your orders</Text>
                </Pressable>
              </View>
              {rows.length > 0 ? (
                <Text style={sharedStyles.secondaryText}>
                  {rows.length === 1 ? '1 product' : `${rows.length} products`} to come back to
                </Text>
              ) : null}
              {actionError ? <ErrorBanner message={actionError} /> : null}
            </View>
          }
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
          renderItem={({ item }) =>
            item ? (
              <View style={styles.card}>
                <Pressable
                  onPress={() => router.push(`/product/${item.product.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.product.name}`}
                  style={({ pressed }) => [styles.open, pressed && styles.pressed]}
                >
                  <ProductImage
                    uri={item.product.image_url}
                    name={item.product.name}
                    style={styles.photo}
                  />
                  <Text style={styles.name} numberOfLines={2}>
                    {item.product.name}
                  </Text>
                  {item.product.price ? (
                    <Text style={styles.price}>${item.product.price}</Text>
                  ) : (
                    <Text style={styles.noPrice}>No price yet</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => remove(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.product.name} from saved`}
                  style={({ pressed }) => [styles.unsave, pressed && styles.pressed]}
                >
                  <Ionicons name="bookmark" size={sizes.icon} color={colors.textPrimary} />
                </Pressable>
                {item.in_cart ? (
                  <Pressable
                    onPress={() => router.navigate('/cart')}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.product.name} is in your cart`}
                    style={({ pressed }) => [styles.inCart, pressed && styles.pressed]}
                  >
                    <Ionicons name="checkmark" size={sizes.icon} color={colors.success} />
                    <Text style={styles.inCartText}>In cart</Text>
                  </Pressable>
                ) : (
                  <Button
                    title="Add to cart"
                    onPress={() => addItem(item)}
                    accessibilityLabel={`Add ${item.product.name} to cart`}
                    style={styles.add}
                  />
                )}
              </View>
            ) : (
              <View style={styles.cell} />
            )
          }
        />
      </AsyncContent>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  columns: {
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  titleRow: {
    ...sharedStyles.row,
    gap: spacing.md,
  },
  title: {
    flex: 1,
  },
  ordersPill: {
    ...sharedStyles.row,
    gap: spacing.xs,
    minHeight: sizes.touch,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ordersText: {
    ...textStyles.label,
    color: colors.textPrimary,
  },
  pressed: {
    opacity: 0.6,
  },
  cell: {
    flex: 1,
  },
  card: {
    flex: 1,
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  open: {
    gap: spacing.sm,
  },
  photo: {
    width: '100%',
    aspectRatio: 1.4, // wider than tall, as in the mockup
  },
  name: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
    // Two lines tall even for a one-line name, so the buttons line up across a row.
    minHeight: textStyles.bodyStrong.lineHeight * 2,
  },
  price: {
    ...textStyles.priceSmall,
    color: colors.textPrimary,
  },
  noPrice: {
    ...textStyles.caption,
    color: colors.textMuted,
    lineHeight: textStyles.priceSmall.lineHeight,
  },
  unsave: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: sizes.avatar,
    height: sizes.avatar,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  add: {
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  inCart: {
    ...sharedStyles.row,
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: sizes.touch,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
  },
  inCartText: {
    ...textStyles.label,
    color: colors.success,
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
