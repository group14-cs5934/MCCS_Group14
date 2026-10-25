
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import {
  deleteMyReview,
  getReviews,
  saveReview,
  type Review,
} from '@/api/review';
import { colors, radius, spacing, textStyles } from '@/theme';

export default function ProductReviews({
  productId,
}: {
  productId: number;
}) {
  const { session } = useAuth();

  const [items, setItems] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const myId = session?.user.id;
  const mine = items.find(
    (item) => item.user_id === myId
  );

  const reload = useCallback(async () => {
    setLoading(true);

    const result = await getReviews(productId);

    if (result.ok) {
      setItems(result.data.items);
      setError('');
    } else {
      setError(result.error.message);
    }

    setLoading(false);
  }, [productId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submit() {
    if (!body.trim() || busy) return;

    setBusy(true);

    const result = await saveReview(
      productId,
      body.trim(),
      title
    );

    if (result.ok) {
      setTitle('');
      setBody('');
      setEditing(false);
      await reload();
    } else {
      setError(result.error.message);
    }

    setBusy(false);
  }

  async function remove() {
    setBusy(true);

    const result = await deleteMyReview(productId);

    if (result.ok) {
      setEditing(false);
      setBody('');
      setTitle('');
      await reload();
    } else {
      setError(result.error.message);
    }

    setBusy(false);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>
        Customer reviews
      </Text>

      {loading && (
        <ActivityIndicator color={colors.accent} />
      )}

      {!!error && (
        <View>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void reload()}>
            <Text style={styles.action}>Try again</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && items.length === 0 && (
        <Text style={styles.muted}>
          No reviews yet. Be the first to share
          your thoughts.
        </Text>
      )}

      {!loading &&
        items.map((review) => (
          <View key={review.id} style={styles.review}>
            <Text style={styles.reviewTitle}>
              {review.title || 'Product review'}
              {review.user_id === myId ? ' (You)' : ''}
            </Text>

            <Text style={styles.muted}>
              {new Date(
                review.created_at
              ).toLocaleDateString()}
            </Text>

            <Text style={styles.reviewBody}>
              {review.body}
            </Text>
          </View>
        ))}

      {!myId ? (
        <Text style={styles.muted}>
          Sign in to write a review.
        </Text>
      ) : (
        <View style={styles.form}>
          <Text style={styles.heading}>
            {mine ? 'Your review' : 'Write a review'}
          </Text>

          {mine && !editing ? (
            <View style={styles.actions}>
              <Pressable
                onPress={() => {
                  setTitle(mine.title || '');
                  setBody(mine.body);
                  setEditing(true);
                }}
              >
                <Text style={styles.action}>
                  Edit review
                </Text>
              </Pressable>

              <Pressable
                disabled={busy}
                onPress={() => void remove()}
              >
                <Text style={styles.error}>
                  Delete review
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="Title (optional)"
                maxLength={100}
                accessibilityLabel="Review title"
              />

              <TextInput
                style={[
                  styles.input,
                  styles.multiline,
                ]}
                value={body}
                onChangeText={setBody}
                placeholder="Share your experience..."
                multiline
                maxLength={2000}
                accessibilityLabel="Review text"
              />

              <Pressable
                style={[
                  styles.button,
                  (!body.trim() || busy) &&
                    styles.disabled,
                ]}
                disabled={!body.trim() || busy}
                onPress={() => void submit()}
              >
                <Text style={styles.buttonText}>
                  {busy
                    ? 'Saving…'
                    : mine
                      ? 'Update review'
                      : 'Post review'}
                </Text>
              </Pressable>

              {editing && (
                <Pressable
                  onPress={() => setEditing(false)}
                >
                  <Text style={styles.action}>
                    Cancel
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  heading: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  muted: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  error: {
    ...textStyles.body,
    color: colors.danger,
  },
  action: {
    ...textStyles.bodyStrong,
    color: colors.accent,
  },
  review: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  reviewTitle: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  reviewBody: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  form: {
    gap: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
  },
  multiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    ...textStyles.bodyStrong,
    color: colors.textOnPrimary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xl,
  },
});
