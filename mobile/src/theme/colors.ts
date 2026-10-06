/**
 * Color tokens for the app. Change a value here and every screen that uses it updates.
 * Values match the Recon mockups in the design document.
 *
 * Use these semantic names in components (colors.textSecondary), never raw hex values.
 */
export const colors = {
  // Backgrounds
  background: '#F4F8FA', // screen background (pale blue-gray)
  surface: '#FFFFFF', // cards, sheets, list rows
  surfaceMuted: '#EEF2F6', // input fills, image placeholders, chips

  // Text
  textPrimary: '#0F172A', // headings and body text
  textSecondary: '#64748B', // subtitles, helper text, metadata
  textMuted: '#94A3B8', // placeholders, disabled text
  textOnPrimary: '#FFFFFF', // text on primary buttons

  // Brand / actions
  primary: '#0F172A', // main buttons (Scan Product, Sign In, Try Again)
  primaryPressed: '#1E293B',
  accent: '#2563EB', // prices, links, active tab
  accentSoft: '#EFF6FF', // light accent backgrounds

  // Status
  rating: '#F5B301', // star ratings
  success: '#22C55E',
  danger: '#EF4444', // errors, favorite heart
  dangerSoft: '#FEF2F2', // error banner background
  iconBadge: '#ECEAF6', // circle behind icons on empty/error states

  // Lines and overlays
  border: '#E2E8F0',
  overlay: 'rgba(15, 23, 42, 0.6)', // camera scanner overlay
} as const;

export type ColorName = keyof typeof colors;
