import { StyleSheet } from 'react-native';

import { colors } from './colors';
import { radius, shadows, spacing } from './spacing';
import { textStyles } from './typography';

/** Common layout and text styles shared by many screens. */
export const sharedStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.lg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  title: {
    ...textStyles.title,
    color: colors.textPrimary,
  },
  heading: {
    ...textStyles.heading,
    color: colors.textPrimary,
  },
  body: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  secondaryText: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  price: {
    ...textStyles.price,
    color: colors.accent,
  },
  link: {
    ...textStyles.bodyStrong,
    color: colors.accent,
  },
});
