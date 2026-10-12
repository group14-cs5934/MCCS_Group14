import { ScrollView, StyleSheet, Text, View } from 'react-native';

import AsyncContent from '@/components/AsyncContent';
import Card from '@/components/Card';
import type { ProductState } from '@/hooks/useProduct';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';
import type { Product } from '@/types/product';
import { formatPrice } from '@/utils/formatPrice';

type Props = {
  /** The product being loaded, from useProduct or useProductByBarcode. */
  state: ProductState;
};

/**
 * Body of the product page: the product's basic details, or a spinner or error while it loads.
 * This is the Sprint 1 version used for the app ↔ API ↔ database check (T025); T040 builds the
 * full page.
 */
export default function ProductPage({ state: { product, loading, error, reload } }: Props) {
  return (
    <View style={sharedStyles.screen}>
      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading product…"
      >
        {product && <ProductDetails product={product} />}
      </AsyncContent>
    </View>
  );
}

function ProductDetails({ product }: { product: Product }) {
  return (
    <ScrollView contentContainerStyle={sharedStyles.screenContent}>
      <Card style={styles.card}>
        {product.category ? <Text style={styles.category}>{product.category.name}</Text> : null}
        <Text style={sharedStyles.heading}>{product.name}</Text>
        {product.size ? <Text style={sharedStyles.secondaryText}>{product.size}</Text> : null}
        {product.price ? (
          <Text style={sharedStyles.price}>{formatPrice(product.price)}</Text>
        ) : (
          <Text style={sharedStyles.secondaryText}>No price yet</Text>
        )}
        {product.description ? <Text style={sharedStyles.body}>{product.description}</Text> : null}
        <Text style={styles.barcode}>Barcode {product.barcode}</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  category: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  barcode: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
});
