import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import ErrorState from '@/components/ErrorState';
import { useApiGet } from '@/hooks/useApiGet';
import { usePreferredStore } from '@/hooks/usePreferredStore';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';
import type { Store } from '@/types/store';
import { directionsUrl } from '@/utils/directions';

/**
 * A store's page (T080): its address and hours, a link to directions, and a button to make it the
 * shopper's store (T078). Opened from the store list and from "Available at" on a product page.
 */
export default function StoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Only a whole number can be a store, so anything else (a bad link) isn't sent to the API.
  return /^\d+$/.test(id ?? '') ? <StoreLoader storeId={Number(id)} /> : <StoreNotFound />;
}

function StoreNotFound() {
  return (
    <View style={sharedStyles.screen}>
      <ErrorState
        title="Store not found"
        message="This store may have closed or moved."
        icon="storefront-outline"
        style={sharedStyles.centered}
      />
    </View>
  );
}

function StoreLoader({ storeId }: { storeId: number }) {
  const { loading, data, error, reload } = useApiGet<Store>(`/locations/${storeId}`);

  if (error?.status === 404) return <StoreNotFound />;
  return (
    <View style={sharedStyles.screen}>
      <Stack.Screen options={{ title: data?.name ?? 'Store' }} />
      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading store…"
      >
        {data ? <StoreDetails store={data} /> : null}
      </AsyncContent>
    </View>
  );
}

function StoreDetails({ store }: { store: Store }) {
  const { store: preferred, setStore } = usePreferredStore();
  const [mapsFailed, setMapsFailed] = useState(false);
  const isPreferred = preferred?.id === store.id;

  async function openDirections() {
    setMapsFailed(false);
    try {
      await Linking.openURL(directionsUrl(store));
    } catch {
      setMapsFailed(true);
    }
  }

  return (
    <ScrollView contentContainerStyle={sharedStyles.screenContent}>
      <View style={styles.heading}>
        <Text style={sharedStyles.title}>{store.name}</Text>
        {isPreferred ? <Badge label="Your store" tone="accent" /> : null}
      </View>

      <Card style={styles.card}>
        <InfoRow icon="location-outline" label="Address" value={store.address} empty="Not listed" />
        <View style={sharedStyles.divider} />
        <InfoRow icon="time-outline" label="Hours" value={store.hours} empty="Hours not listed" />
      </Card>

      {/* Directions need somewhere to go; a store without an address (e.g. online) has none. */}
      {store.address ? (
        <Button title="Get directions" icon="navigate-outline" onPress={openDirections} />
      ) : null}
      {mapsFailed ? (
        <ErrorBanner message="Couldn't open maps. Search for the address in your maps app." />
      ) : null}

      {isPreferred ? null : (
        <Button
          title="Make this my store"
          variant="secondary"
          icon="storefront-outline"
          onPress={() => setStore({ id: store.id, name: store.name })}
        />
      )}
    </ScrollView>
  );
}

function InfoRow({
  icon,
  label,
  value,
  empty,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string | null;
  /** Shown when there's no value. */
  empty: string;
}) {
  return (
    <View style={styles.infoRow} accessible accessibilityLabel={`${label}: ${value || empty}`}>
      <Ionicons name={icon} size={textStyles.subheading.lineHeight} color={colors.textSecondary} />
      <View style={styles.infoText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={value ? styles.infoValue : styles.infoEmpty}>{value || empty}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  card: {
    gap: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  infoText: {
    flex: 1,
    gap: spacing.xxs,
  },
  infoLabel: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  infoValue: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  infoEmpty: {
    ...textStyles.body,
    color: colors.textMuted,
  },
});
