import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { useCartCount } from '@/hooks/useCartCount';
import { colors, fonts, radius, shadows, sizes, spacing } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Outline icon normally, filled icon when the tab is selected. */
function tabIcon(name: IconName, focusedName: IconName) {
  return function TabIcon({
    color,
    size,
    focused,
  }: {
    color: ColorValue;
    size: number;
    focused: boolean;
  }) {
    return <Ionicons name={focused ? focusedName : name} size={size} color={color} />;
  };
}

/** Scan stands out: an orange circle raised above the bar, with no label under it. */
function ScanTabIcon({ focused }: { focused: boolean }) {
  return (
    <View style={styles.scan}>
      <Ionicons
        name={focused ? 'scan' : 'scan-outline'}
        size={sizes.iconLarge}
        color={colors.textOnPrimary}
      />
    </View>
  );
}

/** Bottom tab bar: Home, Search, Scan (raised, orange, centred), Saved, Cart. */
export default function TabLayout() {
  const { count } = useCartCount();

  return (
    <Tabs
      // Back goes to the tab you came from (e.g. Scan, then Search, then Back returns to Scan),
      // not always to Home.
      backBehavior="history"
      screenOptions={{
        tabBarActiveTintColor: colors.textPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontFamily: fonts.semibold },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontFamily: fonts.displayBold },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        // Home shows its own large title, so it has no header bar.
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: tabIcon('home-outline', 'home'),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          headerShown: false,
          tabBarIcon: tabIcon('search-outline', 'search'),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ScanTabIcon,
          // Hidden, but still names the tab for screen readers ("Scan, tab, 3 of 5").
          tabBarLabelStyle: styles.hiddenLabel,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          headerShown: false,
          tabBarIcon: tabIcon('bookmark-outline', 'bookmark'),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Cart',
          headerShown: false,
          tabBarIcon: tabIcon('cart-outline', 'cart'),
          tabBarBadge: count > 0 ? count : undefined,
          tabBarBadgeStyle: {
            fontFamily: fonts.bold,
            backgroundColor: colors.action,
            color: colors.textOnPrimary,
          },
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scan: {
    width: sizes.scanTab,
    height: sizes.scanTab,
    marginTop: -spacing.xl,
    borderRadius: radius.pill,
    borderWidth: spacing.xs,
    borderColor: colors.surface,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.raised,
  },
  hiddenLabel: {
    display: 'none',
  },
});
