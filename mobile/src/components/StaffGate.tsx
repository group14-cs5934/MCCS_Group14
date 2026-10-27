import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/auth';
import Button from '@/components/Button';
import ErrorState from '@/components/ErrorState';
import Loader from '@/components/Loader';
import { sharedStyles } from '@/theme';

/**
 * Shows its children only to store staff (workers and managers) and admins: "Checking access…"
 * while the role loads, and "Store staff only" for everyone else. The API checks too, so this
 * isn't the only guard.
 */
export default function StaffGate({ children }: { children: ReactNode }) {
  const { roleLoading, isStaff, isAdmin } = useAuth();

  if (roleLoading) {
    return (
      <View style={sharedStyles.screen}>
        <Loader message="Checking access…" style={sharedStyles.centered} />
      </View>
    );
  }
  return <View style={sharedStyles.screen}>{isStaff || isAdmin ? children : <StaffOnly />}</View>;
}

/** "Store staff only", e.g. also when the API says no (they were removed from the store). */
export function StaffOnly() {
  const router = useRouter();
  return (
    <ErrorState
      title="Store staff only"
      message="You need to work at a store to manage its stock."
      icon="lock-closed-outline"
      style={sharedStyles.centered}
    >
      <Button title="Go Home" variant="secondary" onPress={() => router.replace('/(tabs)')} />
    </ErrorState>
  );
}
