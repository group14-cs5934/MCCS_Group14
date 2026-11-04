import { StyleSheet, Text, View } from 'react-native';

import Card from '@/components/Card';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';
import type { Order } from '@/types/cart';

/** "Nov 4, 2026" for an order's placed_at. */
export function orderDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** An order's number, store, pickup or delivery, items and total (the demo's receipt). */
export default function OrderSummary({ order }: { order: Order }) {
  return (
    <Card style={styles.card}>
      <Text style={sharedStyles.heading}>Order {order.number}</Text>
      <Text style={sharedStyles.secondaryText}>Placed {orderDate(order.placed_at)}</Text>

      <View style={styles.section}>
        <Text style={styles.label}>
          {order.fulfillment === 'pickup' ? 'Pickup at' : 'Delivery from'}
        </Text>
        <Text style={sharedStyles.body}>{order.store.name}</Text>
        {order.fulfillment === 'delivery' && order.delivery_address ? (
          <Text style={sharedStyles.secondaryText}>To: {order.delivery_address}</Text>
        ) : null}
        {order.contact_name ? (
          <Text style={sharedStyles.secondaryText}>Name: {order.contact_name}</Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>
          {order.item_count} {order.item_count === 1 ? 'item' : 'items'}
        </Text>
        {order.items.map((item, index) => (
          <View key={`${item.product_id}-${index}`} style={styles.itemRow}>
            <Text style={[sharedStyles.body, styles.itemName]}>
              {item.quantity} x {item.name}
            </Text>
            <Text style={sharedStyles.secondaryText}>
              {item.unit_price ? `$${item.unit_price}` : 'No price'}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.itemRow}>
        <Text style={sharedStyles.heading}>Total</Text>
        <Text style={sharedStyles.price}>{order.total ? `$${order.total}` : 'Not priced'}</Text>
      </View>
      <Text style={sharedStyles.secondaryText}>Demo order: no payment was taken.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  section: {
    gap: spacing.xs,
  },
  label: {
    ...textStyles.bodyStrong,
    color: colors.textSecondary,
  },
  itemRow: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  itemName: {
    flex: 1,
  },
});
