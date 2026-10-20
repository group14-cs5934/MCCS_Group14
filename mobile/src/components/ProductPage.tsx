import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';

import type { ErrorAction } from '@/api';
import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import ErrorState from '@/components/ErrorState';
import StarRating from '@/components/StarRating';
import type { ProductState } from '@/hooks/useProduct';
import { useRatingSummary } from '@/hooks/useRatingSummary';
import { colors, fonts, radius, sharedStyles, spacing, textStyles } from '@/theme';
import type { Product } from '@/types/product';
import { formatPrice } from '@/utils/formatPrice';

type Props = {
  state: ProductState;
};

export default function ProductPage({ state: { product, loading, error, reload } }: Props) {
  function goBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }

  return (
    <View style={sharedStyles.screen}>
      {/* The page draws its own back and close buttons, so the navigator's header is hidden. */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          style={styles.circleButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.headerIcon}>‹</Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace('/(tabs)')}
          style={styles.circleButton}
          accessibilityRole="button"
          accessibilityLabel="Close product page"
        >
          <Text style={styles.closeIcon}>×</Text>
        </Pressable>
      </View>

      {/* The API sends actions for a scanned barcode it doesn't know; other errors get Try Again. */}
      {!loading && error?.actions?.length ? (
        <ProductNotFound actions={error.actions} />
      ) : (
        <AsyncContent
          loading={loading}
          error={error?.message}
          onRetry={reload}
          loadingMessage="Loading product…"
        >
          {product ? <ProductDetails product={product} /> : null}
        </AsyncContent>
      )}
    </View>
  );
}

/**
 * Shown when a scanned barcode isn't in the catalog, offering what the API's actions say: Retry
 * (back to the scanner, in case the barcode was misread) and Search (find it by name instead).
 */
function ProductNotFound({ actions }: { actions: ErrorAction[] }) {
  function scanAgain() {
    // This page was opened by the scanner, so Back returns to it, ready to scan again.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/scan');
    }
  }

  return (
    <ErrorState
      title="Product not found"
      message="We couldn't find a product with this barcode. Scan it again, or search for it by name."
      icon="barcode-outline"
      onRetry={actions.includes('retry_scan') ? scanAgain : undefined}
      retryLabel="Retry"
      style={sharedStyles.centered}
    >
      {actions.includes('manual_search') ? (
        <Button
          title="Search"
          variant="secondary"
          icon="search"
          // Replaces this page, so Back from the search screen returns to the scanner.
          onPress={() => router.replace('/search')}
        />
      ) : null}
    </ErrorState>
  );
}

function ProductDetails({ product }: { product: Product }) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageFailed = !!product.image_url && failedImageUrl === product.image_url;

  const brand = product.brand?.name;
  const category = product.category?.name;
  const subtitle = brand
    ? [brand, category].filter(Boolean).join(' · ')
    : category
      ? `Category: ${category}`
      : '';
  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Product photo */}
        <View style={styles.imageSection}>
          <View style={styles.imageBox}>
            {product.image_url && !imageFailed ? (
              <Image
                source={{ uri: product.image_url }}
                style={styles.image}
                resizeMode="contain"
                onError={() => setFailedImageUrl(product.image_url)}
                accessibilityLabel={`${product.name} photo`}
              />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Text style={styles.imageIcon}>▢</Text>
                <Text style={styles.imageMessage}>No image available</Text>
              </View>
            )}
          </View>
        </View>

        {/* Main information */}
        <View style={styles.productInfo}>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <Text style={styles.productName}>{product.name}</Text>

          <RatingLine productId={product.id} />

          {product.price ? (
            <Text style={styles.price}>{formatPrice(product.price)}</Text>
          ) : (
            <Text style={styles.unavailable}>No price yet</Text>
          )}
        </View>

        {/* Tabs: only Overview is implemented in T040 */}
        <View style={styles.tabs}>
          <View style={styles.activeTab}>
            <Text style={styles.activeTabText}>Overview</Text>
          </View>
          <View style={styles.tab}>
            <Text style={styles.inactiveTabText}>Reviews</Text>
          </View>
          <View style={styles.tab}>
            <Text style={styles.inactiveTabText}>Nutrition</Text>
          </View>
        </View>

        {/* Product details */}
        <View style={styles.details}>
          {brand ? <DetailRow icon="◇" label="Brand" value={brand} /> : null}

          {category ? <DetailRow icon="⬡" label="Category" value={category} /> : null}

          {product.size ? <DetailRow icon="♧" label="Size" value={product.size} /> : null}

          <DetailRow icon="▥" label="UPC" value={product.barcode} />

          {product.description ? (
            <View style={styles.descriptionSection}>
              <Text style={styles.descriptionTitle}>Description</Text>
              <Text style={styles.description}>{product.description}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Compare Prices will be enabled in its own feature */}
      <View style={styles.bottomBar}>
        <Pressable
          style={styles.compareButton}
          disabled
          accessibilityRole="button"
          accessibilityLabel="Compare Prices, coming soon"
          accessibilityState={{ disabled: true }}
        >
          <Text style={styles.compareText}>Compare Prices · Coming soon</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The product's average rating and how many people rated it, e.g. ★★★½ 3.7 (2 ratings), or
 * "No ratings yet". Loads separately from the product, so a ratings problem never hides the page.
 */
function RatingLine({ productId }: { productId: number }) {
  const { loading, summary, failed } = useRatingSummary(productId);

  if (loading) {
    // Same height as the loaded line, so the price below doesn't jump when it appears.
    return <View style={styles.ratingRow} />;
  }
  if (failed || !summary) {
    return <Text style={[styles.ratingRow, styles.ratingNote]}>Ratings unavailable</Text>;
  }
  if (summary.average === null || summary.count === 0) {
    return <Text style={[styles.ratingRow, styles.ratingNote]}>No ratings yet</Text>;
  }

  const average = summary.average.toFixed(1);
  const count = `${summary.count.toLocaleString('en-US')} ${summary.count === 1 ? 'rating' : 'ratings'}`;
  return (
    <View
      style={[styles.ratingRow, styles.ratingLine]}
      accessible
      accessibilityLabel={`Rated ${average} out of 5 from ${count}`}
    >
      <StarRating value={summary.average} size={18} />
      <Text style={styles.ratingAverage}>{average}</Text>
      <Text style={styles.ratingNote}>({count})</Text>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLeft}>
        <Text style={styles.detailIcon}>{icon}</Text>
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: {
    fontSize: 34,
    color: colors.primary,
    lineHeight: 38,
    marginTop: -4,
  },
  closeIcon: {
    fontSize: 28,
    color: colors.primary,
    lineHeight: 34,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  imageSection: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  imageBox: {
    width: 220,
    height: 220,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  imageIcon: {
    fontSize: 42,
    color: colors.textMuted,
  },
  imageMessage: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  productInfo: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  subtitle: {
    ...textStyles.bodyStrong,
    color: colors.textSecondary,
  },
  productName: {
    ...textStyles.title,
    color: colors.textPrimary,
  },
  ratingRow: {
    minHeight: 24,
  },
  ratingLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ratingAverage: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  ratingNote: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  price: {
    ...textStyles.price,
    fontSize: 30,
    lineHeight: 38,
    color: colors.accent,
  },
  unavailable: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  tabs: {
    flexDirection: 'row',
    gap: spacing.xxl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  activeTab: {
    paddingBottom: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  tab: {
    paddingBottom: spacing.md,
  },
  activeTabText: {
    ...textStyles.label,
    color: colors.accent,
  },
  inactiveTabText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  details: {
    paddingTop: spacing.xl,
    gap: spacing.xl,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  detailLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 0,
  },
  detailIcon: {
    fontSize: 20,
    color: colors.textSecondary,
    width: 26,
    textAlign: 'center',
  },
  detailLabel: {
    ...textStyles.bodyStrong,
    color: colors.textSecondary,
  },
  detailValue: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
  },
  descriptionSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  descriptionTitle: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  description: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  bottomBar: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  compareButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    opacity: 0.65,
  },
  compareText: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.textOnPrimary,
  },
});
