import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth';
import Button from '@/components/Button';
import RestockBadge from '@/components/RestockBadge';
import { usePreferredStore } from '@/hooks/usePreferredStore';
import { colors, radius, shadows, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import { PERMISSIONS } from '@/types/user';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Shortcuts for developers, shown only in development builds. */
const devLinks: { label: string; href: Href }[] = [
  // ID 1 is the dev seed script's product in a fresh database (see README: full stack).
  { label: 'Open a sample product', href: '/product/1' },
  { label: 'Theme preview', href: '/theme-preview' },
];

/** Up to two initials from an email like "dan.mccabe@x.com" (DM), or its first letters. */
function initialsOf(email: string | undefined): string {
  const name = (email ?? '').split('@')[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** One tappable row of a card: icon, title, optional detail line, optional badge, chevron. */
function MenuRow({
  icon,
  title,
  detail,
  trailing,
  onPress,
  divider,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  trailing?: ReactNode;
  onPress: () => void;
  divider: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        sharedStyles.row,
        styles.menuRow,
        divider && styles.divider,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={sizes.icon} color={colors.textPrimary} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {detail ? (
          <Text style={styles.rowDetail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
      <Ionicons name="chevron-forward" size={sizes.icon} color={colors.textMuted} />
    </Pressable>
  );
}

/** Account screen, opened from the Home avatar: who is signed in, the shopper's store, staff and admin tools, and sign out. */
export default function AccountScreen() {
  const router = useRouter();
  const { user, isAdmin, isStaff, storeId, storeRole, can, signOut } = useAuth();
  const { store } = usePreferredStore();

  const role = isAdmin ? 'Administrator' : isStaff ? (storeRole?.name ?? 'Store staff') : 'Shopper';

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsOf(user?.email)}</Text>
        </View>
        <Text style={styles.email} numberOfLines={1}>
          {user?.email}
        </Text>
        <Text style={sharedStyles.secondaryText}>{role}</Text>
      </View>

      <View style={styles.card}>
        <MenuRow
          icon="location-outline"
          title="Your store"
          detail={store ? store.name : 'Choose your store'}
          onPress={() => router.push('/stores')}
          divider={false}
        />
      </View>

      {/* Store staff look after their store, as far as their store role allows. */}
      {isStaff || isAdmin ? (
        <View style={styles.card}>
          {isStaff ? (
            <MenuRow
              icon="storefront-outline"
              title="My store"
              onPress={() => router.push('/my-store')}
              // How many products need restocking, for staff whose role allows seeing that.
              trailing={
                storeId !== null && can(PERMISSIONS.viewRestock) ? (
                  <RestockBadge storeId={storeId} />
                ) : null
              }
              divider={false}
            />
          ) : null}
          {isAdmin ? (
            <>
              <MenuRow
                icon="shield-checkmark-outline"
                title="Admin"
                onPress={() => router.push('/admin')}
                divider={false}
              />
              <MenuRow
                icon="storefront-outline"
                title="Store tools"
                onPress={() => router.push('/my-store')}
                divider
              />
            </>
          ) : null}
        </View>
      ) : null}

      <Button
        title="Sign out"
        variant="secondary"
        icon="log-out-outline"
        onPress={() => signOut()}
      />

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
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  pressed: {
    opacity: 0.6,
  },
  header: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  avatar: {
    width: sizes.thumb + spacing.xl,
    height: sizes.thumb + spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.avatar,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {
    ...textStyles.title,
    color: colors.textPrimary,
  },
  email: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  card: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  menuRow: {
    gap: spacing.md,
    minHeight: sizes.button + spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowIcon: {
    width: sizes.avatar,
    height: sizes.avatar,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  rowDetail: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  devLinks: {
    alignItems: 'center',
  },
});
