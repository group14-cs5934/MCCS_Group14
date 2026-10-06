import { useRouter, type Href } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '@/components/Button';
import Card from '@/components/Card';
import IconBadge from '@/components/IconBadge';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';

/** Shortcuts for developers, shown only in development builds. */
const devLinks: { label: string; href: Href }[] = [
  { label: 'Open a sample product', href: '/product/sample-lays' },
  { label: 'Theme preview', href: '/theme-preview' },
];

/** Home tab: the app's starting point, with the two ways to find a product, scan or search. */
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={sharedStyles.screen}
      contentContainerStyle={[sharedStyles.screenContent, { paddingTop: insets.top + spacing.xl }]}
    >
      <View style={styles.intro}>
        <Text style={sharedStyles.title}>Scan & compare.</Text>
        <Text style={sharedStyles.secondaryText}>
          Scan a barcode or search by name to see a product&apos;s price, ratings, and reviews.
        </Text>
      </View>

      <Card style={styles.scanCard}>
        <IconBadge icon="barcode-outline" />
        <View style={styles.scanText}>
          <Text style={[textStyles.subheading, styles.center, { color: colors.textPrimary }]}>
            Scan a product
          </Text>
          <Text style={[sharedStyles.secondaryText, styles.center]}>
            Point your camera at a product&apos;s barcode.
          </Text>
        </View>
        <Button
          title="Scan Product"
          icon="scan-outline"
          onPress={() => router.navigate('/scan')}
          style={styles.stretch}
        />
        <Button title="Search manually" variant="text" onPress={() => router.push('/search')} />
      </Card>

      {__DEV__ && (
        <View style={styles.devLinks}>
          <Text style={[textStyles.caption, { color: colors.textMuted }]}>Developer</Text>
          {devLinks.map((link) => (
            <Button
              key={link.label}
              title={link.label}
              variant="text"
              onPress={() => router.push(link.href)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: spacing.sm,
  },
  scanCard: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  scanText: {
    gap: spacing.xs,
  },
  center: {
    textAlign: 'center',
  },
  stretch: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  devLinks: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
});
