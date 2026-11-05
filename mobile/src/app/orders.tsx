import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import Badge from '@/components/Badge';
import Card from '@/components/Card';
import { orderDate, statusLabel } from '@/components/OrderSummary';
import { useFocusGet } from '@/hooks/useFocusGet';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';
import type { Order } from '@/types/cart';

/** Your orders: the shopper's past demo orders, newest first. */
export default function OrdersScreen() {
  const router = useRouter();
  const { loading, data, error, retry } = useFocusGet<Order[]>('/me/orders');

  return (
    <View style={sharedStyles.screen}>
      <AsyncContent
        loading={loading}
        error={data ? null : error?.message}
        onRetry={retry}
        loadingMessage="Loading your orders…"
      >
        <FlatList
          data={data ?? []}
          keyExtractor={(order) => String(order.id)}
          contentContainerStyle={styles.content}
          ListEmptyComponent={
            <Text style={[sharedStyles.secondaryText, styles.empty]}>
              No orders yet. When you check out, your orders show up here.
            </Text>
          }
          renderItem={({ item }) => (
            <Card
              onPress={() =>
                router.push({ pathname: '/order/[id]', params: { id: String(item.id) } })
              }
              accessibilityLabel={`Order ${item.number}`}
              style={styles.card}
            >
              <View style={styles.top}>
                <Text style={styles.number}>{item.number}</Text>
                <Badge
                  label={item.fulfillment === 'pickup' ? 'Pickup' : 'Delivery'}
                  tone="accent"
                />
                <Badge label={statusLabel(item.status)} tone="success" />
              </View>
              <Text style={sharedStyles.body}>{item.store.name}</Text>
              <View style={styles.bottom}>
                <Text style={[sharedStyles.secondaryText, styles.meta]}>
                  {orderDate(item.placed_at)} · {item.item_count}{' '}
                  {item.item_count === 1 ? 'item' : 'items'}
                </Text>
                {item.total ? <Text style={styles.total}>${item.total}</Text> : null}
              </View>
            </Card>
          )}
        />
      </AsyncContent>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  card: {
    gap: spacing.xs,
  },
  top: {
    ...sharedStyles.row,
    gap: spacing.sm,
  },
  number: {
    ...textStyles.subheading,
    color: colors.textPrimary,
    flex: 1,
  },
  bottom: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  meta: {
    flex: 1,
  },
  total: {
    ...textStyles.priceSmall,
    color: colors.textPrimary,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: spacing.xxxl,
  },
});
