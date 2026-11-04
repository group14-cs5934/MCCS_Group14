import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import Badge from '@/components/Badge';
import Card from '@/components/Card';
import { orderDate } from '@/components/OrderSummary';
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
          contentContainerStyle={sharedStyles.screenContent}
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
              </View>
              <Text style={sharedStyles.body}>{item.store.name}</Text>
              <Text style={sharedStyles.secondaryText}>
                {orderDate(item.placed_at)} · {item.item_count}{' '}
                {item.item_count === 1 ? 'item' : 'items'}
                {item.total ? ` · $${item.total}` : ''}
              </Text>
            </Card>
          )}
        />
      </AsyncContent>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
  },
  top: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
  },
  number: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: spacing.xxxl,
  },
});
