import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useCartCount } from '@/hooks/useCartCount';
import { colors, fonts } from '@/theme';

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

/** Bottom tab bar: Home, Scan, Saved, Cart (the first three match the mockups). */
export default function TabLayout() {
  const { count } = useCartCount();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.medium },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontFamily: fonts.bold },
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
        name="scan"
        options={{ title: 'Scan', tabBarIcon: tabIcon('scan-outline', 'scan') }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: tabIcon('bookmark-outline', 'bookmark'),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Cart',
          tabBarIcon: tabIcon('cart-outline', 'cart'),
          tabBarBadge: count > 0 ? count : undefined,
          tabBarBadgeStyle: { fontFamily: fonts.bold },
        }}
      />
    </Tabs>
  );
}
