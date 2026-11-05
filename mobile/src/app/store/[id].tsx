import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deleteStore, updateStore } from '@/api';
import { useAuth } from '@/auth';
import AsyncContent from '@/components/AsyncContent';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import ErrorBanner from '@/components/ErrorBanner';
import ErrorState from '@/components/ErrorState';
import StoreForm from '@/components/StoreForm';
import { useApiGet } from '@/hooks/useApiGet';
import { usePreferredStore } from '@/hooks/usePreferredStore';
import { colors, radius, shadows, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { Store } from '@/types/store';
import { directionsUrl } from '@/utils/directions';

/**
 * A store's page (T080): its address and hours, a link to directions, and a button to make it the
 * shopper's store (T078). Opened from the store list and from "Available at" on a product page.
 * Admins can also edit or delete the store here.
 */
export default function StoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Only a whole number can be a store, so anything else (a bad link) isn't sent to the API.
  return /^\d+$/.test(id ?? '') ? <StoreLoader storeId={Number(id)} /> : <StoreNotFound />;
}

function StoreNotFound() {
  return (
    <View style={sharedStyles.screen}>
      <ErrorState
        title="Store not found"
        message="This store may have closed or moved."
        icon="storefront-outline"
        style={sharedStyles.centered}
      />
    </View>
  );
}

function StoreLoader({ storeId }: { storeId: number }) {
  const { loading, data, error, reload } = useApiGet<Store>(`/locations/${storeId}`);

  if (error?.status === 404) return <StoreNotFound />;
  return (
    <View style={sharedStyles.screen}>
      <Stack.Screen options={{ title: data?.name ?? 'Store' }} />
      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading store…"
      >
        {data ? <StoreDetails store={data} onChanged={reload} /> : null}
      </AsyncContent>
    </View>
  );
}

function StoreDetails({ store, onChanged }: { store: Store; onChanged: () => void }) {
  const { store: preferred, setStore } = usePreferredStore();
  const { isAdmin } = useAuth();
  const [mapsFailed, setMapsFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const isPreferred = preferred?.id === store.id;

  async function openDirections() {
    setMapsFailed(false);
    try {
      await Linking.openURL(directionsUrl(store));
    } catch {
      setMapsFailed(true);
    }
  }

  if (isAdmin && editing) {
    return (
      <ScrollView
        contentContainerStyle={sharedStyles.screenContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={sharedStyles.title}>Edit store</Text>
        <StoreForm
          store={store}
          submitLabel="Save changes"
          onSubmit={(body) => updateStore(store.id, body)}
          onSaved={(saved) => {
            // A renamed store is also the shopper's remembered one.
            if (isPreferred) setStore({ id: saved.id, name: saved.name, slug: saved.slug });
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={sharedStyles.screenContent}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <View style={styles.tile}>
            <Ionicons name="storefront-outline" size={sizes.iconLarge} color={colors.action} />
          </View>
          <View style={styles.headingText}>
            <Text style={sharedStyles.title}>{store.name}</Text>
            {isPreferred ? <Badge label="Your store" tone="success" /> : null}
          </View>
        </View>
        <View style={sharedStyles.divider} />
        <InfoRow icon="location-outline" label="Address" value={store.address} empty="Not listed" />
        <InfoRow icon="time-outline" label="Hours" value={store.hours} empty="Hours not listed" />
      </View>

      {/* Directions need somewhere to go; a store without an address (e.g. online) has none. */}
      {store.address ? (
        <Button title="Get directions" icon="navigate-outline" onPress={openDirections} />
      ) : null}
      {mapsFailed ? (
        <ErrorBanner message="Couldn't open maps. Search for the address in your maps app." />
      ) : null}

      {isPreferred ? null : (
        <Button
          title="Make this my store"
          variant="secondary"
          icon="storefront-outline"
          onPress={() => setStore({ id: store.id, name: store.name, slug: store.slug })}
        />
      )}

      {isAdmin ? <AdminControls store={store} onEdit={() => setEditing(true)} /> : null}
    </ScrollView>
  );
}

/** Edit and delete, for admins. Deleting is confirmed first: it also removes the store's stock. */
function AdminControls({ store, onEdit }: { store: Store; onEdit: () => void }) {
  const router = useRouter();
  const { store: preferred, setStore } = usePreferredStore();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    const result = await deleteStore(store.id);
    setDeleting(false);
    if (!result.ok) {
      setError(`Couldn't delete the store. ${result.error.serverMessage ?? result.error.message}`);
      return;
    }
    if (preferred?.id === store.id) setStore(null);
    router.dismissTo('/stores');
  }

  return (
    <View style={styles.admin}>
      <Text style={styles.adminTitle}>Admin</Text>
      <Button title="Edit store" icon="create-outline" variant="secondary" onPress={onEdit} />
      {confirming ? (
        <View style={styles.confirm}>
          <Text style={styles.question}>
            Delete {store.name} for good? Its stock records go with it, and its staff become regular
            users. It can&apos;t be undone.
          </Text>
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setConfirming(false)}
              disabled={deleting}
              style={styles.action}
            />
            <Pressable
              onPress={remove}
              disabled={deleting}
              accessibilityRole="button"
              accessibilityLabel="Confirm delete store"
              accessibilityState={{ disabled: deleting }}
              style={[styles.delete, styles.action]}
            >
              <Text style={styles.deleteText}>{deleting ? 'Deleting…' : 'Delete'}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            setError(null);
            setConfirming(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Delete store"
          style={styles.delete}
        >
          <Ionicons name="trash-outline" size={sizes.icon} color={colors.danger} />
          <Text style={styles.deleteText}>Delete store</Text>
        </Pressable>
      )}
      {error ? <ErrorBanner message={error} /> : null}
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  empty,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string | null;
  /** Shown when there's no value. */
  empty: string;
}) {
  return (
    <View style={styles.infoRow} accessible accessibilityLabel={`${label}: ${value || empty}`}>
      <Ionicons name={icon} size={textStyles.subheading.lineHeight} color={colors.textSecondary} />
      <View style={styles.infoText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={value ? styles.infoValue : styles.infoEmpty}>{value || empty}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headingText: {
    flex: 1,
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  tile: {
    width: sizes.thumb,
    height: sizes.thumb,
    borderRadius: radius.md,
    backgroundColor: colors.actionSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  infoText: {
    flex: 1,
    gap: spacing.xxs,
  },
  infoLabel: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  infoValue: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  infoEmpty: {
    ...textStyles.body,
    color: colors.textMuted,
  },
  admin: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  adminTitle: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  confirm: {
    gap: spacing.md,
  },
  question: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  action: {
    flex: 1,
  },
  delete: {
    ...sharedStyles.row,
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: sizes.button,
    borderRadius: radius.lg,
    backgroundColor: colors.dangerSoft,
  },
  deleteText: {
    ...textStyles.label,
    color: colors.danger,
  },
});
