import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ApiResult } from '@/api';
import { removeFromCart, saveForLater, setCartQuantity } from '@/api/cart';
import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import ProductLine from '@/components/ProductLine';
import { useCartCount } from '@/hooks/useCartCount';
import { useFocusGet } from '@/hooks/useFocusGet';
import { colors, radius, sharedStyles, spacing, textStyles } from '@/theme';
import type { Cart, CartItem } from '@/types/cart';

const MAX_QUANTITY = 99;

/** Cart tab: the lines to buy with their quantities, the subtotal, and Checkout. */
export default function CartScreen() {
  const router = useRouter();
  const { setCount } = useCartCount();
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
          contentContainerStyle={sharedStyles.screenContent}
          ListHeaderComponent={
            <View style={styles.header}>
              <Button
                title="Your orders"
                variant="text"
                icon="receipt-outline"
                onPress={() => router.push('/orders')}
                style={styles.orders}
              />
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
          ListFooterComponent={
            cart && cart.items.length > 0 ? (
              <Card style={styles.summary}>
                <View style={styles.subtotalRow}>
                  <Text style={sharedStyles.heading}>Subtotal</Text>
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
                  icon="card-outline"
                  disabled={busy}
                  onPress={() => router.push('/checkout')}
                />
              </Card>
            ) : null
          }
        />
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
  const { name } = item.product;
  return (
    <Card style={styles.card}>
      <ProductLine product={item.product} onOpen={onOpen} />
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
        {item.line_total ? <Text style={sharedStyles.link}>${item.line_total}</Text> : null}
      </View>
      <View style={styles.controls}>
        <Button
          title="Save for later"
          variant="text"
          disabled={disabled}
          onPress={onSaveForLater}
          accessibilityLabel={`Save ${name} for later`}
        />
        <Button
          title="Remove"
          variant="text"
          disabled={disabled}
          onPress={onRemove}
          accessibilityLabel={`Remove ${name} from cart`}
        />
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
      hitSlop={spacing.xs}
      style={[styles.step, disabled && styles.stepDisabled]}
    >
      <Ionicons name={icon} size={textStyles.subheading.lineHeight} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  orders: {
    alignSelf: 'flex-end',
  },
  card: {
    gap: spacing.md,
  },
  controls: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
  },
  stepper: {
    ...sharedStyles.row,
    gap: spacing.md,
  },
  step: {
    width: 44, // touch target, as on the product page
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  stepDisabled: {
    opacity: 0.4,
  },
  quantity: {
    ...textStyles.subheading,
    color: colors.textPrimary,
    minWidth: spacing.xl,
    textAlign: 'center',
  },
  summary: {
    gap: spacing.md,
  },
  subtotalRow: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
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
