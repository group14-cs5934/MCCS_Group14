// TEMP demo of GET /products/{id}/availability (T074). Not a real task: delete this file and the
// lines marked TEMP in ProductPage.tsx when the store-availability task is done properly.
import { StyleSheet, Text, View } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, radius, spacing, textStyles } from '@/theme';

type StoreAvailabilityRow = {
  store: { id: number; name: string; slug: string; address: string | null };
  in_stock: boolean;
  quantity: number | null;
  aisle: string | null;
  updated_at: string | null;
};

type ProductAvailability = {
  product_id: number;
  stores: StoreAvailabilityRow[];
};

/** Each MCCS store with whether it has this product, in-stock stores first (the API's order). */
export default function StoreAvailability({ productId }: { productId: number }) {
  const { loading, data, error, reload } = useApiGet<ProductAvailability>(
    `/products/${productId}/availability`,
  );
  const stores = data?.stores ?? [];
  const inStock = stores.filter((row) => row.in_stock).length;

  return (
    <AsyncContent
      loading={loading}
      error={error?.message}
      onRetry={reload}
      loadingMessage="Checking stores…"
    >
      <View style={styles.list}>
        <Text style={styles.summary}>
          {stores.length === 0
            ? 'No stores yet.'
            : `In stock at ${inStock} of ${stores.length} stores`}
        </Text>
        {stores.map((row) => (
          <StoreRow key={row.store.id} row={row} />
        ))}
      </View>
    </AsyncContent>
  );
}

function StoreRow({ row }: { row: StoreAvailabilityRow }) {
  const details = row.in_stock
    ? [row.quantity !== null ? `${row.quantity} on hand` : null, row.aisle]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <View style={styles.row}>
      <View style={styles.storeInfo}>
        <Text style={styles.storeName}>{row.store.name}</Text>
        {row.store.address ? <Text style={styles.meta}>{row.store.address}</Text> : null}
        {details ? <Text style={styles.meta}>{details}</Text> : null}
      </View>
      <View style={[styles.badge, row.in_stock ? styles.inStock : styles.outOfStock]}>
        <Text style={[styles.badgeText, { color: row.in_stock ? colors.success : colors.danger }]}>
          {row.in_stock ? 'In stock' : 'Out of stock'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
  summary: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
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
  storeInfo: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  storeName: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  meta: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  badge: {
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
  badgeText: {
    ...textStyles.caption,
  },
});
