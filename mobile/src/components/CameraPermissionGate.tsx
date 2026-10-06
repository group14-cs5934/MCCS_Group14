import { useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';

import Button from '@/components/Button';
import ErrorState from '@/components/ErrorState';
import IconBadge from '@/components/IconBadge';
import Loader from '@/components/Loader';
import { sharedStyles, spacing } from '@/theme';

type Props = {
  /** Shown once camera access is granted, e.g. the barcode scanner. */
  children: ReactNode;
};

/**
 * Asks for camera access before showing its children. Until access is granted it shows an
 * explanation with a button to allow it, or a link to Settings if the user already said no.
 */
export default function CameraPermissionGate({ children }: Props) {
  const router = useRouter();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const granted = permission?.granted ?? false;

  // Access can only be turned back on in Settings, so re-check when the user returns to the app.
  useEffect(() => {
    if (granted) {
      return;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        getPermission();
      }
    });
    return () => subscription.remove();
  }, [granted, getPermission]);

  if (!permission) {
    return <Loader message="Checking camera access…" style={sharedStyles.centered} />;
  }

  if (granted) {
    return <>{children}</>;
  }

  const searchButton = (
    <Button
      title="Search manually"
      variant="secondary"
      icon="search-outline"
      onPress={() => router.push('/search')}
    />
  );

  // The system prompt can't be shown again (iOS after one "Don't Allow", Android after two).
  if (!permission.canAskAgain) {
    return (
      <ErrorState
        icon="camera-outline"
        title="Camera access is off"
        message="Recon needs your camera to scan barcodes. Turn on Camera for Recon in Settings, then come back to this screen."
        retryLabel="Open Settings"
        // Nothing useful to do if Settings can't be opened; the message says where to go.
        onRetry={() => Linking.openSettings().catch(() => {})}
        style={sharedStyles.centered}
      >
        {searchButton}
      </ErrorState>
    );
  }

  return (
    <View style={[sharedStyles.centered, styles.container]}>
      <IconBadge icon="camera-outline" />
      <View style={styles.text}>
        <Text style={[sharedStyles.heading, styles.center]}>Allow camera access</Text>
        <Text style={[sharedStyles.secondaryText, styles.center]}>
          Recon uses your camera to scan product barcodes. Nothing is recorded or saved.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button title="Allow Camera Access" icon="camera-outline" onPress={requestPermission} />
        {searchButton}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  text: {
    gap: spacing.xs,
  },
  center: {
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: spacing.md,
  },
});
