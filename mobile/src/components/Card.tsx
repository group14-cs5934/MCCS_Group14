import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import ErrorBanner from '@/components/ErrorBanner';
import Loader from '@/components/Loader';
import { sharedStyles } from '@/theme';

type Props = {
  children: ReactNode;
  /** Makes the whole card tappable, e.g. a search result. Ignored while loading or on error. */
  onPress?: () => void;
  /** Shows a spinner instead of the children. Wins over error, so a retry shows the spinner. */
  loading?: boolean;
  /** Error message to show instead of the children. */
  error?: string | null;
  /** Adds a Try Again button to the error. */
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** White rounded card. Shows a spinner or error banner in place of its content when told to. */
export default function Card({ children, onPress, loading = false, error, onRetry, style }: Props) {
  if (loading) {
    return (
      <View style={[sharedStyles.card, style]}>
        <Loader size="small" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[sharedStyles.card, style]}>
        <ErrorBanner message={error} onRetry={onRetry} />
      </View>
    );
  }

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [sharedStyles.card, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[sharedStyles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.8,
  },
});
