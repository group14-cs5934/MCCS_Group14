import { StyleSheet, Text } from 'react-native';

import { colors, radius, spacing, textStyles } from '@/theme';

type Props = {
  label: string;
  /** accent: a role or "You". danger: something taken away, e.g. Deactivated or Hidden. */
  tone: 'accent' | 'danger';
};

/** Small pill label on a row in the admin area, e.g. "Admin" or "Hidden". */
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
