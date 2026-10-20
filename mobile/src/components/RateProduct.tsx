import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth';
import Button from '@/components/Button';
import StarRating from '@/components/StarRating';
import { useMyRating, type MyRatingStatus } from '@/hooks/useMyRating';
import { colors, spacing, textStyles } from '@/theme';

type Props = {
  productId: number;
  /** Called after a rating is saved, e.g. to reload the product's average. */
  onSaved?: () => void;
};

const hints: Record<Exclude<MyRatingStatus, 'signed-out'>, string> = {
  loading: 'Loading your rating…',
  ready: 'Tap a star to rate this product.',
  saving: 'Saving your rating…',
  saved: 'Thanks! Your rating was saved.',
  failed: "Couldn't save your rating. Please try again.",
};

/**
 * "Your rating": the signed-in user's stars for this product, which they tap to rate or change.
 * If the API says they're not signed in (e.g. their session expired), it asks them to sign in.
 */
export default function RateProduct({ productId, onSaved }: Props) {
  const { stars, status, rate } = useMyRating(productId, onSaved);
  const { signOut } = useAuth();

  if (status === 'signed-out') {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>Your rating</Text>
        <Text style={styles.hint}>Sign in to rate this product.</Text>
        {/* Signing out clears the expired session, and the app switches to the sign-in screen. */}
        <Button title="Sign In" variant="secondary" icon="log-in-outline" onPress={signOut} />
      </View>
    );
  }

  const hint =
    status === 'ready' && stars > 0 ? 'Tap a star to change your rating.' : hints[status];
  return (
    <View style={styles.section}>
      <Text style={styles.title}>Your rating</Text>
      <StarRating
        value={stars}
        onChange={rate}
        disabled={status === 'loading' || status === 'saving'}
        size={32}
      />
      <Text
        style={[styles.hint, status === 'failed' && styles.error]}
        accessibilityLiveRegion="polite"
        accessibilityRole={status === 'failed' ? 'alert' : undefined}
      >
        {hint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  title: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  hint: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  error: {
    color: colors.danger,
  },
});
