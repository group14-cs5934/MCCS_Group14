import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import Badge from '@/components/Badge';
import Card from '@/components/Card';
import { colors, fonts, radius, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { Order } from '@/types/cart';

/** "Nov 4, 2026" for an order's placed_at. */
export function orderDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** An order's status as a label, e.g. "placed" as "Placed". */
export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** An item's unit price times its quantity as "$7.00", or null when it has no price. */
function lineTotal({ unit_price, quantity }: Order['items'][number]): string | null {
  return unit_price
    ? `$${((Math.round(Number(unit_price) * 100) * quantity) / 100).toFixed(2)}`
    : null;
}

type Props = {
  order: Order;
  /** Only "What you ordered" and the total: the order number and store are shown elsewhere. */
  compact?: boolean;
};

/** An order's number, store, pickup or delivery, items and total (the demo's receipt). */
export default function OrderSummary({ order, compact = false }: Props) {
  return (
    <Card style={styles.card}>
      {compact ? null : (
        <>
          <View style={styles.top}>
            <View style={styles.topText}>
              <Text style={sharedStyles.heading}>Order {order.number}</Text>
              <Text style={sharedStyles.secondaryText}>Placed {orderDate(order.placed_at)}</Text>
            </View>
            <Badge label={statusLabel(order.status)} tone="success" />
          </View>

          <View style={styles.storeRow}>
            <View style={styles.storeTile}>
              <Ionicons name="storefront-outline" size={sizes.icon} color={colors.actionPressed} />
            </View>
            <View style={styles.storeText}>
              <Text style={styles.caption}>
                {order.fulfillment === 'pickup' ? 'Pickup at' : 'Delivery from'}
              </Text>
              <Text style={styles.storeName}>{order.store.name}</Text>
            </View>
          </View>
        </>
      )}
      {order.fulfillment === 'delivery' && order.delivery_address ? (
        <Text style={sharedStyles.secondaryText}>To: {order.delivery_address}</Text>
      ) : null}
      {order.contact_name ? (
        <Text style={sharedStyles.secondaryText}>Name: {order.contact_name}</Text>
      ) : null}

      <Text style={styles.label}>
        {compact ? 'What you ordered' : 'Items'} · {order.item_count}
      </Text>
      {order.items.map((item, index) => {
        const total = lineTotal(item);
        return (
          <View key={`${item.product_id}-${index}`} style={styles.itemRow}>
            <Text style={[sharedStyles.body, styles.itemName]}>
              {item.quantity} × {item.name}
            </Text>
            <Text style={styles.itemTotal}>{total ?? 'No price'}</Text>
          </View>
        );
      })}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.total}>{order.total ? `$${order.total}` : 'Not priced'}</Text>
      </View>
      {compact ? null : (
        <Text style={sharedStyles.secondaryText}>Demo order: no payment was taken.</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  top: {
    ...sharedStyles.row,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  topText: {
    flex: 1,
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
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  storeName: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  label: {
    ...textStyles.pill,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  itemRow: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  itemName: {
    flex: 1,
  },
  itemTotal: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  totalRow: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  total: {
    ...textStyles.heading,
    fontFamily: fonts.displayExtrabold,
    color: colors.textPrimary,
  },
});
