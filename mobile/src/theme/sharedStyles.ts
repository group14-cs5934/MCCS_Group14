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
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.card,
  },
  /** Navy band at the top of Home, store tools and admin, rounded at the bottom. */
  headerBand: {
    backgroundColor: colors.header,
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  /** "Recently scanned", "Recent activity": section titles above a list. */
  sectionTitle: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  /** Small rounded status label, e.g. "In stock". Pair with a status color and its soft fill. */
  pill: {
    ...textStyles.pill,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    overflow: 'hidden',
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
    color: colors.textPrimary,
  },
  link: {
    ...textStyles.bodyStrong,
    color: colors.accent,
  },
});
