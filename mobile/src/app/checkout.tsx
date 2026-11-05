import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { colors, radius, sharedStyles, sizes, spacing, textStyles } from '@/theme';
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

/** How many of an item this store can fill: all, what's left, or none. */
function fillable({ status, quantity, available_quantity }: CheckItem): number {
  if (status === 'available') return quantity;
  return status === 'limited' ? (available_quantity ?? 0) : 0;
}

/** An item's price times its quantity in cents, or null when the product has no price. */
function lineCents({ product }: CheckItem, quantity: number): number | null {
  return product.price ? Math.round(Number(product.price) * 100) * quantity : null;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Demo checkout, pushed from the Cart: pickup or delivery, the store (the preferred one to start
 * with) and what it has of the cart, with a fix for each problem item. Nothing is paid.
 */
export default function CheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  /** The first other store that has every item, if any. */
  const bestOther = check?.stores.find(
    (option) => option.store.id !== storeId && option.available_items === option.total_items,
  );
  const problems = check ? check.items.filter((item) => item.status !== 'available').length : 0;

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
  // The current check found something to fix (or failed), as opposed to still loading.
  const blockedByItems = !!current && (!current.ok || !current.data.all_available);

  // The total counts only what this store can fill, so it's a partial total until all is available.
  const counted = check?.items.filter((item) => fillable(item) > 0) ?? [];
  const pricedLines = counted
    .map((item) => lineCents(item, fillable(item)))
    .filter((cents) => cents !== null);
  const unpriced = counted.length - pricedLines.length;
  const total = pricedLines.length > 0 ? dollars(pricedLines.reduce((a, b) => a + b, 0)) : '—';

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
        <Button title="Back to cart" onPress={() => router.dismissTo('/cart')} />
      </View>
    );
  }

  return (
    <View style={sharedStyles.screen}>
      <Stack.Screen options={{ headerRight: () => <Badge label="Demo" tone="info" /> }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <SectionTabs tabs={FULFILLMENT_TABS} selected={fulfillment} onSelect={setFulfillment} />

        <View style={styles.body}>
          <Card style={styles.storeCard}>
            <View style={styles.storeRow}>
              <View style={styles.storeTile}>
                <Ionicons
                  name="storefront-outline"
                  size={sizes.icon}
                  color={colors.actionPressed}
                />
              </View>
              <View style={styles.storeText}>
                <Text style={styles.caption}>
                  {fulfillment === 'pickup' ? 'Pick up at' : 'Delivered from'}
                </Text>
                <Text style={styles.storeName}>
                  {check?.store.name ?? (storeId === null ? 'Choosing a store…' : 'Loading…')}
                </Text>
              </View>
              <Button
                title="Change"
                variant="secondary"
                disabled={!check}
                onPress={() => setChoosing((open) => !open)}
                accessibilityLabel="Change store"
                style={styles.change}
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

          {message ? <ErrorBanner message={message} /> : null}
          {checkError ? <ErrorBanner message={checkError.message} onRetry={recheck} /> : null}

          {problems > 0 ? (
            <View style={styles.banner}>
              <Ionicons name="warning-outline" size={sizes.icon} color={colors.warning} />
              <Text style={styles.bannerText}>
                {problems === 1 ? '1 item needs a fix here.' : `${problems} items need a fix here.`}{' '}
                {bestOther
                  ? `${bestOther.store.name} has everything.`
                  : 'No other store has everything.'}
              </Text>
              {bestOther ? (
                <Button
                  title="Switch"
                  disabled={busy}
                  onPress={() => chooseStore(bestOther.store.id)}
                  style={styles.switch}
                />
              ) : null}
            </View>
          ) : null}

          {check ? (
            <Card style={styles.items}>
              {check.items.map((item, index) => (
                <View key={item.product.id}>
                  {index > 0 ? <View style={[sharedStyles.divider, styles.rule]} /> : null}
                  <CheckLine
                    item={item}
                    disabled={busy}
                    canTryOther={!!otherStore}
                    onUse={(quantity) => fix(setCartQuantity(item.product.id, quantity))}
                    onRemove={() => fix(removeFromCart(item.product.id))}
                    onSaveForLater={() => fix(saveForLater(item.product.id))}
                    onTryOther={() => otherStore && chooseStore(otherStore.store.id)}
                  />
                </View>
              ))}
            </Card>
          ) : checkError ? null : (
            <Loader message="Checking your items…" style={styles.loader} />
          )}

          {fulfillment === 'delivery' ? (
            <Card style={styles.fields}>
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
        </View>
      </ScrollView>

      <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            {check && !check.all_available ? "Total for what's here" : 'Total'}
          </Text>
          <Text style={sharedStyles.price}>{total}</Text>
        </View>
        {unpriced > 0 ? (
          <Text style={sharedStyles.secondaryText}>
            {unpriced === 1
              ? '1 item has no price yet and is not included.'
              : `${unpriced} items have no price yet and are not included.`}
          </Text>
        ) : null}
        <Button
          title={blockedByItems ? 'Fix the items above to order' : 'Place order'}
          variant={blockedByItems ? 'secondary' : 'action'}
          disabled={!canPlace}
          loading={busy}
          onPress={place}
          style={styles.place}
        />
        {needsAddress && check?.all_available ? (
          <Text style={[sharedStyles.secondaryText, styles.center]}>
            Enter a delivery address to place your order.
          </Text>
        ) : null}
        <Text style={[styles.caption, styles.center]}>Demo checkout: no payment is taken.</Text>
      </View>
    </View>
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
  const cents = lineCents(item, item.quantity);
  return (
    <View style={styles.line}>
      <ProductLine
        product={item.product}
        size="small"
        quantity={item.quantity}
        caption={
          item.status === 'available' ? (
            <Badge label="Available" tone="success" />
          ) : (
            <Badge
              label={item.status === 'limited' ? `Only ${left} left here` : 'Not at this store'}
              tone={item.status === 'limited' ? 'warning' : 'danger'}
            />
          )
        }
        trailing={cents !== null ? <Text style={styles.lineTotal}>{dollars(cents)}</Text> : null}
      />
      {item.status !== 'available' ? (
        <View style={styles.fixes}>
          {item.status === 'limited' && left > 0 ? (
            <Button
              title={`Use ${left}`}
              variant="secondary"
              disabled={disabled}
              onPress={() => onUse(left)}
              accessibilityLabel={`Use ${left} of ${name}`}
              style={styles.fix}
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
                style={styles.fix}
              />
              <Button
                title="Save for later"
                variant="text"
                disabled={disabled}
                onPress={onSaveForLater}
                accessibilityLabel={`Save ${name} for later`}
                style={styles.fix}
              />
            </>
          ) : null}
          <Button
            title="Try another store"
            variant="text"
            disabled={disabled || !canTryOther}
            onPress={onTryOther}
            accessibilityLabel={`Try another store for ${name}`}
            style={styles.fix}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xl,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  emptyCart: {
    gap: spacing.lg,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  storeCard: {
    gap: spacing.md,
    padding: spacing.md,
  },
  storeRow: {
    ...sharedStyles.row,
    gap: spacing.md,
  },
  storeTile: {
    width: sizes.touch,
    height: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.actionSoft,
  },
  storeText: {
    flex: 1,
    gap: spacing.xxs,
  },
  storeName: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  change: {
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
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
  banner: {
    ...sharedStyles.row,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.warningSoft,
  },
  bannerText: {
    ...textStyles.bodyStrong,
    flex: 1,
    color: colors.warning,
  },
  switch: {
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  items: {
    padding: 0,
  },
  rule: {
    marginHorizontal: spacing.md,
  },
  line: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  lineTotal: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  fixes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    // Lines the buttons up under the name, past the photo.
    paddingLeft: sizes.thumbSmall + spacing.md,
  },
  fix: {
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  fields: {
    gap: spacing.md,
  },
  loader: {
    paddingVertical: spacing.xl,
  },
  panel: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  totalRow: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
  },
  totalLabel: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  place: {
    minHeight: sizes.actionButton,
  },
  center: {
    textAlign: 'center',
  },
});
