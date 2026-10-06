import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing, textStyles } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

type Variant = 'primary' | 'secondary' | 'text';

type Props = {
  title: string;
  onPress: () => void;
  /** primary: dark fill (main action). secondary: outlined. text: accent-colored, no box. */
  variant?: Variant;
  /** Ionicons name shown before the title, e.g. "scan-outline". */
  icon?: IconName;
  /** Shows a spinner instead of the title and ignores presses. */
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

const contentColors: Record<Variant, string> = {
  primary: colors.textOnPrimary,
  secondary: colors.textPrimary,
  text: colors.accent,
};

/** Tappable button, e.g. Scan Product, Try Again, Search manually. Fills its container's width. */
export default function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
}: Props) {
  const color = contentColors[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        pressed && pressedStyles[variant],
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={textStyles.label.lineHeight} color={color} /> : null}
          <Text style={[textStyles.label, { color }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48, // comfortable touch target
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  disabled: {
    opacity: 0.5,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    paddingHorizontal: spacing.sm,
  },
});

const pressedStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.primaryPressed,
  },
  secondary: {
    backgroundColor: colors.surfaceMuted,
  },
  text: {
    opacity: 0.6,
  },
});
