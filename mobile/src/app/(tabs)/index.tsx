import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ImageStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import { useApiGet } from '@/hooks/useApiGet';
import { usePreferredStore, type PreferredStore } from '@/hooks/usePreferredStore';
import { useRecentProducts } from '@/hooks/useRecentProducts';
import { colors, radius, shadows, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { PopularProduct } from '@/types/insights';

/** Up to two initials from an email like "dan.mccabe@x.com" (DM), or its first letters. */
function initialsOf(email: string | undefined): string {
  const name = (email ?? '').split('@')[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** A product photo, or a muted square with an icon if there is none or it fails to load. */
function Thumb({ uri, style }: { uri: string | null; style: StyleProp<ImageStyle> }) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View style={[style, styles.thumbPlaceholder]} testID="product-photo-placeholder">
        <Ionicons name="image-outline" size={sizes.iconLarge} color={colors.textMuted} />
      </View>
    );
  }
  return (
    <Image source={{ uri }} onError={() => setFailed(true)} resizeMode="contain" style={style} />
  );
}

/** Home tab: the app's starting point, with the two ways to find a product, scan or search. */
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isAdmin } = useAuth();
  const { store, loading: storeLoading } = usePreferredStore();
  const { products: recent } = useRecentProducts();

  // Admins start in the admin area: once their role loads, it opens on top of Home, so Back
  // still reaches the shopper side. Only once per sign-in (Home stays mounted until sign-out).
  const openedAdmin = useRef(false);
  useEffect(() => {
    if (isAdmin && !openedAdmin.current) {
      openedAdmin.current = true;
      router.push('/admin');
    }
  }, [isAdmin, router]);

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={styles.content}>
      <View style={[sharedStyles.headerBand, { paddingTop: insets.top + spacing.md }]}>
        <View style={[sharedStyles.row, styles.topRow]}>
          <Text style={styles.wordmark}>Recon</Text>
          {/* Waits for the saved store, so "Choose store" never flashes before it. */}
          {storeLoading ? null : (
            <Pressable
              onPress={() => router.push('/stores')}
              accessibilityRole="button"
              accessibilityLabel={store ? 'Change your store' : 'Choose your store'}
              style={({ pressed }) => [styles.storeChip, pressed && styles.pressed]}
            >
              <Ionicons name="storefront-outline" size={sizes.icon} color={colors.textOnHeader} />
              <Text style={styles.storeChipText} numberOfLines={1}>
                {store ? store.name : 'Choose store'}
              </Text>
              <Ionicons name="chevron-down" size={sizes.icon} color={colors.textOnHeader} />
            </Pressable>
          )}
          <Pressable
            onPress={() => router.navigate('/account')}
            accessibilityRole="button"
            accessibilityLabel="Account"
            style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
          >
            <Text style={styles.avatarText}>{initialsOf(user?.email)}</Text>
          </Pressable>
        </View>

        <Text style={styles.hero}>What are you shopping for?</Text>

        {/* /search takes no query, so this is a shortcut to the search screen's own field. */}
        <Pressable
          onPress={() => router.navigate('/search')}
          accessibilityRole="button"
          accessibilityLabel="Search products or brands"
          style={({ pressed }) => [styles.search, pressed && styles.pressed]}
        >
          <Ionicons name="search" size={sizes.icon} color={colors.textSecondary} />
          <Text style={styles.searchText}>Search products or brands</Text>
        </Pressable>

        <View style={styles.scanBlock}>
          <Button
            title="Scan a barcode"
            variant="action"
            icon="scan-outline"
            onPress={() => router.navigate('/scan')}
            style={styles.scanButton}
          />
          <Text style={styles.scanCaption}>Price, ratings and stock at your store</Text>
        </View>
      </View>

      {recent.length > 0 ? (
        <View style={styles.section}>
          <Text style={[sharedStyles.sectionTitle, styles.sectionPadding]}>Recently viewed</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.recentRow, styles.sectionPadding]}
          >
            {recent.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => router.push(`/product/${item.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.name}`}
                style={({ pressed }) => [styles.recentCard, pressed && styles.pressed]}
              >
                <Thumb uri={item.image_url} style={styles.recentImage} />
                <Text style={styles.recentName} numberOfLines={2}>
                  {item.name}
                </Text>
                <View style={[sharedStyles.row, styles.recentMeta]}>
                  <Text style={styles.recentPrice}>
                    {item.price ? `$${item.price}` : 'No price'}
                  </Text>
                  {item.rating !== null ? (
                    <>
                      <Ionicons
                        name="star"
                        size={textStyles.caption.fontSize}
                        color={colors.rating}
                      />
                      <Text style={styles.recentRating}>{item.rating.toFixed(1)}</Text>
                    </>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {store ? <PopularSection store={store} /> : null}
    </ScrollView>
  );
}

/** What shoppers at the store look at most, as rows in one card. Shows nothing if it can't load. */
function PopularSection({ store }: { store: PreferredStore }) {
  const router = useRouter();
  const { data } = useApiGet<PopularProduct[]>(`/locations/${store.id}/popular?limit=5`);
  if (!data || data.length === 0) return null;

  return (
    <View style={[styles.section, styles.sectionPadding]}>
      <Text style={sharedStyles.sectionTitle}>Popular at {store.name}</Text>
      <View style={styles.popularCard}>
        {data.map(({ product, in_stock, low, aisle }, index) => (
          <Pressable
            key={product.id}
            onPress={() => router.push(`/product/${product.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${product.name}`}
            style={({ pressed }) => [
              sharedStyles.row,
              styles.popularRow,
              index > 0 && styles.popularDivider,
              pressed && styles.pressed,
            ]}
          >
            <Thumb uri={product.image_url} style={styles.popularImage} />
            <View style={styles.popularText}>
              <Text style={styles.popularName} numberOfLines={1}>
                {product.name}
              </Text>
              <View style={[sharedStyles.row, styles.popularMeta]}>
                {in_stock === null ? null : !in_stock ? (
                  <Badge label="Out of stock" tone="danger" />
                ) : low ? (
                  <Badge label="Low stock" tone="warning" />
                ) : (
                  <Badge label="In stock" tone="success" />
                )}
                {aisle ? <Text style={styles.aisle}>{aisle}</Text> : null}
              </View>
            </View>
            {product.price ? <Text style={styles.popularPrice}>${product.price}</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  pressed: {
    opacity: 0.7,
  },
  topRow: {
    gap: spacing.sm,
  },
  wordmark: {
    ...textStyles.heading,
    flex: 1,
    color: colors.textOnHeader,
  },
  storeChip: {
    ...sharedStyles.row,
    flexShrink: 1,
    height: sizes.avatar,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.headerChip,
  },
  storeChipText: {
    ...textStyles.caption,
    flexShrink: 1,
    color: colors.textOnHeader,
  },
  avatar: {
    width: sizes.avatar,
    height: sizes.avatar,
    borderRadius: radius.pill,
    backgroundColor: colors.avatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...textStyles.caption,
    color: colors.textPrimary,
  },
  hero: {
    ...textStyles.hero,
    color: colors.textOnHeader,
  },
  search: {
    ...sharedStyles.row,
    height: sizes.button,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchText: {
    ...textStyles.body,
    color: colors.textMuted,
  },
  scanBlock: {
    gap: spacing.sm,
  },
  scanButton: {
    height: sizes.actionButton,
  },
  scanCaption: {
    ...textStyles.caption,
    textAlign: 'center',
    color: colors.textOnHeaderMuted,
  },
  section: {
    gap: spacing.md,
  },
  sectionPadding: {
    paddingHorizontal: spacing.xl,
  },
  recentRow: {
    gap: spacing.md,
  },
  recentCard: {
    width: 132,
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  recentImage: {
    width: '100%',
    aspectRatio: 1.5,
    borderRadius: radius.md,
  },
  recentName: {
    ...textStyles.caption,
    color: colors.textPrimary,
    minHeight: textStyles.caption.lineHeight * 2,
  },
  recentMeta: {
    gap: spacing.xs,
  },
  recentPrice: {
    ...textStyles.priceSmall,
    flex: 1,
    color: colors.textPrimary,
  },
  recentRating: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  thumbPlaceholder: {
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popularCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  popularRow: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  popularDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  popularImage: {
    width: sizes.thumbSmall,
    height: sizes.thumbSmall,
    borderRadius: radius.md,
  },
  popularText: {
    flex: 1,
    gap: spacing.xs,
  },
  popularName: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  popularMeta: {
    gap: spacing.sm,
  },
  aisle: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  popularPrice: {
    ...textStyles.priceSmall,
    color: colors.textPrimary,
  },
});
