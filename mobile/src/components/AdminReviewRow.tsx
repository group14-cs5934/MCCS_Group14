import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { deleteReview, setReviewHidden, type ApiError } from '@/api';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import StarRating from '@/components/StarRating';
import { colors, radius, sizes, spacing, textStyles } from '@/theme';
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
      {/* Only the content dims when hidden, so the buttons stay at full strength. */}
      <View style={[styles.content, review.hidden && styles.hiddenContent]}>
        <View style={styles.header}>
          <View style={styles.thumb}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={sizes.icon}
              color={colors.textSecondary}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.product} numberOfLines={1}>
              Product #{review.product_id}
            </Text>
            <Text style={styles.caption} numberOfLines={1}>
              {author} · {date}
            </Text>
          </View>
          {review.hidden ? <Badge label="Hidden" tone="danger" /> : null}
        </View>

        {review.stars ? (
          <View accessible accessibilityLabel={`${review.stars} out of 5 stars`}>
            <StarRating value={review.stars} size={14} />
          </View>
        ) : null}
        <View style={styles.text}>
          {review.title ? <Text style={styles.title}>{review.title}</Text> : null}
          <Text style={styles.body}>{review.body}</Text>
        </View>
      </View>

      {confirmingDelete ? (
        <View style={styles.footer}>
          <Text style={styles.question}>
            Delete this review for good? It can&apos;t be undone. To take it down but keep it, hide
            it instead.
          </Text>
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setConfirmingDelete(false)}
              disabled={busy !== null}
              style={styles.action}
            />
            <DeleteButton
              author={author}
              onPress={remove}
              disabled={busy !== null}
              loading={busy === 'delete'}
            />
          </View>
        </View>
      ) : (
        <View style={styles.footer}>
          <View style={styles.actions}>
            <Button
              title={hideLabel}
              variant="secondary"
              onPress={toggleHidden}
              loading={busy === 'hide'}
              accessibilityLabel={`${hideLabel} review by ${author}`}
              style={styles.action}
            />
            <DeleteButton
              author={author}
              onPress={() => {
                setError(null);
                setConfirmingDelete(true);
              }}
              disabled={busy !== null}
            />
          </View>
          <Button
            title="View product"
            variant="text"
            onPress={() => onOpenProduct(review.product_id)}
            accessibilityLabel={`View the product reviewed by ${author}`}
          />
        </View>
      )}

      {error ? <ErrorBanner message={error} /> : null}
    </Card>
  );
}

function DeleteButton({
  author,
  onPress,
  disabled,
  loading = false,
}: {
  author: string;
  onPress: () => void;
  disabled: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Delete review by ${author}`}
      accessibilityState={{ disabled }}
      style={[styles.delete, disabled && styles.deleteBusy]}
    >
      {loading ? (
        <ActivityIndicator color={colors.danger} />
      ) : (
        <Text style={styles.deleteText}>Delete</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  content: {
    gap: spacing.md,
  },
  hiddenContent: {
    opacity: 0.7,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  thumb: {
    width: sizes.avatar,
    height: sizes.avatar,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  product: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  text: {
    gap: spacing.xs,
  },
  title: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  body: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  footer: {
    gap: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  question: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  action: {
    flex: 1,
    alignSelf: 'auto',
  },
  delete: {
    flex: 1,
    minHeight: sizes.button,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.dangerSoft,
  },
  deleteBusy: {
    opacity: 0.5,
  },
  deleteText: {
    ...textStyles.label,
    color: colors.danger,
  },
});
