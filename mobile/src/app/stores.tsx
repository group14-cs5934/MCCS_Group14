import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';

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
 * opened from (or Home).
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
              onPress={() => pick({ id: item.id, name: item.name })}
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
}: {
  store: Store;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={selected ? `${store.name}, your store` : store.name}
      style={[styles.row, selected && styles.selected]}
    >
      <View style={styles.text}>
        <Text style={styles.name}>{store.name}</Text>
        {store.address ? <Text style={styles.address}>{store.address}</Text> : null}
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={textStyles.subheading.lineHeight}
        color={selected ? colors.accent : colors.textMuted}
      />
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
