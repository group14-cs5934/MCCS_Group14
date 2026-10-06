import { ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import ErrorState from '@/components/ErrorState';
import Loader from '@/components/Loader';
import {
  colors,
  radius,
  sharedStyles,
  spacing,
  textStyles,
  type ColorName,
  type TextStyleName,
} from '@/theme';

const noop = () => {};

/**
 * Developer screen that renders every theme token and shared component. Change a value in
 * src/theme/ and reload to see it update here. Opened from Home in development builds.
 */
export default function ThemePreview() {
  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.screenContent}>
      <View>
        <Text style={[textStyles.display, { color: colors.textPrimary }]}>Recon</Text>
        <Text style={[textStyles.subheading, { color: colors.textSecondary }]}>
          Scan. Learn. Compare.
        </Text>
      </View>

      <Text style={sharedStyles.heading}>Sample card</Text>
      <Card>
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
        <Button title="Scan Product" icon="scan-outline" onPress={noop} style={styles.cardButton} />
        <Button title="Search manually" variant="text" onPress={noop} />
      </Card>

      <Text style={sharedStyles.heading}>Buttons</Text>
      <View style={styles.stack}>
        <Button title="Primary" onPress={noop} />
        <Button title="Secondary" variant="secondary" onPress={noop} />
        <Button title="Text" variant="text" onPress={noop} />
        <Button title="Loading" loading onPress={noop} />
        <Button title="Disabled" disabled onPress={noop} />
      </View>

      <Text style={sharedStyles.heading}>Loading and errors</Text>
      <Card loading>
        <Text style={sharedStyles.body}>Hidden while loading</Text>
      </Card>
      <Card error="Couldn't load prices." onRetry={noop}>
        <Text style={sharedStyles.body}>Hidden on error</Text>
      </Card>
      <ErrorBanner title="You're offline" message="Showing saved results." />
      <Card>
        <Loader message="Loading product…" />
      </Card>
      <Card>
        <ErrorState
          title="Product not found"
          message="We couldn't find that barcode."
          icon="search-outline"
          onRetry={noop}
          retryLabel="Retry"
        >
          <Button title="Search" variant="secondary" onPress={noop} />
        </ErrorState>
      </Card>

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
  ratingRow: {
    gap: spacing.xs,
    marginVertical: spacing.xs,
  },
  cardButton: {
    marginTop: spacing.lg,
  },
  stack: {
    gap: spacing.md,
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
