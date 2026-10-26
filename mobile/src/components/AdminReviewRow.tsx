import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { deleteReview, setReviewHidden, type ApiError } from '@/api';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import StarRating from '@/components/StarRating';
import { colors, spacing, textStyles } from '@/theme';
import type { AdminReview } from '@/types/review';

function failureMessage(error: ApiError, what: string): string {
  if (error.code === 'review_not_found') return 'This review no longer exists.';
  return `Couldn't ${what} this review. ${error.message}`;
}

type Props = {
  review: AdminReview;
  /** Called with the review as the API returns it after hiding or showing it. */
  onUpdated: (review: AdminReview) => void;
  /** Called once the review is deleted. */
  onDeleted: (reviewId: number) => void;
  /** Opens the reviewed product's page. */
  onOpenProduct: (productId: number) => void;
  /** Called when the API refuses with 403: the signed-in user is no longer an admin. */
  onDenied: () => void;
};

/**
 * A review in the admin area (T098): who wrote it (their full email), their stars, and what it
 * says, with buttons to hide it from the product page (or show it again) and to delete it. Hiding
 * takes effect at once and can be undone; deleting is confirmed first, since it can't.
 */
export default function AdminReviewRow({
  review,
  onUpdated,
  onDeleted,
  onOpenProduct,
  onDenied,
}: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState<'hide' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set at once (state only changes on the next render), so a quick second tap can't send twice.
  const busyNow = useRef(false);

  const author = review.author_email ?? review.author;
  const date = new Date(review.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const hideLabel = review.hidden ? 'Show' : 'Hide';

  /** Runs one change at a time, showing a spinner on its button meanwhile. */
  async function run(kind: 'hide' | 'delete', send: () => Promise<void>) {
    if (busyNow.current) return;
    busyNow.current = true;
    setBusy(kind);
    setError(null);
    try {
      await send();
    } finally {
      busyNow.current = false;
      setBusy(null);
    }
  }

  /** Shows why a change failed, or "Admins only" if the API says the user isn't an admin. */
  function fail(error: ApiError, what: string) {
    if (error.status === 403) onDenied();
    else setError(failureMessage(error, what));
  }

  const toggleHidden = () =>
    run('hide', async () => {
      const result = await setReviewHidden(review.id, !review.hidden);
      if (result.ok) onUpdated(result.data);
      else fail(result.error, review.hidden ? 'show' : 'hide');
    });

  const remove = () =>
    run('delete', async () => {
      const result = await deleteReview(review.id);
      // Already gone (e.g. another admin deleted it) is as good as deleted.
      if (result.ok || result.error.code === 'review_not_found') onDeleted(review.id);
      // The question stays open after a failure, so the admin can try again.
      else fail(result.error, 'delete');
    });

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.author} numberOfLines={1}>
            {author}
          </Text>
          <Text style={styles.caption}>
            Product #{review.product_id} · {date}
          </Text>
        </View>
        {review.hidden ? <Badge label="Hidden" tone="danger" /> : null}
      </View>

      {review.stars ? (
        <View accessible accessibilityLabel={`${review.stars} out of 5 stars`}>
          <StarRating value={review.stars} size={14} />
        </View>
      ) : null}
      {review.title ? <Text style={styles.title}>{review.title}</Text> : null}
      <Text style={styles.body}>{review.body}</Text>

      {confirmingDelete ? (
        <View style={styles.confirm}>
          <Text style={styles.question}>
            Delete this review for good? It can&apos;t be undone. To take it down but keep it, hide
            it instead.
          </Text>
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="text"
              onPress={() => setConfirmingDelete(false)}
              disabled={busy !== null}
              style={styles.action}
            />
            <Button
              title="Delete"
              variant="secondary"
              onPress={remove}
              loading={busy === 'delete'}
              accessibilityLabel={`Delete review by ${author}`}
              style={styles.action}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            title="View product"
            variant="text"
            onPress={() => onOpenProduct(review.product_id)}
            accessibilityLabel={`View the product reviewed by ${author}`}
            style={styles.action}
          />
          <Button
            title={hideLabel}
            variant="text"
            onPress={toggleHidden}
            loading={busy === 'hide'}
            accessibilityLabel={`${hideLabel} review by ${author}`}
            style={styles.action}
          />
          <Button
            title="Delete"
            variant="text"
            onPress={() => {
              setError(null);
              setConfirmingDelete(true);
            }}
            disabled={busy !== null}
            accessibilityLabel={`Delete review by ${author}`}
            style={styles.action}
          />
        </View>
      )}

      {error ? <ErrorBanner message={error} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  author: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  title: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  body: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  confirm: {
    gap: spacing.xs,
  },
  question: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  action: {
    alignSelf: 'auto',
  },
});
