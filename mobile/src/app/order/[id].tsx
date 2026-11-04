import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import OrderSummary from '@/components/OrderSummary';
import { useApiGet } from '@/hooks/useApiGet';
import { sharedStyles } from '@/theme';
import type { Order } from '@/types/cart';

/** One past order, opened from Your orders. */
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { loading, data, error, reload } = useApiGet<Order>(`/me/orders/${id}`);

  return (
    <AsyncContent
      loading={loading}
      error={error?.message}
      onRetry={reload}
      loadingMessage="Loading order…"
    >
      <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.screenContent}>
        {data ? <OrderSummary order={data} /> : null}
      </ScrollView>
    </AsyncContent>
  );
}
