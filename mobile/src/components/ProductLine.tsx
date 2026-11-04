import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProductPhoto } from '@/components/SearchResultsList';
import { colors, radius, spacing, textStyles } from '@/theme';
import type { ProductCard } from '@/types/cart';

type Props = {
  product: ProductCard;
  /** Opens the product. Leave out when the line isn't tappable. */
  onOpen?: () => void;
};

/** A product's photo, name, size and price, e.g. at the top of a Saved or cart row. */
export default function ProductLine({ product, onOpen }: Props) {
  const content = (
    <>
      <ProductPhoto uri={product.image_url} name={product.name} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        {product.size ? (
          <Text style={styles.detail} numberOfLines={1}>
            {product.size}
          </Text>
        ) : null}
        {product.price ? (
          <Text style={styles.price}>${product.price}</Text>
        ) : (
          <Text style={styles.noPrice}>No price yet</Text>
        )}
      </View>
    </>
  );

  if (!onOpen) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open ${product.name}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
  },
  pressed: {
    opacity: 0.6,
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
