import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import Button from '@/components/Button';
import { colors, radius, sharedStyles, spacing } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  message: string;
  title?: string;
  icon?: IconName;
  /** Shows a primary retry button that calls this. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra actions shown under the retry button, e.g. a secondary "Search" Button. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Full-screen error: icon, title, message, and Try Again. Use ErrorBanner inside a card. */
export default function ErrorState({
  message,
  title = 'Something went wrong',
  icon = 'alert-circle-outline',
  onRetry,
  retryLabel = 'Try Again',
  children,
  style,
}: Props) {
  return (
    <View style={[styles.container, style]} accessibilityLiveRegion="polite">
      <View style={styles.iconBadge}>
        <Ionicons name={icon} size={32} color={colors.accent} />
      </View>
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`${title}. ${message}`}
        style={styles.text}
      >
        <Text style={[sharedStyles.heading, styles.center]}>{title}</Text>
        <Text style={[sharedStyles.secondaryText, styles.center]}>{message}</Text>
      </View>
      {onRetry || children ? (
        <View style={styles.actions}>
          {onRetry && <Button title={retryLabel} onPress={onRetry} />}
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
  iconBadge: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.iconBadge,
  },
  text: {
    gap: spacing.xs,
  },
  center: {
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: spacing.md,
  },
});
