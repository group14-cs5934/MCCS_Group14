import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing, textStyles } from '@/theme';

type Props = Omit<TextInputProps, 'style'> & {
  label: string;
  /** Shown in red below the input, which also gets a red border. */
  error?: string;
  style?: StyleProp<ViewStyle>;
  /** Extra style for the input itself, e.g. a taller box for multiline text. */
  inputStyle?: StyleProp<TextStyle>;
};

/** Labeled text input, e.g. Email and Password on the sign-in screen. */
export default function TextField({
  label,
  error,
  style,
  inputStyle,
  onFocus,
  onBlur,
  ...inputProps
}: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, inputStyle, focused && styles.focused, error ? styles.invalid : null]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  input: {
    ...textStyles.body,
    color: colors.textPrimary,
    minHeight: 48, // comfortable touch target, same as Button
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  focused: {
    borderColor: colors.accent,
  },
  invalid: {
    borderColor: colors.danger,
  },
  error: {
    ...textStyles.caption,
    color: colors.danger,
  },
});
