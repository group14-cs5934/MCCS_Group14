import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api, type ApiResult } from '@/api';
import { checkCart, removeFromCart, saveForLater, setCartQuantity } from '@/api/cart';
import { placeOrder } from '@/api/orders';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import Loader from '@/components/Loader';
import ProductLine from '@/components/ProductLine';
import SectionTabs from '@/components/SectionTabs';
import TextField from '@/components/TextField';
import { useCartCount } from '@/hooks/useCartCount';
import { usePreferredStore } from '@/hooks/usePreferredStore';
import { colors, radius, sharedStyles, spacing, textStyles } from '@/theme';
import type { Cart, CartCheck, CheckItem, Fulfillment, StoreOption } from '@/types/cart';
import type { Store } from '@/types/store';

const MIN_ADDRESS_LENGTH = 5;

const FULFILLMENT_TABS: { key: Fulfillment; label: string }[] = [
  { key: 'pickup', label: 'Pickup' },
  { key: 'delivery', label: 'Delivery' },
];

/** "All 3 items" or "2 of 3 items" for a store. */
function coverage({ available_items, total_items }: StoreOption): string {
  const items = total_items === 1 ? 'item' : 'items';
  return available_items === total_items
    ? `All ${total_items} ${items}`
    : `${available_items} of ${total_items} ${items}`;
}

/**
 * Demo checkout, pushed from the Cart: pickup or delivery, the store (the preferred one to start
 * with) and what it has of the cart, with a fix for each problem item. Nothing is paid.
 */
export default function CheckoutScreen() {
  const router = useRouter();
  const { setCount } = useCartCount();
  const { store: preferred, loading: preferredLoading } = usePreferredStore();

  // The store the shopper picked here, else their preferred store, else the first store.
  const [picked, setPicked] = useState<number | null>(null);
  const [fallbackId, setFallbackId] = useState<number | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [checkKey, setCheckKey] = useState(0);
  const [loaded, setLoaded] = useState<{
    storeId: number;
    key: number;
    result: ApiResult<CartCheck>;
  } | null>(null);
  const [fulfillment, setFulfillment] = useState<Fulfillment>('pickup');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const storeId = picked ?? preferred?.id ?? fallbackId;
  const needsFallback = !preferredLoading && !preferred;
  useEffect(() => {
    if (!needsFallback) return;
    const controller = new AbortController();
    api.get<Store[]>('/locations', { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted && result.ok && result.data.length > 0) {
        setFallbackId(result.data[0].id);
      }
    });
    return () => controller.abort();
  }, [needsFallback]);

  // Checks the cart against the chosen store, and again whenever the store or the cart changes.
  useEffect(() => {
    if (storeId === null) return;
    const controller = new AbortController();
    checkCart(storeId, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setLoaded({ storeId, key: checkKey, result });
    });
    return () => controller.abort();
  }, [storeId, checkKey]);

  const current = loaded?.storeId === storeId && loaded.key === checkKey ? loaded.result : null;
  // The last good check stays on screen while the next one loads, but not once that one fails.
  const lastOk = loaded?.result.ok ? loaded.result.data : null;
  const check = current ? (current.ok ? current.data : null) : lastOk;
  const checkError = current && !current.ok ? current.error : null;

  function recheck() {
    setCheckKey((key) => key + 1);
  }

  function chooseStore(id: number) {
    setPicked(id);
    setChoosing(false);
    setMessage(null);
  }

  /** The best store other than this one: the API lists them best first. */
  const otherStore = check?.stores.find((option) => option.store.id !== storeId);

  async function fix(call: Promise<ApiResult<Cart>>) {
    setBusy(true);
    setMessage(null);
    const result = await call;
    setBusy(false);
    if (result.ok) {
      setCount(result.data.item_count);
      recheck();
    } else {
      setMessage(result.error.message);
    }
  }

  const trimmedAddress = address.trim();
  const addressTooShort = trimmedAddress.length > 0 && trimmedAddress.length < MIN_ADDRESS_LENGTH;
  const needsAddress = fulfillment === 'delivery' && trimmedAddress.length < MIN_ADDRESS_LENGTH;
  const canPlace = !!(current?.ok && current.data.all_available) && !needsAddress && !busy;

  async function place() {
    if (storeId === null) return;
    setBusy(true);
    setMessage(null);
    const result = await placeOrder({
      store_id: storeId,
      fulfillment,
      ...(fulfillment === 'delivery' && {
        delivery_address: trimmedAddress,
        ...(name.trim() && { contact_name: name.trim() }),
      }),
    });
    setBusy(false);
    if (result.ok) {
      setCount(0);
      router.replace({
        pathname: '/order-confirmation/[id]',
        params: { id: String(result.data.id) },
      });
    } else if (result.error.code === 'items_unavailable') {
      setMessage('Stock changed while you were checking out. We checked your items again below.');
      recheck();
    } else if (result.error.code === 'cart_empty') {
      setCount(0);
      recheck();
    } else {
      setMessage(result.error.message);
    }
  }

  if (checkError?.code === 'cart_empty') {
    return (
      <View style={[sharedStyles.screen, sharedStyles.centered, styles.emptyCart]}>
        <Text style={sharedStyles.heading}>Your cart is empty</Text>
        <Button title="Back to cart" onPress={() => router.replace('/cart')} />
      </View>
    );
  }

  return (
    <ScrollView
      style={sharedStyles.screen}
      contentContainerStyle={[sharedStyles.screenContent, styles.content]}
      keyboardShouldPersistTaps="handled"
    >
      <SectionTabs tabs={FULFILLMENT_TABS} selected={fulfillment} onSelect={setFulfillment} />

      <Card style={styles.card}>
        <View style={styles.storeRow}>
          <View style={styles.storeText}>
            <Text style={styles.caption}>{fulfillment === 'pickup' ? 'Pickup at' : 'From'}</Text>
            <Text style={styles.storeName}>
              {check?.store.name ?? (storeId === null ? 'Choosing a store…' : 'Loading…')}
            </Text>
          </View>
          <Button
            title="Change"
            variant="text"
            disabled={!check}
            onPress={() => setChoosing((open) => !open)}
            accessibilityLabel="Change store"
          />
        </View>
        {choosing && check
          ? check.stores.map((option) => (
              <Pressable
                key={option.store.id}
                onPress={() => chooseStore(option.store.id)}
                accessibilityRole="button"
                accessibilityLabel={`${option.store.name}, ${coverage(option)}`}
                accessibilityState={{ selected: option.store.id === storeId }}
                style={({ pressed }) => [
                  styles.option,
                  option.store.id === storeId && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.storeName}>{option.store.name}</Text>
                <Text style={sharedStyles.secondaryText}>{coverage(option)}</Text>
              </Pressable>
            ))
          : null}
      </Card>

      {fulfillment === 'delivery' ? (
        <Card style={styles.card}>
          <TextField
            label="Delivery address"
            value={address}
            onChangeText={setAddress}
            autoComplete="street-address"
            textContentType="fullStreetAddress"
            maxLength={300}
            error={addressTooShort ? 'Enter your full address.' : undefined}
          />
          <TextField
            label="Name (optional)"
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
            maxLength={100}
          />
        </Card>
      ) : null}

      {message ? <ErrorBanner message={message} /> : null}
      {checkError ? <ErrorBanner message={checkError.message} onRetry={recheck} /> : null}

      {check ? (
        <View style={styles.items}>
          {check.items.map((item) => (
            <CheckLine
              key={item.product.id}
              item={item}
              disabled={busy}
              canTryOther={!!otherStore}
              onUse={(quantity) => fix(setCartQuantity(item.product.id, quantity))}
              onRemove={() => fix(removeFromCart(item.product.id))}
              onSaveForLater={() => fix(saveForLater(item.product.id))}
              onTryOther={() => otherStore && chooseStore(otherStore.store.id)}
            />
          ))}
        </View>
      ) : checkError ? null : (
        <Loader message="Checking your items…" style={styles.loader} />
      )}

      <Text style={[sharedStyles.secondaryText, styles.center]}>
        Demo checkout: no payment is taken.
      </Text>
      <Button
        title="Place order"
        icon="checkmark-circle-outline"
        disabled={!canPlace}
        loading={busy}
        onPress={place}
      />
      {needsAddress && check?.all_available ? (
        <Text style={[sharedStyles.secondaryText, styles.center]}>
          Enter a delivery address to place your order.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function CheckLine({
  item,
  disabled,
  canTryOther,
  onUse,
  onRemove,
  onSaveForLater,
  onTryOther,
}: {
  item: CheckItem;
  disabled: boolean;
  canTryOther: boolean;
  onUse: (quantity: number) => void;
  onRemove: () => void;
  onSaveForLater: () => void;
  onTryOther: () => void;
}) {
  const { name } = item.product;
  const left = item.available_quantity ?? 0;
  return (
    <Card style={styles.card}>
      <ProductLine product={item.product} />
      <View style={styles.statusRow}>
        <Text style={styles.quantity}>Quantity {item.quantity}</Text>
        {item.status === 'available' ? (
          <Badge label="Available" tone="accent" />
        ) : (
          <Badge
            label={item.status === 'limited' ? `Only ${left} left` : 'Not at this store'}
            tone="danger"
          />
        )}
      </View>
      {item.status !== 'available' ? (
        <View style={styles.fixes}>
          {item.status === 'limited' && left > 0 ? (
            <Button
              title={`Use ${left}`}
              variant="secondary"
              disabled={disabled}
              onPress={() => onUse(left)}
              accessibilityLabel={`Use ${left} of ${name}`}
            />
          ) : null}
          {item.status === 'unavailable' || left === 0 ? (
            <>
              <Button
                title="Remove"
                variant="secondary"
                disabled={disabled}
                onPress={onRemove}
                accessibilityLabel={`Remove ${name} from cart`}
              />
              <Button
                title="Save for later"
                variant="secondary"
                disabled={disabled}
                onPress={onSaveForLater}
                accessibilityLabel={`Save ${name} for later`}
              />
            </>
          ) : null}
          <Button
            title="Try another store"
            variant="text"
            disabled={disabled || !canTryOther}
            onPress={onTryOther}
            accessibilityLabel={`Try another store for ${name}`}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 0,
  },
  emptyCart: {
    gap: spacing.lg,
  },
  card: {
    gap: spacing.md,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  storeRow: {
    ...sharedStyles.row,
    gap: spacing.md,
  },
  storeText: {
    flex: 1,
    gap: spacing.xxs,
  },
  storeName: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  option: {
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  optionSelected: {
    backgroundColor: colors.accentSoft,
  },
  pressed: {
    opacity: 0.6,
  },
  items: {
    gap: spacing.md,
  },
  quantity: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  statusRow: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
  },
  fixes: {
    gap: spacing.sm,
  },
  loader: {
    paddingVertical: spacing.xl,
  },
  center: {
    textAlign: 'center',
  },
});
