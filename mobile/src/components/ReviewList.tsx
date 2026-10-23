import { StyleSheet, Text, View } from 'react-native';

import Button from '@/components/Button';
import ErrorBanner from '@/components/ErrorBanner';
import Loader from '@/components/Loader';
import StarRating from '@/components/StarRating';
import type { ReviewsState } from '@/hooks/useReviews';
import { colors, spacing, textStyles } from '@/theme';
import type { Review } from '@/types/review';

type Props = {
  state: ReviewsState;
};

/**
 * A product's reviews, newest first. The next page loads when the shopper scrolls to the bottom
 * (the product page calls `state.loadMore`), or when they tap Show more reviews.
 */
export default function ReviewList({
  state: { reviews, total, loading, loadingMore, error, moreError, hasMore, loadMore, reload },
}: Props) {
  if (loading) {
    return <Loader message="Loading reviews…" size="small" style={styles.status} />;
  }
  if (error) {
    return <ErrorBanner title="Couldn't load reviews" message={error} onRetry={reload} />;
  }
  if (reviews.length === 0) {
    return <Text style={[styles.note, styles.status]}>No reviews yet.</Text>;
  }

  return (
    <View style={styles.list}>
      <Text style={styles.heading} accessibilityRole="header">
        {total.toLocaleString('en-US')} {total === 1 ? 'review' : 'reviews'}
      </Text>
      {reviews.map((review) => (
        <ReviewItem key={review.id} review={review} />
      ))}
      {loadingMore ? <Loader message="Loading more reviews…" size="small" /> : null}
      {moreError ? (
        <ErrorBanner title="Couldn't load more reviews" message={moreError} onRetry={loadMore} />
      ) : null}
      {hasMore && !loadingMore && !moreError ? (
        <Button title="Show more reviews" variant="text" onPress={loadMore} />
      ) : null}
    </View>
  );
}

function ReviewItem({ review }: { review: Review }) {
  const date = formatDate(review.created_at);
  return (
    <View style={styles.item}>
      <View style={styles.meta}>
        {review.stars ? (
          <View
            accessible
            accessibilityLabel={`${review.stars} out of 5 stars`}
            style={styles.stars}
          >
            <StarRating value={review.stars} size={14} />
          </View>
        ) : null}
        <Text style={styles.note}>
          {review.author} · {date}
        </Text>
      </View>
      {review.title ? <Text style={styles.title}>{review.title}</Text> : null}
      <Text style={styles.body}>{review.body}</Text>
    </View>
  );
}

/** "Oct 20, 2026" */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.lg,
  },
  status: {
    paddingVertical: spacing.lg,
  },
  heading: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  item: {
    gap: spacing.xs,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stars: {
    flexDirection: 'row',
  },
  title: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  body: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  note: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
});
