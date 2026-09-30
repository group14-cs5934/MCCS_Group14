import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { colors, fontAssets, fonts } from '@/theme';

// Keep the splash screen up until fonts load so text never flashes in the system font.
SplashScreen.preventAutoHideAsync();

/**
 * Root navigator. The bottom tabs live in the (tabs) group; every other screen here is
 * pushed on top of the tabs, so the back button returns to the tab it was opened from.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: fonts.bold },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="product/[id]" options={{ title: 'Product' }} />
        <Stack.Screen name="search" options={{ title: 'Search' }} />
        <Stack.Screen name="theme-preview" options={{ title: 'Theme preview' }} />
      </Stack>
      <StatusBar style="dark" />
    </>
  );
}
