import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getMyReview, postReview } from '@/api';
import { useAuth } from '@/auth';
import Button from '@/components/Button';
import ErrorBanner from '@/components/ErrorBanner';
import TextField from '@/components/TextField';
import { colors, spacing, textStyles } from '@/theme';
import { REVIEW_BODY_MAX_LENGTH, validateReview, type ReviewErrors } from '@/utils/review';

type Props = {
  productId: number;
  /** Called after the review is saved, e.g. to reload the list so it shows up there. */
  onPosted?: () => void;
};

type Status =
  | 'loading' // loading the user's earlier review, if any
  | 'ready'
  | 'posting'
  | 'posted'
  | 'signed-out'; // the API says the user isn't signed in (e.g. their session expired)

/**
 * "Write a review": an optional title and the review text. Too long or empty shows an error and
 * nothing is posted. If the user already reviewed the product, the form starts with their review,
 * and posting replaces it.
 */
export default function ReviewForm({ productId, onPosted }: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [hasReview, setHasReview] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [fieldErrors, setFieldErrors] = useState<ReviewErrors>({});
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const { signOut } = useAuth();

  useEffect(() => {
    const controller = new AbortController();
    getMyReview(productId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setTitle(result.data.title ?? '');
        setBody(result.data.body);
        setHasReview(true);
        setStatus('ready');
      } else if (result.error.status === 401) {
        setStatus('signed-out');
      } else {
        // 404 means they haven't reviewed it. Any other problem: they can still write one now.
        setStatus('ready');
      }
    });
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, [productId]);

  function submit() {
    const errors = validateReview(title, body);
    setFieldErrors(errors);
    setError(null);
    if (errors.title || errors.body) return;

    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setStatus('posting');
    const review = { title: title.trim() || null, body: body.trim() };
    postReview(productId, review, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setTitle(result.data.title ?? '');
        setBody(result.data.body);
        setHasReview(true);
        setStatus('posted');
        onPosted?.();
        return;
      }
      if (result.error.status === 401) {
        setStatus('signed-out');
        return;
      }
      setStatus('ready');
      setError(
        result.error.status === 422
          ? "Your review couldn't be posted. Check that it's 1 to 2,000 characters and try again."
          : result.error.message,
      );
    });
  }

  if (status === 'signed-out') {
    return (
      <View style={styles.section}>
        <Text style={styles.heading}>Write a review</Text>
        <Text style={styles.hint}>Sign in to review this product.</Text>
        {/* Signing out clears the expired session, and the app switches to the sign-in screen. */}
        <Button title="Sign In" variant="secondary" icon="log-in-outline" onPress={signOut} />
      </View>
    );
  }

  const length = body.trim().length;
  const tooLong = length > REVIEW_BODY_MAX_LENGTH;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{hasReview ? 'Your review' : 'Write a review'}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <TextField
        label="Title (optional)"
        value={title}
        onChangeText={setTitle}
        error={fieldErrors.title}
        editable={status !== 'loading'}
        placeholder="Sum it up in a few words"
        returnKeyType="next"
      />
      <TextField
        label="Review"
        value={body}
        onChangeText={setBody}
        error={fieldErrors.body}
        editable={status !== 'loading'}
        placeholder="What did you like or dislike?"
        multiline
        textAlignVertical="top"
        inputStyle={styles.body}
      />
      <Text
        style={[styles.hint, styles.counter, tooLong && styles.error]}
        accessibilityLabel={`${length} of ${REVIEW_BODY_MAX_LENGTH} characters`}
      >
        {length.toLocaleString('en-US')} / {REVIEW_BODY_MAX_LENGTH.toLocaleString('en-US')}
      </Text>
      {status === 'posted' ? (
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          Thanks! Your review was posted.
        </Text>
      ) : null}
      <Button
        title={hasReview ? 'Update review' : 'Post review'}
        onPress={submit}
        loading={status === 'posting'}
        disabled={status === 'loading'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  heading: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  body: {
    minHeight: 120,
    paddingVertical: spacing.md,
  },
  hint: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  counter: {
    ...textStyles.caption,
    alignSelf: 'flex-end',
  },
  error: {
    color: colors.danger,
  },
});
