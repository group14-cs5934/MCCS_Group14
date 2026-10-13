import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';

import Card from '@/components/Card';
import { colors, radius, sharedStyles, spacing, textStyles } from '@/theme';
import type { Product } from '@/types/product';
import { formatPrice } from '@/utils/formatPrice';

type Props = {
  /** Products to show, in order (best match first). */
  results: Product[];
  /** Called with the product whose row was tapped, e.g. to open its product page. */
  onOpen: (product: Product) => void;
};

/** Scrolling list of products, one tappable card each with photo, name, and price. */
export default function SearchResultsList({ results, onOpen }: Props) {
  return (
    <FlatList
      data={results}
      keyExtractor={(product) => String(product.id)}
      // Tapping a result while the keyboard is up opens it instead of only closing the keyboard.
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
      renderItem={({ item }) => <SearchResult product={item} onPress={() => onOpen(item)} />}
    />
  );
}

function SearchResult({ product, onPress }: { product: Product; onPress: () => void }) {
  const price = product.price ? formatPrice(product.price) : 'No price yet';
  // Size, or category if there's no size, e.g. "184g" or "Snacks".
  const detail = product.size ?? product.category?.name;

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={[product.name, detail, price].filter(Boolean).join(', ')}
      style={styles.row}
    >
      <ProductPhoto uri={product.image_url} name={product.name} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
        <Text style={product.price ? styles.price : styles.noPrice}>{price}</Text>
      </View>
    </Card>
  );
}

/** The product's photo, or a placeholder icon if it has none or the photo fails to load. */
function ProductPhoto({ uri, name }: { uri: string | null; name: string }) {
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return (
      <View style={[styles.photo, styles.placeholder]} testID="product-photo-placeholder">
        <Ionicons name="image-outline" size={24} color={colors.textMuted} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      onError={() => setFailed(true)}
      accessibilityLabel={`Photo of ${name}`}
      resizeMode="contain"
      style={styles.photo}
    />
  );
}

const PHOTO_SIZE = 72;

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  row: {
    ...sharedStyles.row,
    gap: spacing.md,
    padding: spacing.md,
  },
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  name: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  detail: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  price: {
    ...textStyles.bodyStrong,
    color: colors.accent,
  },
  noPrice: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
});
