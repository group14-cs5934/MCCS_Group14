import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadows, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { Product } from '@/types/product';
import { formatPrice } from '@/utils/formatPrice';

type Props = {
  /** Products to show, in order (best match first). */
  results: Product[];
  /** Called with the product whose row was tapped, e.g. to open its product page. */
  onOpen: (product: Product) => void;
};

/** Scrolling list of products as rows in one white card: photo, name, size or brand, and price. */
export default function SearchResultsList({ results, onOpen }: Props) {
  return (
    <ScrollView
      // Tapping a result while the keyboard is up opens it instead of only closing the keyboard.
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
    >
      <View style={styles.card}>
        {results.map((product, index) => (
          <SearchResult
            key={product.id}
            product={product}
            first={index === 0}
            onPress={() => onOpen(product)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function SearchResult({
  product,
  first,
  onPress,
}: {
  product: Product;
  first: boolean;
  onPress: () => void;
}) {
  const price = product.price ? formatPrice(product.price) : 'No price yet';
  // Size, or brand or category if there's no size, e.g. "184g" or "Snacks".
  const detail = product.size ?? product.brand?.name ?? product.category?.name;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[product.name, detail, price].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.row, !first && styles.divider, pressed && styles.pressed]}
    >
      <ProductPhoto uri={product.image_url} name={product.name} size={sizes.thumb} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Text style={product.price ? styles.price : styles.noPrice}>{price}</Text>
    </Pressable>
  );
}

/** The product's photo, or a placeholder icon if it has none or the photo fails to load. */
export function ProductPhoto({
  uri,
  name,
  size = PHOTO_SIZE,
}: {
  uri: string | null;
  name: string;
  /** Width and height; 72 by default. */
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return (
      <View
        style={[styles.photo, { width: size, height: size }, styles.placeholder]}
        testID="product-photo-placeholder"
      >
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
      style={[styles.photo, { width: size, height: size }]}
    />
  );
}

const PHOTO_SIZE = 72;

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  card: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  row: {
    ...sharedStyles.row,
    gap: spacing.md,
    padding: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
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
    ...textStyles.priceSmall,
    color: colors.textPrimary,
  },
  noPrice: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
});
