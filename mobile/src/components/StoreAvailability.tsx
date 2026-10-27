import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import Badge from '@/components/Badge';
import Button from '@/components/Button';
import ErrorBanner from '@/components/ErrorBanner';
import Loader from '@/components/Loader';
import { useApiGet } from '@/hooks/useApiGet';
import { usePreferredStore } from '@/hooks/usePreferredStore';
import { colors, radius, spacing, textStyles } from '@/theme';
import type { ProductAvailability, StoreStock } from '@/types/store';

/**
 * "Available at" on the product page (T079): every MCCS store with whether it has the product.
 * The shopper's own store (T078) comes first, then the API's order: in-stock stores first. When no
 * store has it, says "Out of stock at all locations".
 */
export default function StoreAvailability({ productId }: { productId: number }) {
  const router = useRouter();
  const { store: preferred, loading: preferredLoading } = usePreferredStore();
  const { loading, data, error, reload } = useApiGet<ProductAvailability>(
    `/products/${productId}/availability`,
  );

  let content;
  // Also waits for the shopper's store, so the list doesn't jump when it moves to the top.
  if (loading || preferredLoading) {
    content = <Loader message="Checking stores…" size="small" style={styles.status} />;
  } else if (error) {
    content = (
      <ErrorBanner title="Couldn't check stores" message={error.message} onRetry={reload} />
    );
  } else {
    const stores = withPreferredFirst(data?.stores ?? [], preferred?.id);
    const inStock = stores.filter((row) => row.in_stock).length;
    // Also offered when the saved store is no longer listed (e.g. it was removed).
    const offerChoice = stores.length > 0 && !stores.some((row) => row.store.id === preferred?.id);
    content = (
      <>
        <Text style={[styles.summary, inStock === 0 && styles.summaryOut]}>
          {stores.length === 0
            ? 'No stores yet.'
            : inStock === 0
              ? 'Out of stock at all locations'
              : `In stock at ${inStock} of ${stores.length} ${stores.length === 1 ? 'store' : 'stores'}`}
        </Text>
        {stores.map((row) => (
          <StoreRow key={row.store.id} row={row} isPreferred={row.store.id === preferred?.id} />
        ))}
        {offerChoice ? (
          <Button
            title="Choose your store to see it first"
            variant="text"
            icon="storefront-outline"
            onPress={() => router.push('/stores')}
          />
        ) : null}
      </>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">
        Available at
      </Text>
      {content}
    </View>
  );
}

/** The stores in the API's order, except the shopper's own store, which goes first. */
function withPreferredFirst(stores: StoreStock[], preferredId: number | undefined): StoreStock[] {
  const preferred = stores.find((row) => row.store.id === preferredId);
  return preferred ? [preferred, ...stores.filter((row) => row !== preferred)] : stores;
}

function StoreRow({ row, isPreferred }: { row: StoreStock; isPreferred: boolean }) {
  const status = row.in_stock ? 'In stock' : 'Out of stock';
  const details = row.in_stock
    ? [row.quantity !== null ? `${row.quantity} on hand` : null, row.aisle]
        .filter(Boolean)
        .join(' · ')
    : null;
  const label = [row.store.name, isPreferred ? 'your store' : null, status, details]
    .filter(Boolean)
    .join(', ');

  return (
    <View
      style={[styles.row, isPreferred && styles.preferredRow]}
      accessible
      accessibilityLabel={label}
    >
      <View style={styles.storeInfo}>
        <View style={styles.nameLine}>
          <Text style={styles.storeName}>{row.store.name}</Text>
          {isPreferred ? <Badge label="Your store" tone="accent" /> : null}
        </View>
        {row.store.address ? <Text style={styles.meta}>{row.store.address}</Text> : null}
        {details ? <Text style={styles.meta}>{details}</Text> : null}
      </View>
      <View style={[styles.stockPill, row.in_stock ? styles.inStock : styles.outOfStock]}>
        <Text style={[styles.stockText, { color: row.in_stock ? colors.success : colors.danger }]}>
          {status}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  heading: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  status: {
    paddingVertical: spacing.lg,
  },
  summary: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  summaryOut: {
    color: colors.danger,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  preferredRow: {
    borderColor: colors.accent,
  },
  storeInfo: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  nameLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  storeName: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  meta: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  stockPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  inStock: {
    backgroundColor: colors.accentSoft,
  },
  outOfStock: {
    backgroundColor: colors.dangerSoft,
  },
  stockText: {
    ...textStyles.caption,
  },
});
