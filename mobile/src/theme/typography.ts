// Import each weight from its own path so only these files are bundled (not all 18).
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { Archivo_800ExtraBold } from '@expo-google-fonts/archivo/800ExtraBold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import type { TextStyle } from 'react-native';

/** Font files loaded at startup in App.tsx. */
export const fontAssets = {
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
};

/**
 * Each weight is its own font family. Set fontFamily instead of fontWeight:
 * Android ignores fontWeight on custom fonts. Archivo is for headings and prices, Inter for
 * everything else.
 */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  displayBold: 'Archivo_700Bold',
  displayExtrabold: 'Archivo_800ExtraBold',
} as const;

/** Text styles used across the app. Spread into a style: { ...textStyles.body, color: ... } */
export const textStyles = {
  display: { fontFamily: fonts.displayExtrabold, fontSize: 34, lineHeight: 40 }, // "Recon" on welcome
  hero: { fontFamily: fonts.displayExtrabold, fontSize: 30, lineHeight: 34 }, // "What are you shopping for?"
  title: { fontFamily: fonts.displayExtrabold, fontSize: 28, lineHeight: 34 }, // screen titles
  heading: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28 }, // product name, sections
  subheading: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 24 }, // "Recently scanned"
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 }, // buttons
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 }, // metadata, tab labels
  pill: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14 }, // status pills, badges
  price: { fontFamily: fonts.displayExtrabold, fontSize: 26, lineHeight: 32 }, // "$3.49"
  priceSmall: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 20 }, // prices in lists
} satisfies Record<string, TextStyle>;

export type TextStyleName = keyof typeof textStyles;
