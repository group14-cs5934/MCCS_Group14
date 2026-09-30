import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  radius,
  sharedStyles,
  spacing,
  textStyles,
  type ColorName,
  type TextStyleName,
} from '@/theme';

/**
 * Developer screen that renders every theme token. Change a value in src/theme/ and
 * reload to see it update here. Temporary until real screens replace it (T003/T016).
 */
export default function ThemePreview() {
  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={styles.content}>
      <View>
        <Text style={[textStyles.display, { color: colors.textPrimary }]}>Recon</Text>
        <Text style={[textStyles.subheading, { color: colors.textSecondary }]}>
          Scan. Learn. Compare.
        </Text>
      </View>

      <Text style={sharedStyles.heading}>Sample card</Text>
      <View style={sharedStyles.card}>
        <Text style={[textStyles.caption, { color: colors.textSecondary }]}>
          Lay&apos;s • Snacks &amp; Chips
        </Text>
        <Text style={sharedStyles.heading}>Lay&apos;s Sour Cream &amp; Onion</Text>
        <View style={[sharedStyles.row, styles.ratingRow]}>
          <Text style={[textStyles.bodyStrong, { color: colors.rating }]}>★</Text>
          <Text style={[textStyles.bodyStrong, { color: colors.textPrimary }]}>4.6</Text>
          <Text style={sharedStyles.secondaryText}>(1,234 reviews)</Text>
        </View>
        <Text style={sharedStyles.price}>$3.49</Text>
        <View style={styles.button}>
          <Text style={[textStyles.label, { color: colors.textOnPrimary }]}>Scan Product</Text>
        </View>
        <Text style={[sharedStyles.link, styles.centerText]}>Search manually</Text>
      </View>

      <Text style={sharedStyles.heading}>Colors</Text>
      <View style={styles.swatchGrid}>
        {(Object.keys(colors) as ColorName[]).map((name) => (
          <View key={name} style={styles.swatch}>
            <View style={[styles.swatchColor, { backgroundColor: colors[name] }]} />
            <Text style={[textStyles.caption, { color: colors.textPrimary }]}>{name}</Text>
            <Text style={[textStyles.caption, { color: colors.textMuted }]}>{colors[name]}</Text>
          </View>
        ))}
      </View>

      <Text style={sharedStyles.heading}>Typography</Text>
      <View style={sharedStyles.card}>
        {(Object.keys(textStyles) as TextStyleName[]).map((name) => (
          <Text key={name} style={[textStyles[name], { color: colors.textPrimary }]}>
            {name} · {textStyles[name].fontSize}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    ...StyleSheet.flatten(sharedStyles.screenContent),
    paddingTop: spacing.xxxl + spacing.lg,
  },
  ratingRow: {
    gap: spacing.xs,
    marginVertical: spacing.xs,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md + spacing.xxs,
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  centerText: {
    textAlign: 'center',
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  swatch: {
    width: 96,
  },
  swatchColor: {
    height: 48,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
});
