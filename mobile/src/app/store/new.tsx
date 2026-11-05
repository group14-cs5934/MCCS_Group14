import { Stack, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { createStore } from '@/api';
import AdminGate from '@/components/AdminGate';
import StoreForm from '@/components/StoreForm';
import { sharedStyles } from '@/theme';

/** Add a store (admins only): the form, then back to the list with the new store in it. */
export default function NewStoreScreen() {
  const router = useRouter();
  return (
    <AdminGate>
      <ScrollView
        contentContainerStyle={sharedStyles.screenContent}
        keyboardShouldPersistTaps="handled"
      >
        <Stack.Screen options={{ title: 'Add store' }} />
        <StoreForm
          submitLabel="Add store"
          onSubmit={createStore}
          onSaved={() => router.back()}
          onCancel={() => router.back()}
        />
      </ScrollView>
    </AdminGate>
  );
}
