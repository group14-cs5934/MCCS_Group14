import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth';
import Button from '@/components/Button';
import Card from '@/components/Card';
import IconBadge from '@/components/IconBadge';
import { usePreferredStore } from '@/hooks/usePreferredStore';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';

/** Shortcuts for developers, shown only in development builds. */
const devLinks: { label: string; href: Href }[] = [
  // ID 1 is the dev seed script's product in a fresh database (see README: full stack).
  { label: 'Open a sample product', href: '/product/1' },
  { label: 'Theme preview', href: '/theme-preview' },
];

/** Home tab: the app's starting point, with the two ways to find a product, scan or search. */
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isAdmin, signOut } = useAuth();
  const { store, loading: storeLoading } = usePreferredStore();

  // Admins start in the admin area: once their role loads, it opens on top of Home, so Back
  // still reaches the shopper side. Only once per sign-in (Home stays mounted until sign-out).
  const openedAdmin = useRef(false);
  useEffect(() => {
    if (isAdmin && !openedAdmin.current) {
      openedAdmin.current = true;
      router.push('/admin');
    }
  }, [isAdmin, router]);

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

      {/* Waits for the saved store, so "Not chosen yet" never flashes before it. */}
      {storeLoading ? null : (
        <Card style={styles.storeCard}>
          <Ionicons
            name="storefront-outline"
            size={textStyles.subheading.lineHeight}
            color={colors.accent}
          />
          <View style={styles.storeText}>
            <Text style={[textStyles.caption, { color: colors.textSecondary }]}>Your store</Text>
            <Text style={[textStyles.bodyStrong, { color: colors.textPrimary }]}>
              {store ? store.name : 'Not chosen yet'}
            </Text>
          </View>
          <Button
            title={store ? 'Change' : 'Choose'}
            variant="text"
            onPress={() => router.push('/stores')}
            accessibilityLabel={store ? 'Change your store' : 'Choose your store'}
            style={styles.storeButton}
          />
        </Card>
      )}

      {isAdmin ? (
        <Button
          title="Admin"
          variant="secondary"
          icon="shield-checkmark-outline"
          onPress={() => router.push('/admin')}
        />
      ) : null}

      <View style={styles.account}>
        <Text style={[textStyles.caption, { color: colors.textMuted }]}>
          Signed in as {user?.email}
          {isAdmin ? ' · Admin' : ''}
        </Text>
        <Button title="Sign out" variant="text" onPress={signOut} />
      </View>

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
  storeCard: {
    ...sharedStyles.row,
    gap: spacing.md,
  },
  storeText: {
    flex: 1,
    gap: spacing.xxs,
  },
  storeButton: {
    alignSelf: 'auto',
  },
  account: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  devLinks: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
});
