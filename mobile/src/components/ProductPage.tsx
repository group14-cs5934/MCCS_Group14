import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';

import type { ErrorAction } from '@/api';
import { useAuth } from '@/auth';
import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import ErrorState from '@/components/ErrorState';
import Loader from '@/components/Loader';
import ProductActions from '@/components/ProductActions';
import ProductNutrition from '@/components/ProductNutrition';
import RateProduct from '@/components/RateProduct';
import ReviewForm from '@/components/ReviewForm';
import ReviewList from '@/components/ReviewList';
import SectionTabs, { type SectionTab } from '@/components/SectionTabs';
import StoreAvailability from '@/components/StoreAvailability';
import type { ProductState } from '@/hooks/useProduct';
import { useApiGet, type ApiGetState } from '@/hooks/useApiGet';
import { usePreferredStore } from '@/hooks/usePreferredStore';
import { useRatingSummary, type RatingSummaryState } from '@/hooks/useRatingSummary';
import { useRecordActivity } from '@/hooks/useRecordActivity';
import { rememberProduct } from '@/hooks/useRecentProducts';
import { useReviews } from '@/hooks/useReviews';
import { colors, radius, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { Product } from '@/types/product';
import type { ActivityKind } from '@/types/restock';
import type { ProductAvailability } from '@/types/store';
import { formatPrice } from '@/utils/formatPrice';

type Props = {
  state: ProductState;
  /** What opening the page counts as for the store's statistics: a scan, or else a view. */
  opened?: ActivityKind;
};

/** Height of the product photo at the top of the page. */
const PHOTO_HEIGHT = 250;

export default function ProductPage({
  state: { product, loading, error, reload },
  opened = 'view',
}: Props) {
  useRecordActivity(product?.id, opened);
  const insets = useSafeAreaInsets();

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

      {/* The page content comes first so the buttons float over the photo. */}
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
          {/* Keyed so another product's page starts fresh (its own tab and reviews). */}
          {product ? <ProductDetails key={product.id} product={product} /> : null}
        </AsyncContent>
      )}

      <View style={[styles.header, { top: insets.top + spacing.lg }]} pointerEvents="box-none">
        <Pressable
          onPress={goBack}
          style={styles.circleButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={sizes.icon} color={colors.textPrimary} />
        </Pressable>

        <Pressable
          onPress={() => router.replace('/(tabs)')}
          style={styles.circleButton}
          accessibilityRole="button"
          accessibilityLabel="Close product page"
        >
          <Ionicons name="close" size={sizes.icon} color={colors.textPrimary} />
        </Pressable>
      </View>
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
          // Leaves this page for the Search tab, so Back from there returns to the scanner.
          onPress={() => router.dismissTo('/search')}
        />
      ) : null}
    </ErrorState>
  );
}

type Tab = 'reviews' | 'nutrition' | 'stores';

const TABS: SectionTab<Tab>[] = [
  { key: 'reviews', label: 'Reviews' },
  { key: 'nutrition', label: 'Nutrition' },
  { key: 'stores', label: 'Stores' },
];

/** How close to the bottom (in points) counts as "scrolled to the bottom" for loading more. */
const LOAD_MORE_DISTANCE = 200;

function isNearBottom({ layoutMeasurement, contentOffset, contentSize }: NativeScrollEvent) {
  return layoutMeasurement.height + contentOffset.y >= contentSize.height - LOAD_MORE_DISTANCE;
}

function ProductDetails({ product }: { product: Product }) {
  const { user } = useAuth();
  const ratings = useRatingSummary(product.id);
  const availability = useApiGet<ProductAvailability>(`/products/${product.id}/availability`);
  const [tab, setTab] = useState<Tab>('reviews');
  const reviews = useReviews(product.id, true);

  // Home's "Recently viewed": remembered once, when the rating has loaded too (or failed).
  const remembered = useRef(false);
  const userId = user?.id;
  const average = ratings.summary?.average ?? null;
  useEffect(() => {
    if (!userId || remembered.current || ratings.loading) return;
    remembered.current = true;
    rememberProduct(userId, {
      id: product.id,
      name: product.name,
      image_url: product.image_url,
      price: product.price?.amount ?? null,
      rating: average,
    }).catch(() => undefined);
  }, [userId, ratings.loading, average, product]);

  const [writing, setWriting] = useState(false);
  // Null until the form knows whether the user already reviewed this product.
  const [hasReview, setHasReview] = useState<boolean | null>(null);
  const [posted, setPosted] = useState(false);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (tab === 'reviews' && isNearBottom(event.nativeEvent)) {
      reviews.loadMore();
    }
  }

  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageFailed = !!product.image_url && failedImageUrl === product.image_url;

  const brand = product.brand?.name;
  const category = product.category?.name;
  const subtitle = [category, product.size].filter(Boolean).join(' · ');
  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        testID="product-scroll"
        onScroll={onScroll}
        scrollEventThrottle={100}
      >
        {/* Product photo */}
        <View style={styles.photo}>
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
              <Ionicons name="image-outline" size={sizes.iconLarge} color={colors.textMuted} />
              <Text style={styles.imageMessage}>No image available</Text>
            </View>
          )}
        </View>

        <View style={styles.sheet}>
          <View style={styles.titleBlock}>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            <Text style={styles.productName}>{product.name}</Text>
          </View>

          <View style={styles.priceRow}>
            <View style={styles.priceBlock}>
              {product.price ? (
                <>
                  <Text style={styles.price}>{formatPrice(product.price)}</Text>
                  <Text style={styles.priceNote}>
                    MCX price · {updatedLabel(product.price.observed_at)}
                  </Text>
                </>
              ) : (
                <Text style={styles.unavailable}>No price yet</Text>
              )}
            </View>
            <RatingChip ratings={ratings} onPress={() => setTab('reviews')} />
          </View>

          <StockPanel availability={availability} onSeeStores={() => setTab('stores')} />

          <View style={styles.tabs}>
            <SectionTabs tabs={TABS} selected={tab} onSelect={setTab} />
          </View>

          <View style={styles.tabContent}>
            {/* Kept mounted (just hidden) on the other tabs, so a half-written review isn't lost. */}
            <View style={tab === 'reviews' ? styles.tabContent : styles.hidden}>
              <View style={sharedStyles.card}>
                {/* Saving a rating reloads the average above, so it includes the new one. */}
                <RateProduct productId={product.id} onSaved={ratings.reload} />
              </View>
              <View style={sharedStyles.card}>
                {/* Collapsed until asked for. Posting reloads the list, so the new review shows at the top. */}
                {writing ? null : (
                  <>
                    {posted ? (
                      <Text style={styles.posted} accessibilityLiveRegion="polite">
                        Thanks! Your review was posted.
                      </Text>
                    ) : null}
                    <Button
                      title={
                        hasReview === null
                          ? 'Review this product'
                          : hasReview
                            ? 'Edit your review'
                            : 'Write a review'
                      }
                      variant="secondary"
                      icon="create-outline"
                      disabled={hasReview === null}
                      onPress={() => {
                        setPosted(false);
                        setWriting(true);
                      }}
                      style={styles.writeButton}
                    />
                  </>
                )}
                <ReviewForm
                  productId={product.id}
                  open={writing}
                  onHasReview={setHasReview}
                  onCancel={() => setWriting(false)}
                  onPosted={() => {
                    setWriting(false);
                    setPosted(true);
                    reviews.reload();
                  }}
                />
                <ReviewList state={reviews} />
              </View>
            </View>
            {tab === 'nutrition' ? (
              <View style={sharedStyles.card}>
                <ProductNutrition />
              </View>
            ) : null}
            {tab === 'stores' ? (
              <View style={sharedStyles.card}>
                {/* Which stores have it, the shopper's own store first (T079). */}
                <StoreAvailability availability={availability} />
              </View>
            ) : null}
          </View>

          <View style={[sharedStyles.card, styles.details]}>
            {brand ? <DetailRow icon="pricetag-outline" label="Brand" value={brand} /> : null}
            {category ? <DetailRow icon="grid-outline" label="Category" value={category} /> : null}
            {product.size ? (
              <DetailRow icon="resize-outline" label="Size" value={product.size} />
            ) : null}
            <DetailRow icon="barcode-outline" label="UPC" value={product.barcode} />

            {product.description ? (
              <View style={styles.descriptionSection}>
                <Text style={styles.descriptionTitle}>Description</Text>
                <Text style={styles.description}>{product.description}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {/* Keyed so another product starts with fresh Save / Added state. */}
      <ProductActions key={product.id} productId={product.id} />
    </View>
  );
}

/** "updated today", or "updated Oct 11" for an older price. */
function updatedLabel(observedAt: string): string {
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) return 'updated recently';
  if (date.toDateString() === new Date().toDateString()) return 'updated today';
  return `updated ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/**
 * The product's average rating and how many people rated it, e.g. ★ 3.7 (2 ratings), or
 * "No ratings yet". Loads separately from the product, so a ratings problem never hides the page.
 * Tapping it opens the Reviews tab.
 */
function RatingChip({
  ratings: { loading, summary, failed },
  onPress,
}: {
  ratings: RatingSummaryState;
  onPress: () => void;
}) {
  if (loading) {
    // Same height as the loaded chip, so the price beside it doesn't jump when it appears.
    return <View style={styles.ratingChip} />;
  }
  if (failed || !summary) {
    return <Text style={styles.ratingNote}>Ratings unavailable</Text>;
  }
  if (summary.average === null || summary.count === 0) {
    return <Text style={styles.ratingNote}>No ratings yet</Text>;
  }

  const average = summary.average.toFixed(1);
  const count = `${summary.count.toLocaleString('en-US')} ${summary.count === 1 ? 'rating' : 'ratings'}`;
  return (
    <Pressable
      onPress={onPress}
      style={styles.ratingChip}
      accessible
      accessibilityLabel={`Rated ${average} out of 5 from ${count}`}
      accessibilityHint="Shows the reviews"
    >
      <Ionicons name="star" size={textStyles.label.lineHeight} color={colors.rating} />
      <Text style={styles.ratingAverage}>{average}</Text>
      <Text style={styles.ratingCount}>({count})</Text>
    </Pressable>
  );
}

/**
 * Whether the shopper's own store has the product, with its aisle and shelf count, and how many
 * other stores have it. The full list is on the Stores tab. Uses the same data as that tab.
 */
function StockPanel({
  availability: { loading, data, error },
  onSeeStores,
}: {
  availability: ApiGetState<ProductAvailability>;
  onSeeStores: () => void;
}) {
  const { store: preferred, loading: preferredLoading } = usePreferredStore();

  if (loading || preferredLoading) {
    return (
      <View style={sharedStyles.card}>
        <Loader message="Checking stock…" size="small" />
      </View>
    );
  }
  const stores = data?.stores ?? [];
  if (error || stores.length === 0) {
    return (
      <View style={sharedStyles.card}>
        <Text style={styles.stockDetail}>
          {error ? "Couldn't check stock" : 'No stores carry this yet'}
        </Text>
      </View>
    );
  }

  const own = stores.find((row) => row.store.id === preferred?.id);
  const others = stores.filter((row) => row !== own && row.in_stock).length;

  let headline: string;
  let detail: string | null = null;
  let inStock: boolean;
  if (own) {
    inStock = own.in_stock;
    headline = `${own.in_stock ? 'In stock' : 'Out of stock'} at ${own.store.name}`;
    detail = own.in_stock
      ? [own.aisle, own.quantity !== null ? `${own.quantity} on the shelf` : null]
          .filter(Boolean)
          .join(' · ')
      : null;
  } else {
    const count = stores.filter((row) => row.in_stock).length;
    inStock = count > 0;
    headline = inStock
      ? `Available at ${count} ${count === 1 ? 'store' : 'stores'}`
      : 'Not in stock at any store';
    detail = 'Choose your store to see its aisle';
  }
  const linkLabel = own
    ? others > 0
      ? `In stock at ${others} other ${others === 1 ? 'store' : 'stores'}`
      : 'Not in stock at other stores'
    : 'See all stores';

  return (
    <View style={[sharedStyles.card, styles.stockPanel]}>
      <View style={styles.stockMain}>
        <View
          style={[
            styles.stockIcon,
            { backgroundColor: inStock ? colors.successSoft : colors.dangerSoft },
          ]}
        >
          <Ionicons
            name={inStock ? 'checkmark' : 'close'}
            size={sizes.icon}
            color={inStock ? colors.success : colors.danger}
          />
        </View>
        <View style={styles.stockText}>
          <Text style={styles.stockHeadline}>{headline}</Text>
          {detail ? <Text style={styles.stockDetail}>{detail}</Text> : null}
        </View>
      </View>
      <Pressable
        onPress={onSeeStores}
        style={styles.stockLink}
        accessibilityRole="button"
        accessibilityLabel={linkLabel}
        accessibilityHint="Opens the Stores tab"
      >
        <Text style={styles.stockLinkText}>{linkLabel}</Text>
        <Ionicons name="chevron-forward" size={sizes.icon} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLeft}>
        <Ionicons name={icon} size={sizes.icon} color={colors.textSecondary} />
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
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  circleButton: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  photo: {
    height: PHOTO_HEIGHT,
    backgroundColor: colors.surfaceMuted,
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
  imageMessage: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  // Overlaps the photo's bottom edge with rounded top corners.
  sheet: {
    marginTop: -spacing.xl,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.lg,
  },
  titleBlock: {
    gap: spacing.xs,
  },
  subtitle: {
    ...textStyles.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  productName: {
    ...textStyles.title,
    color: colors.textPrimary,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  priceBlock: {
    flex: 1,
    gap: spacing.xxs,
  },
  price: {
    ...sharedStyles.price,
    ...textStyles.hero,
  },
  priceNote: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  unavailable: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  ratingAverage: {
    ...textStyles.label,
    color: colors.textPrimary,
  },
  ratingCount: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  ratingNote: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  stockPanel: {
    gap: spacing.md,
  },
  stockMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stockIcon: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockText: {
    flex: 1,
    gap: spacing.xxs,
  },
  stockHeadline: {
    ...textStyles.label,
    color: colors.textPrimary,
  },
  stockDetail: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  stockLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: sizes.touch,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },
  stockLinkText: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  // SectionTabs brings its own side and top margins; cancel them to line up with the cards.
  tabs: {
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
  },
  writeButton: {
    marginBottom: spacing.lg,
  },
  tabContent: {
    gap: spacing.lg,
  },
  hidden: {
    display: 'none',
  },
  posted: {
    ...textStyles.bodyStrong,
    color: colors.accent,
    marginBottom: spacing.md,
  },
  details: {
    gap: spacing.lg,
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
});
