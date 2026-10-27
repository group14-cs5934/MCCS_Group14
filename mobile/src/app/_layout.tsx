import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { AuthProvider, useAuth } from '@/auth';
import { PreferredStoreProvider } from '@/hooks/usePreferredStore';
import { colors, fontAssets, fonts } from '@/theme';

// Keep the splash screen up until fonts load so text never flashes in the system font.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AuthProvider>
      <PreferredStoreProvider>
        <RootNavigator />
      </PreferredStoreProvider>
    </AuthProvider>
  );
}

/**
 * Root navigator. Signed-out users only see sign-in and sign-up. Signed-in users get the bottom
 * tabs (the (tabs) group), and every other screen here is pushed on top of the tabs, so the back
 * button returns to the tab it was opened from. Signing in or out switches between the two
 * automatically (Stack.Protected).
 */
function RootNavigator() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const { session, initializing } = useAuth();
  // Also wait for the saved session, so a signed-in user never sees the sign-in screen flash.
  const ready = (fontsLoaded || !!fontError) && !initializing;
  const signedIn = session !== null;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
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
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="product/[id]" options={{ title: 'Product' }} />
          <Stack.Screen name="product/barcode/[code]" options={{ title: 'Product' }} />
          <Stack.Screen name="search" options={{ title: 'Search' }} />
          <Stack.Screen name="stores" options={{ title: 'Your store' }} />
          <Stack.Screen name="store/[id]" options={{ title: 'Store' }} />
          <Stack.Screen name="admin" options={{ title: 'Admin' }} />
          <Stack.Screen name="admin-product/[id]" options={{ title: 'Product' }} />
          <Stack.Screen name="theme-preview" options={{ title: 'Theme preview' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
          <Stack.Screen name="sign-up" options={{ title: 'Create account' }} />
        </Stack.Protected>
      </Stack>
      <StatusBar style="dark" />
    </>
  );
}
