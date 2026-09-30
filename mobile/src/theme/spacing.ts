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
  md: 12, // buttons, inputs
  lg: 16, // cards, product images
  xl: 24, // bottom sheets
  pill: 999, // segmented controls, fully rounded
} as const;

export const shadows = {
  card: {
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2, // Android
  },
} satisfies Record<string, ViewStyle>;
