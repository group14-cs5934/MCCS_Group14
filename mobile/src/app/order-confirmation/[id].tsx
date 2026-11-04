import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import OrderSummary from '@/components/OrderSummary';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';
import type { Order } from '@/types/cart';

/** Shown after Place order: the order number, store, pickup or delivery, items and total. */
export default function OrderConfirmationScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { loading, data, error, reload } = useApiGet<Order>(`/me/orders/${id}`);

  return (
    <AsyncContent
      loading={loading}
      error={error?.message}
      onRetry={reload}
      loadingMessage="Loading your order…"
    >
      <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.screenContent}>
        <View style={styles.hero}>
          <Ionicons
            name="checkmark-circle"
            size={textStyles.display.fontSize}
            color={colors.accent}
          />
          <Text style={sharedStyles.title}>Order placed</Text>
          <Text style={[sharedStyles.secondaryText, styles.center]}>
            Thanks! This was a demo order, so nothing was charged.
          </Text>
        </View>
        {data ? <OrderSummary order={data} /> : null}
        <Button title="Done" onPress={() => router.replace('/(tabs)')} />
        <Button title="View orders" variant="secondary" onPress={() => router.replace('/orders')} />
      </ScrollView>
    </AsyncContent>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  center: {
    textAlign: 'center',
  },
});
