import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, sharedStyles, spacing } from '@/theme';

type Props = {
  /** Text under the spinner, e.g. "Loading product…". Also read aloud by screen readers. */
  message?: string;
  size?: 'small' | 'large';
  style?: StyleProp<ViewStyle>;
};

/** Spinner shown while something is loading. */
export default function Loader({ message, size = 'large', style }: Props) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={message || 'Loading'}
      style={[styles.container, style]}
    >
      <ActivityIndicator size={size} color={colors.accent} />
      {message ? <Text style={[sharedStyles.secondaryText, styles.message]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  message: {
    textAlign: 'center',
  },
});
