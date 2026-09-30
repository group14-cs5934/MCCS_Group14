// Import each weight from its own path so only these files are bundled (not all 18).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import type { TextStyle } from 'react-native';

/** Font files loaded at startup in App.tsx. */
export const fontAssets = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
};

/**
 * Each weight is its own font family. Set fontFamily instead of fontWeight:
 * Android ignores fontWeight on custom fonts.
 */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

/** Text styles used across the app. Spread into a style: { ...textStyles.body, color: ... } */
export const textStyles = {
  display: { fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 40 }, // "Recon" on welcome
  title: { fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 34 }, // "Scan & compare."
  heading: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 }, // product name, screen titles
  subheading: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24 }, // "Recent Scans"
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 }, // buttons
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 }, // metadata, tab labels
  price: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 }, // "$3.49"
} satisfies Record<string, TextStyle>;

export type TextStyleName = keyof typeof textStyles;
