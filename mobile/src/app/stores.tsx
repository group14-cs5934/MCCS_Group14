import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { useApiGet } from '@/hooks/useApiGet';
import { usePreferredStore, type PreferredStore } from '@/hooks/usePreferredStore';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';
import type { Store } from '@/types/store';

/**
 * Store picker (T078): every MCCS store, to pick the one the shopper uses most. It's remembered on
 * this device, and product pages list it first (T079). Picking one goes back to where it was
 * opened from (or Home). Each store's details button opens its page (T080).
 */
export default function StoresScreen() {
  const router = useRouter();
  const { store: preferred, setStore } = usePreferredStore();
  const { loading, data, error, reload } = useApiGet<Store[]>('/locations');

  function pick(store: PreferredStore | null) {
    setStore(store);
    // Opened straight from a link there's nothing to go back to, so it goes Home instead.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <View style={sharedStyles.screen}>
      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading stores…"
      >
        <FlatList
          data={data ?? []}
          keyExtractor={(store) => String(store.id)}
          contentContainerStyle={sharedStyles.screenContent}
          ListHeaderComponent={
            <Text style={sharedStyles.secondaryText}>
              Pick the store you shop at most. Product pages will list it first.
            </Text>
          }
          ListEmptyComponent={<Text style={sharedStyles.secondaryText}>No stores yet.</Text>}
          renderItem={({ item }) => (
            <StoreRow
              store={item}
              selected={item.id === preferred?.id}
              onPress={() => pick({ id: item.id, name: item.name, slug: item.slug })}
              onOpen={() => router.push(`/store/${item.id}`)}
            />
          )}
          ListFooterComponent={
            preferred ? (
              <Button
                title="Don't use a preferred store"
                variant="text"
                onPress={() => pick(null)}
              />
            ) : null
          }
        />
      </AsyncContent>
    </View>
  );
}

function StoreRow({
  store,
  selected,
  onPress,
  onOpen,
}: {
  store: Store;
  selected: boolean;
  /** Picks this store. */
  onPress: () => void;
  /** Opens the store's page: address, hours, and directions (T080). */
  onOpen: () => void;
}) {
  // Two buttons side by side, not one inside the other, so screen readers can reach both.
  return (
    <Card style={[styles.row, selected && styles.selected]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={selected ? `${store.name}, your store` : store.name}
        accessibilityState={{ selected }}
        style={({ pressed }) => [styles.pick, pressed && styles.pressed]}
      >
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={textStyles.subheading.lineHeight}
          color={selected ? colors.accent : colors.textMuted}
        />
        <View style={styles.text}>
          <Text style={styles.name}>{store.name}</Text>
          {store.address ? <Text style={styles.address}>{store.address}</Text> : null}
        </View>
      </Pressable>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${store.name} details`}
        // The icon is small; this makes the tap target about 48 points, like a Button.
        hitSlop={spacing.md}
      >
        <Ionicons
          name="information-circle-outline"
          size={textStyles.subheading.lineHeight}
          color={colors.accent}
        />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    ...sharedStyles.row,
    gap: spacing.md,
  },
  selected: {
    backgroundColor: colors.accentSoft,
  },
  pick: {
    ...sharedStyles.row,
    flex: 1,
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
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
