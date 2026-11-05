/**
 * Color tokens for the app. Change a value here and every screen that uses it updates.
 * Values match the Recon redesign mockups: navy for structure, orange for the main action.
 *
 * Use these semantic names in components (colors.textSecondary), never raw hex values.
 */
export const colors = {
  // Backgrounds
  background: '#F3F5F7', // screen background (cool gray)
  surface: '#FFFFFF', // cards, sheets, list rows
  surfaceMuted: '#EEF1F4', // input fills, image placeholders, chips, segmented controls

  // Text
  textPrimary: '#0B1B2B', // headings and body text (navy)
  textSecondary: '#5B6B7B', // subtitles, helper text, metadata
  textMuted: '#8A99A8', // placeholders, disabled text
  textOnPrimary: '#FFFFFF', // text on primary and action buttons

  // Brand / actions
  primary: '#0B1B2B', // main buttons (Sign In, Try Again, Add to cart)
  primaryPressed: '#1C2E40',
  action: '#C2410C', // the one big action on a screen: Scan, Checkout, Place order
  actionPressed: '#9A3412',
  actionSoft: '#FFEDD5', // light orange backgrounds, e.g. behind a store icon
  accent: '#1D4ED8', // links, text buttons, active tab
  accentSoft: '#EFF4FF', // light accent backgrounds

  // Navy header band (Home, store tools, admin)
  header: '#0B1B2B',
  textOnHeader: '#FFFFFF',
  textOnHeaderMuted: '#A9B6C4',
  headerChip: 'rgba(255, 255, 255, 0.12)', // store chip and pills on the header
  avatar: '#FDBA74', // initials circle

  // Status: text color, and the soft background for pills and banners
  rating: '#E8A100', // star ratings
  success: '#166534', // in stock, available
  successSoft: '#DCFCE7',
  warning: '#92400E', // low stock, only N left
  warningSoft: '#FEF3C7',
  danger: '#B91C1C', // errors, out of stock, not at this store
  dangerSoft: '#FEE2E2',
  info: '#5B21B6', // demo notes
  infoSoft: '#EDE9FE',
  iconBadge: '#ECEAF6', // circle behind icons on empty/error states

  // Lines and overlays
  border: '#E3E8EE',
  overlay: 'rgba(11, 27, 43, 0.6)', // camera scanner overlay
} as const;

export type ColorName = keyof typeof colors;
