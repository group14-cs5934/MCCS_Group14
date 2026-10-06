import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import Button from '@/components/Button';
import { colors, radius, spacing, textStyles } from '@/theme';

type Props = {
  message: string;
  title?: string;
  /** Shows a retry button that calls this. */
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** Compact error message for inside a card or above a list. Use ErrorState for a whole screen. */
export default function ErrorBanner({
  message,
  title,
  onRetry,
  retryLabel = 'Try Again',
  style,
}: Props) {
  return (
    <View style={[styles.container, style]} accessibilityLiveRegion="polite">
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLabel={title ? `${title}. ${message}` : message}
        style={styles.alert}
      >
        <Ionicons name="alert-circle" size={textStyles.body.lineHeight} color={colors.danger} />
        <View style={styles.text}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
      {onRetry && <Button title={retryLabel} variant="text" onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  alert: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  text: {
    flex: 1,
  },
  title: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  message: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
});
