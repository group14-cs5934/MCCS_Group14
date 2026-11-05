import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ImageStyle,
} from 'react-native';

import { colors, radius, sizes, spacing, textStyles } from '@/theme';
import type { ProductCard } from '@/types/cart';

type PhotoProps = {
  uri: string | null;
  name: string;
  /** Width and height of a square photo. Leave out and size it with `style` instead. */
  size?: number;
  style?: StyleProp<ImageStyle>;
};

/** The product's photo, or a placeholder icon if it has none or the photo fails to load. */
export function ProductImage({ uri, name, size, style }: PhotoProps) {
  const [failed, setFailed] = useState(false);
  const box = [styles.photo, size !== undefined && { width: size, height: size }, style];

  if (!uri || failed) {
    return (
      <View style={[box, styles.placeholder]} testID="product-photo-placeholder">
        <Ionicons name="image-outline" size={sizes.iconLarge} color={colors.textMuted} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      onError={() => setFailed(true)}
      accessibilityLabel={`Photo of ${name}`}
      resizeMode="contain"
      style={box}
    />
  );
}

type Props = {
  product: ProductCard;
  /** Opens the product. Leave out when the line isn't tappable. */
  onOpen?: () => void;
  /** Photo size: thumb (64, cart) or small (44, checkout). */
  size?: 'thumb' | 'small';
  /** Shown before the name as "2 × Name". */
  quantity?: number;
  /** Replaces the default price line under the size, e.g. "$3.49 each" or a pill. */
  caption?: ReactNode;
  /** At the right edge, e.g. the line total. */
  trailing?: ReactNode;
};

/** A product's photo and name with size and price (or a caption), e.g. in a cart or checkout row. */
export default function ProductLine({
  product,
  onOpen,
  size = 'thumb',
  quantity,
  caption,
  trailing,
}: Props) {
  const content = (
    <>
      <ProductImage
        uri={product.image_url}
        name={product.name}
        size={size === 'thumb' ? sizes.thumb : sizes.thumbSmall}
      />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>
          {quantity !== undefined ? `${quantity} × ${product.name}` : product.name}
        </Text>
        {product.size ? (
          <Text style={styles.detail} numberOfLines={1}>
            {product.size}
          </Text>
        ) : null}
        {caption ??
          (product.price ? (
            <Text style={styles.price}>${product.price}</Text>
          ) : (
            <Text style={styles.noPrice}>No price yet</Text>
          ))}
      </View>
    </>
  );

  const opener = onOpen ? (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open ${product.name}`}
      style={({ pressed }) => [styles.opener, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.opener}>{content}</View>
  );

  return (
    <View style={styles.row}>
      {opener}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  opener: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
  },
  pressed: {
    opacity: 0.6,
  },
  photo: {
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
