import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import StarRating from '@/components/StarRating';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, radius, sharedStyles, spacing, textStyles } from '@/theme';
import type { OverallReview as OverallReviewData, OverallReviewSource } from '@/types/review';

type Props = {
  productId: number;
};

/**
 * The product's overall review, written by AI from shoppers' reviews on other stores' sites
 * (T052.8). It's a card of its own, apart from app users' reviews, and says it was written by AI
 * and where the reviews came from.
 *
 * Shows nothing while loading, when the product has no overall review yet (a 404), or if it
 * couldn't be loaded: it's extra information, so it never gets in the way of the page.
 */
export default function OverallReview({ productId }: Props) {
  const { data } = useApiGet<OverallReviewData>(`/products/${productId}/overall-review`);
  // Checked, not trusted: a response that isn't an overall review must never break the page.
  if (!isOverallReview(data)) return null;

  const fromCount = `${data.review_count.toLocaleString('en-US')} ${
    data.review_count === 1 ? 'review' : 'reviews'
  }`;
  return (
    <View style={[sharedStyles.card, styles.card]} testID="overall-review">
      <View style={styles.header}>
        <Text style={styles.heading} accessibilityRole="header">
          What shoppers say elsewhere
        </Text>
        <View style={styles.badge}>
          <Ionicons name="sparkles" size={textStyles.caption.lineHeight} color={colors.info} />
          <Text style={styles.badgeText}>AI summary</Text>
        </View>
      </View>

      <Text style={styles.body}>{data.overall_review}</Text>

      {data.sources.length > 0 ? (
        <View style={styles.sources}>
          {data.sources.map((source) => (
            <SourceRow key={source.source} source={source} />
          ))}
        </View>
      ) : null}

      <Text style={styles.note}>
        Written by AI from {fromCount} on other stores&apos; websites, not by shoppers in this app.
        Updated {formatDate(data.generated_at)}.
      </Text>
    </View>
  );
}

/** One store: its web address, and its own average and review count, e.g. ★★★★½ 4.6 (928). */
function SourceRow({ source }: { source: OverallReviewSource }) {
  const average = source.average_stars;
  const count = source.review_count;
  const countText =
    count !== null ? `${count.toLocaleString('en-US')} ${count === 1 ? 'review' : 'reviews'}` : '';
  const label = [
    source.source,
    average !== null ? `rated ${average.toFixed(1)} out of 5` : null,
    count !== null ? `from ${countText}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.sourceRow} accessible accessibilityLabel={label}>
      <Text style={styles.sourceName} numberOfLines={1}>
        {source.source}
      </Text>
      {average !== null ? (
        <View style={styles.sourceRating}>
          <StarRating value={average} size={14} />
          <Text style={styles.sourceAverage}>{average.toFixed(1)}</Text>
        </View>
      ) : null}
      {count !== null ? <Text style={styles.note}>({count.toLocaleString('en-US')})</Text> : null}
    </View>
  );
}

function isOverallReview(data: unknown): data is OverallReviewData {
  const value = data as Partial<OverallReviewData> | null;
  return (
    typeof value?.overall_review === 'string' &&
    value.overall_review.trim() !== '' &&
    typeof value.review_count === 'number' &&
    Array.isArray(value.sources)
  );
}

/** "Nov 1, 2026" */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heading: {
    ...textStyles.subheading,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    backgroundColor: colors.infoSoft,
  },
  badgeText: {
    ...textStyles.caption,
    color: colors.info,
  },
  body: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  sources: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sourceName: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
    flexShrink: 1,
    marginRight: 'auto',
  },
  sourceRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sourceAverage: {
    ...textStyles.label,
    color: colors.textPrimary,
  },
  note: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
});
