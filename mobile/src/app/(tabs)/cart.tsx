import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ApiResult } from '@/api';
import { removeFromCart, saveForLater, setCartQuantity } from '@/api/cart';
import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import ProductLine from '@/components/ProductLine';
import { useCartCount } from '@/hooks/useCartCount';
import { useFocusGet } from '@/hooks/useFocusGet';
import { usePreferredStore } from '@/hooks/usePreferredStore';
import { colors, fonts, radius, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { Cart, CartItem } from '@/types/cart';

const MAX_QUANTITY = 99;

/** Cart tab: the lines to buy with their quantities, the subtotal, and Checkout. */
export default function CartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setCount } = useCartCount();
  const { store } = usePreferredStore();
  const { loading, data: cart, error, setData, retry } = useFocusGet<Cart>('/me/cart');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Keeps the tab's badge in step with whatever this screen last loaded.
  const itemCount = cart?.item_count;
  useEffect(() => {
    if (itemCount !== undefined) setCount(itemCount);
  }, [itemCount, setCount]);

  async function change(call: Promise<ApiResult<Cart>>) {
    setBusy(true);
    setActionError(null);
    const result = await call;
    setBusy(false);
    if (result.ok) setData(result.data);
    else setActionError(result.error.message);
  }

  return (
    <View style={sharedStyles.screen}>
      <AsyncContent
        loading={loading}
        error={cart ? null : error?.message}
        onRetry={retry}
        loadingMessage="Loading your cart…"
      >
        <FlatList
          data={cart?.items ?? []}
          keyExtractor={(item) => String(item.product.id)}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.titleRow}>
                <Text style={sharedStyles.title}>Cart</Text>
                {cart && cart.item_count > 0 ? (
                  <Text style={styles.count}>
                    {cart.item_count} {cart.item_count === 1 ? 'item' : 'items'}
                  </Text>
                ) : null}
                <Button
                  title="Your orders"
                  variant="text"
                  icon="receipt-outline"
                  onPress={() => router.push('/orders')}
                  style={styles.orders}
                />
              </View>
              {actionError ? <ErrorBanner message={actionError} /> : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name="cart-outline"
                size={textStyles.display.fontSize}
                color={colors.textMuted}
              />
              <Text style={sharedStyles.heading}>Your cart is empty</Text>
              <Text style={[sharedStyles.secondaryText, styles.center]}>
                Tap Add to cart on a product, or on one you saved.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <CartLine
              item={item}
              disabled={busy}
              onOpen={() => router.push(`/product/${item.product.id}`)}
              onQuantity={(quantity) => change(setCartQuantity(item.product.id, quantity))}
              onRemove={() => change(removeFromCart(item.product.id))}
              onSaveForLater={() => change(saveForLater(item.product.id))}
            />
          )}
        />
        {cart && cart.items.length > 0 ? (
          <View style={styles.panel}>
            <View style={styles.storeRow}>
              <Ionicons name="storefront-outline" size={sizes.icon} color={colors.textSecondary} />
              <Text style={styles.storeText}>
                Pickup or delivery
                {store ? ' from ' : ''}
                {store ? <Text style={styles.storeName}>{store.name}</Text> : null}
              </Text>
            </View>
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Subtotal</Text>
              <Text style={sharedStyles.price}>${cart.subtotal ?? '0.00'}</Text>
            </View>
            {cart.unpriced_items > 0 ? (
              <Text style={sharedStyles.secondaryText}>
                {cart.unpriced_items === 1
                  ? '1 item has no price yet and is not included.'
                  : `${cart.unpriced_items} items have no price yet and are not included.`}
              </Text>
            ) : null}
            <Button
              title="Checkout"
              variant="action"
              icon="arrow-forward"
              disabled={busy}
              onPress={() => router.push('/checkout')}
              style={styles.checkout}
            />
          </View>
        ) : null}
      </AsyncContent>
    </View>
  );
}

function CartLine({
  item,
  disabled,
  onOpen,
  onQuantity,
  onRemove,
  onSaveForLater,
}: {
  item: CartItem;
  disabled: boolean;
  onOpen: () => void;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  onSaveForLater: () => void;
}) {
  const { name, price } = item.product;
  return (
    <Card style={styles.card}>
      <ProductLine
        product={item.product}
        onOpen={onOpen}
        caption={
          price ? (
            <Text style={styles.each}>${price} each</Text>
          ) : (
            <Text style={styles.each}>No price yet</Text>
          )
        }
        trailing={item.line_total ? <Text style={styles.lineTotal}>${item.line_total}</Text> : null}
      />
      <View style={styles.controls}>
        <View style={styles.stepper}>
          <StepButton
            icon="remove"
            label={`Decrease quantity of ${name}`}
            disabled={disabled || item.quantity <= 1}
            onPress={() => onQuantity(item.quantity - 1)}
          />
          <Text style={styles.quantity} accessibilityLabel={`Quantity ${item.quantity}`}>
            {item.quantity}
          </Text>
          <StepButton
            icon="add"
            label={`Increase quantity of ${name}`}
            disabled={disabled || item.quantity >= MAX_QUANTITY}
            onPress={() => onQuantity(item.quantity + 1)}
          />
        </View>
        <Button
          title="Save for later"
          variant="text"
          disabled={disabled}
          onPress={onSaveForLater}
          accessibilityLabel={`Save ${name} for later`}
          style={styles.saveLater}
        />
        <Pressable
          onPress={onRemove}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name} from cart`}
          accessibilityState={{ disabled }}
          style={[styles.trash, disabled && styles.disabled]}
        >
          <Ionicons name="trash-outline" size={sizes.icon} color={colors.textSecondary} />
        </Pressable>
      </View>
    </Card>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.step, disabled && styles.disabled]}
    >
      <Ionicons name={icon} size={sizes.icon} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  header: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  titleRow: {
    ...sharedStyles.row,
    alignItems: 'baseline',
    gap: spacing.md,
  },
  count: {
    ...textStyles.bodyStrong,
    color: colors.textSecondary,
    flex: 1,
  },
  orders: {
    marginLeft: 'auto',
    minHeight: sizes.touch,
  },
  card: {
    gap: spacing.md,
    padding: spacing.md,
  },
  each: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  lineTotal: {
    ...textStyles.priceSmall,
    color: colors.textPrimary,
  },
  controls: {
    ...sharedStyles.row,
    gap: spacing.sm,
  },
  stepper: {
    ...sharedStyles.row,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  step: {
    width: sizes.touch,
    height: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  quantity: {
    ...textStyles.label,
    color: colors.textPrimary,
    minWidth: spacing.xl,
    textAlign: 'center',
  },
  saveLater: {
    marginLeft: 'auto',
    minHeight: sizes.touch,
  },
  trash: {
    width: sizes.touch,
    height: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  panel: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  storeRow: {
    ...sharedStyles.row,
    gap: spacing.sm,
  },
  storeText: {
    ...textStyles.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  storeName: {
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  subtotalRow: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
  },
  subtotalLabel: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  checkout: {
    minHeight: sizes.actionButton,
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
