import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/auth';
import Button from '@/components/Button';
import ErrorState from '@/components/ErrorState';
import Loader from '@/components/Loader';
import { sharedStyles } from '@/theme';

/**
 * Shows its children only to admins: "Checking access…" while the role loads, and "Admins only"
 * for everyone else. The API checks too, so this isn't the only guard.
 */
export default function AdminGate({ children }: { children: ReactNode }) {
  const { roleLoading, isAdmin } = useAuth();

  if (roleLoading) {
    return (
      <View style={sharedStyles.screen}>
        <Loader message="Checking access…" style={sharedStyles.centered} />
      </View>
    );
  }
  return <View style={sharedStyles.screen}>{isAdmin ? children : <AccessDenied />}</View>;
}

/** "Admins only", e.g. also when the API says no (the role was removed since sign-in). */
export function AccessDenied() {
  const router = useRouter();
  return (
    <ErrorState
      title="Admins only"
      message="You need an admin account to open the admin area."
      icon="lock-closed-outline"
      style={sharedStyles.centered}
    >
      <Button title="Go Home" variant="secondary" onPress={() => router.replace('/(tabs)')} />
    </ErrorState>
  );
}
