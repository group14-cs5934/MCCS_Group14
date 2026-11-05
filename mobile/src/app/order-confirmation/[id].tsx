import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import OrderSummary from '@/components/OrderSummary';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, radius, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { Order } from '@/types/cart';

/** Shown after Place order: the order number, store, pickup or delivery, items and total. */
export default function OrderConfirmationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { loading, data, error, reload } = useApiGet<Order>(`/me/orders/${id}`);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView style={sharedStyles.screen} contentContainerStyle={styles.content}>
        <View
          style={[sharedStyles.headerBand, styles.hero, { paddingTop: insets.top + spacing.xxl }]}
        >
          <View style={styles.check}>
            <Ionicons
              name="checkmark"
              size={textStyles.display.fontSize}
              color={colors.textOnPrimary}
            />
          </View>
          <Text style={styles.title}>Order placed</Text>
          {data ? (
            <>
              <Text style={styles.subtitle}>
                {data.fulfillment === 'pickup'
                  ? "We'll have it ready for pickup at"
                  : 'Your order is on its way from'}
              </Text>
              <Text style={styles.store}>{data.store.name}</Text>
              <Text style={styles.number}>Order {data.number}</Text>
            </>
          ) : null}
        </View>

        <View style={styles.body}>
          {/* Only the order details wait on the load: Done stays available if it fails. */}
          <AsyncContent
            loading={loading}
            error={error?.message}
            onRetry={reload}
            loadingMessage="Loading your order…"
          >
            {data ? <OrderSummary order={data} compact /> : null}
            <Text style={styles.note}>
              This is a demo order: no payment was taken and nothing will be held at the store.
            </Text>
          </AsyncContent>
          <Button title="Done" onPress={() => router.replace('/(tabs)')} />
          <Button
            title="View your orders"
            variant="secondary"
            onPress={() => router.replace('/orders')}
          />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  check: {
    width: sizes.thumb,
    height: sizes.thumb,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.action,
  },
  title: {
    ...textStyles.hero,
    color: colors.textOnHeader,
  },
  subtitle: {
    ...textStyles.body,
    color: colors.textOnHeaderMuted,
    textAlign: 'center',
  },
  store: {
    ...textStyles.bodyStrong,
    color: colors.textOnHeader,
    textAlign: 'center',
  },
  number: {
    ...textStyles.label,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.headerChip,
    color: colors.textOnHeader,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  note: {
    ...textStyles.body,
    padding: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.infoSoft,
    color: colors.info,
  },
});
