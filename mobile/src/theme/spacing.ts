import type { ViewStyle } from 'react-native';

import { colors } from './colors';

/** Spacing scale (4-point grid) for padding, margins, and gaps. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8, // chips, small badges
  md: 12, // small buttons, inputs, thumbnails
  lg: 16, // buttons, product images
  xl: 18, // cards
  xxl: 28, // bottom corners of the navy header, bottom sheets
  pill: 999, // segmented controls, fully rounded
} as const;

/** Sizes that aren't spacing: touch targets, thumbnails, icons. */
export const sizes = {
  touch: 44, // smallest tap target: icon buttons, steppers
  button: 48, // standard button height
  actionButton: 56, // the big orange action, e.g. "Scan a barcode"
  thumbSmall: 44, // product image in a list row
  thumb: 64, // product image in a cart row
  avatar: 36, // initials circle
  scanTab: 58, // the raised Scan button in the tab bar
  icon: 20,
  iconLarge: 24,
} as const;

export const shadows = {
  card: {
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1, // Android
  },
  raised: {
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} satisfies Record<string, ViewStyle>;
