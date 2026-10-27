import { StyleSheet, Text } from 'react-native';

import { colors, radius, spacing, textStyles } from '@/theme';

type Props = {
  label: string;
  /** accent: e.g. a role, "You", or "Your store". danger: something taken away, e.g. Hidden. */
  tone: 'accent' | 'danger';
};

/** Small pill label on a row, e.g. "Admin" or "Hidden" in the admin area, or "Your store". */
export default function Badge({ label, tone }: Props) {
  return (
    <Text style={[styles.badge, tone === 'accent' ? styles.accent : styles.danger]}>{label}</Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    ...textStyles.caption,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  accent: {
    color: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  danger: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
});
