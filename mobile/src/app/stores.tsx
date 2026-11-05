import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth';
import AsyncContent from '@/components/AsyncContent';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import { useApiGet } from '@/hooks/useApiGet';
import { usePreferredStore, type PreferredStore } from '@/hooks/usePreferredStore';
import { colors, radius, shadows, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { Store } from '@/types/store';

/**
 * Store picker (T078): every MCCS store, to pick the one the shopper uses most. It's remembered on
 * this device, and product pages list it first (T079). Picking one goes back to where it was
 * opened from (or Home). Each store's chevron opens its page (T080). Admins can add a store here.
 */
export default function StoresScreen() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { store: preferred, setStore } = usePreferredStore();
  const { loading, data, error, reload } = useApiGet<Store[]>('/locations');

  // Coming back from adding a store (or deleting one) shows the change; the first focus is the load.
  const seenFirstFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seenFirstFocus.current) reload();
      seenFirstFocus.current = true;
    }, [reload]),
  );

  function pick(store: PreferredStore | null) {
    setStore(store);
    // Opened straight from a link there's nothing to go back to, so it goes Home instead.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  const stores = data ?? [];
  return (
    <View style={sharedStyles.screen}>
      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading stores…"
      >
        <ScrollView contentContainerStyle={sharedStyles.screenContent}>
          <Text style={styles.intro}>Pick your store: we&apos;ll show stock and prices there.</Text>
          {isAdmin ? (
            <Button
              title="Add store"
              icon="add"
              variant="secondary"
              onPress={() => router.push('/store/new')}
            />
          ) : null}
          <View style={styles.card}>
            {stores.length === 0 ? (
              <Text style={[sharedStyles.secondaryText, styles.empty]}>No stores yet.</Text>
            ) : null}
            {stores.map((item, index) => (
              <StoreRow
                key={item.id}
                store={item}
                selected={item.id === preferred?.id}
                divider={index > 0}
                onPress={() => pick({ id: item.id, name: item.name, slug: item.slug })}
                onOpen={() => router.push(`/store/${item.id}`)}
              />
            ))}
          </View>
          {preferred ? (
            <Button title="Don't use a preferred store" variant="text" onPress={() => pick(null)} />
          ) : null}
        </ScrollView>
      </AsyncContent>
    </View>
  );
}

function StoreRow({
  store,
  selected,
  divider,
  onPress,
  onOpen,
}: {
  store: Store;
  selected: boolean;
  divider: boolean;
  /** Picks this store. */
  onPress: () => void;
  /** Opens the store's page: address, hours, and directions (T080). */
  onOpen: () => void;
}) {
  // Two buttons side by side, not one inside the other, so screen readers can reach both.
  return (
    <View style={[styles.row, divider && styles.divider]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={selected ? `${store.name}, your store` : store.name}
        accessibilityState={{ selected }}
        style={({ pressed }) => [styles.pick, pressed && styles.pressed]}
      >
        <View style={styles.tile}>
          <Ionicons name="storefront-outline" size={sizes.icon} color={colors.action} />
        </View>
        <View style={styles.text}>
          <Text style={styles.name}>{store.name}</Text>
          {store.address ? <Text style={styles.address}>{store.address}</Text> : null}
          {selected ? <Badge label="Your store" tone="success" /> : null}
        </View>
      </Pressable>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${store.name} details`}
        // The icon is small; this makes the tap target about 48 points, like a Button.
        hitSlop={spacing.md}
      >
        <Ionicons name="chevron-forward" size={sizes.icon} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  card: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  empty: {
    padding: spacing.lg,
  },
  row: {
    ...sharedStyles.row,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pick: {
    ...sharedStyles.row,
    flex: 1,
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
  tile: {
    width: sizes.thumbSmall,
    height: sizes.thumbSmall,
    borderRadius: radius.md,
    backgroundColor: colors.actionSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
    alignItems: 'flex-start',
  },
  name: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  address: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
});
