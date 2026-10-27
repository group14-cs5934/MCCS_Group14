import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { addWorker, removeStaff, type ApiError } from '@/api';
import { useAuth } from '@/auth';
import AsyncContent from '@/components/AsyncContent';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import Loader from '@/components/Loader';
import StaffGate, { StaffOnly } from '@/components/StaffGate';
import StoreStockRow from '@/components/StoreStockRow';
import TextField from '@/components/TextField';
import { useApiGet } from '@/hooks/useApiGet';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH } from '@/hooks/useProductSearch';
import { colors, radius, sharedStyles, spacing, textStyles } from '@/theme';
import type { StaffStockRow, Store } from '@/types/store';
import type { AdminUserAccount } from '@/types/user';

/** Most products the Stock list loads at once (the API's limit). */
export const STOCK_PAGE_SIZE = 50;

/** Server error codes whose message is written for the person adding a worker. */
const ADD_WORKER_CODES = ['user_not_found', 'already_staff', 'account_deactivated'];

type Section = 'stock' | 'staff';

/**
 * My store (store staff roles): a store's stock, which its workers and manager can set by hand,
 * and its staff, which its manager can add workers to and remove them from. Admins pick any store.
 * Everyone else sees "Store staff only"; the API checks too.
 */
export default function MyStoreScreen() {
  return (
    <StaffGate>
      <MyStore />
    </StaffGate>
  );
}

/** Called with the API's code when it refuses (403), e.g. not_your_store or managers_only. */
type OnDenied = (code?: string) => void;

function MyStore() {
  const { isAdmin, isManager, storeId: ownStoreId, refreshRole } = useAuth();
  const [pickedStoreId, setPickedStoreId] = useState<number | null>(null);
  const [section, setSection] = useState<Section>('stock');
  const [denied, setDenied] = useState(false);
  // A manager made a worker since signing in: they keep the Stock tab, but not Staff.
  const [lostStaffAccess, setLostStaffAccess] = useState(false);

  // Their access changed since they signed in, so load their role again (Home then shows the
  // right buttons), and show only what they can still do here.
  const onDenied: OnDenied = useCallback(
    (code) => {
      refreshRole();
      if (code === 'managers_only') {
        setLostStaffAccess(true);
        setSection('stock');
      } else {
        setDenied(true);
      }
    },
    [refreshRole],
  );
  const locations = useApiGet<Store[]>('/locations');
  // Staff always act on their own store; admins choose one.
  const storeId = isAdmin ? pickedStoreId : ownStoreId;

  if (denied) return <StaffOnly />;
  if (storeId === null) {
    return <StorePicker state={locations} onPick={setPickedStoreId} />;
  }

  const storeName = locations.data?.find((store) => store.id === storeId)?.name ?? 'Your store';
  const canManage = (isAdmin || isManager) && !lostStaffAccess;
  const showStaff = canManage && section === 'staff';

  return (
    <>
      <View style={styles.header}>
        <Text style={sharedStyles.title}>{storeName}</Text>
        <Text style={styles.caption}>
          {isAdmin
            ? 'Managing as an admin'
            : isManager
              ? 'You manage this store'
              : 'You work at this store'}
        </Text>
        {isAdmin ? (
          <Button
            title="Choose another store"
            variant="text"
            onPress={() => setPickedStoreId(null)}
            style={styles.left}
          />
        ) : null}
      </View>

      {canManage ? (
        <View style={styles.switcher} accessibilityRole="tablist">
          {(['stock', 'staff'] as const).map((key) => {
            const selected = key === section;
            return (
              <Pressable
                key={key}
                onPress={() => setSection(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={[styles.switchOption, selected && styles.switchOptionSelected]}
              >
                <Text style={[styles.switchText, selected && styles.switchTextSelected]}>
                  {key === 'stock' ? 'Stock' : 'Staff'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {showStaff ? (
        <StoreStaff storeId={storeId} storeName={storeName} onDenied={onDenied} />
      ) : (
        <StoreStock storeId={storeId} onDenied={onDenied} />
      )}
    </>
  );
}

/** For admins: every store, to choose which to manage. */
function StorePicker({
  state: { loading, data, error, reload },
  onPick,
}: {
  state: ReturnType<typeof useApiGet<Store[]>>;
  onPick: (storeId: number) => void;
}) {
  return (
    <AsyncContent
      loading={loading}
      error={error?.message}
      onRetry={reload}
      loadingMessage="Loading stores…"
    >
      <FlatList
        data={data ?? []}
        keyExtractor={(store) => String(store.id)}
        contentContainerStyle={sharedStyles.screenContent}
        ListHeaderComponent={
          <Text style={sharedStyles.secondaryText}>
            Choose a store to manage its stock and staff.
          </Text>
        }
        renderItem={({ item }) => (
          <Card onPress={() => onPick(item.id)} accessibilityLabel={`Manage ${item.name}`}>
            <Text style={styles.name}>{item.name}</Text>
            {item.address ? <Text style={styles.caption}>{item.address}</Text> : null}
          </Card>
        )}
      />
    </AsyncContent>
  );
}

// --- Stock ---

/** Products and their stock at this store, searchable by name or barcode. */
function StoreStock({ storeId, onDenied }: { storeId: number; onDenied: OnDenied }) {
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const params = new URLSearchParams({ limit: String(STOCK_PAGE_SIZE) });
  if (query) params.set('q', query);
  const { loading, data, error, reload } = useApiGet<StaffStockRow[]>(
    `/staff/stores/${storeId}/stock?${params}`,
  );
  const refused = error?.status === 403 ? error.code : null;
  useEffect(() => {
    if (refused !== null) onDenied(refused);
  }, [refused, onDenied]);

  if (refused !== null) return <StaffOnly />;

  const rows = data ?? [];
  return (
    <>
      <View style={styles.search}>
        <TextField
          label="Find a product"
          placeholder="Name or barcode"
          value={text}
          onChangeText={setText}
          maxLength={SEARCH_MAX_LENGTH}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading stock…"
      >
        <FlatList
          data={rows}
          // Keyed by what was loaded, so a row shows fresh values once the list loads again.
          keyExtractor={(row) => `${row.product.id}:${row.updated_at}:${row.admin_set_at}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={styles.caption} accessibilityLiveRegion="polite">
              {stockCountText(rows.length, query)}
            </Text>
          }
          renderItem={({ item }) => (
            <StoreStockRow storeId={storeId} row={item} onDenied={onDenied} />
          )}
        />
      </AsyncContent>
    </>
  );
}

/** "12 products", "No products match "x".", or "Showing the first 50 products…". */
function stockCountText(count: number, query: string): string {
  if (count === 0) return query ? `No products match "${query}".` : 'No products yet.';
  if (count >= STOCK_PAGE_SIZE) {
    return `Showing the first ${STOCK_PAGE_SIZE} products. Search to find others.`;
  }
  return `${count} ${count === 1 ? 'product' : 'products'}`;
}

// --- Staff ---

/** The store's manager(s) and workers, with a form to add a worker (managers and admins). */
function StoreStaff({
  storeId,
  storeName,
  onDenied,
}: {
  storeId: number;
  storeName: string;
  onDenied: OnDenied;
}) {
  const { user, isAdmin } = useAuth();
  const { loading, data, error, reload } = useApiGet<AdminUserAccount[]>(
    `/staff/stores/${storeId}/staff`,
  );
  const refused = error?.status === 403 ? error.code : null;
  useEffect(() => {
    if (refused !== null) onDenied(refused);
  }, [refused, onDenied]);

  if (refused !== null) return null; // My store shows what they can still do

  return (
    <FlatList
      data={loading || error ? [] : (data ?? [])}
      keyExtractor={(person) => person.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.staffHeader}>
          <AddWorker storeId={storeId} onAdded={reload} onDenied={onDenied} />
          {loading ? <Loader message="Loading staff…" size="small" /> : null}
          {error ? <ErrorBanner message={error.message} onRetry={reload} /> : null}
        </View>
      }
      renderItem={({ item }) => (
        <StaffRow
          storeId={storeId}
          storeName={storeName}
          person={item}
          isSelf={item.id === user?.id}
          // Only admins remove managers; the API checks too.
          canRemove={item.id !== user?.id && (item.role === 'worker' || isAdmin)}
          onRemoved={reload}
          onDenied={onDenied}
        />
      )}
    />
  );
}

function AddWorker({
  storeId,
  onAdded,
  onDenied,
}: {
  storeId: number;
  onAdded: () => void;
  onDenied: OnDenied;
}) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);

  async function add() {
    const typed = email.trim();
    if (savingNow.current) return;
    if (!typed) {
      setMessage({ tone: 'error', text: 'Enter the email they signed up with.' });
      return;
    }
    savingNow.current = true;
    setSaving(true);
    setMessage(null);
    const result = await addWorker(storeId, typed);
    savingNow.current = false;
    setSaving(false);
    if (result.ok) {
      setEmail('');
      setMessage({ tone: 'success', text: `${result.data.email ?? typed} is now a worker here.` });
      onAdded();
    } else if (result.error.status === 403) {
      onDenied(result.error.code);
    } else {
      setMessage({ tone: 'error', text: addWorkerError(result.error) });
    }
  }

  return (
    <Card style={styles.addCard}>
      <Text style={styles.name}>Add a worker</Text>
      <Text style={styles.caption}>
        They sign up in the app first, then you add them by their email.
      </Text>
      <TextField
        label="Their email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        onSubmitEditing={add}
      />
      {message ? (
        message.tone === 'error' ? (
          <ErrorBanner message={message.text} />
        ) : (
          <Text style={styles.success} accessibilityLiveRegion="polite">
            {message.text}
          </Text>
        )
      ) : null}
      <Button title="Add worker" onPress={add} loading={saving} />
    </Card>
  );
}

function addWorkerError(error: ApiError): string {
  if (error.code && ADD_WORKER_CODES.includes(error.code) && error.serverMessage) {
    return error.serverMessage;
  }
  return `Couldn't add the worker. ${error.message}`;
}

function StaffRow({
  storeId,
  storeName,
  person,
  isSelf,
  canRemove,
  onRemoved,
  onDenied,
}: {
  storeId: number;
  storeName: string;
  person: AdminUserAccount;
  isSelf: boolean;
  canRemove: boolean;
  onRemoved: () => void;
  onDenied: OnDenied;
}) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingNow = useRef(false);
  const email = person.email ?? 'No email';
  const roleLabel = person.role === 'manager' ? 'Manager' : 'Worker';

  async function remove() {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setError(null);
    const result = await removeStaff(storeId, person.id);
    savingNow.current = false;
    setSaving(false);
    // Already gone (removed elsewhere) is as good as removed.
    if (result.ok || result.error.code === 'staff_not_found') return onRemoved();
    if (result.error.status === 403 && result.error.code !== 'admins_only') {
      return onDenied(result.error.code);
    }
    setConfirming(false);
    setError(result.error.serverMessage ?? `Couldn't remove ${email}. ${result.error.message}`);
  }

  return (
    <Card style={styles.staffCard}>
      <View
        style={styles.staffSummary}
        accessible
        accessibilityLabel={`${email}, ${isSelf ? 'you, ' : ''}${roleLabel}`}
      >
        <Text style={[styles.name, styles.grow]} numberOfLines={1}>
          {email}
        </Text>
        {isSelf ? <Badge label="You" tone="accent" /> : null}
        <Badge label={roleLabel} tone="accent" />
      </View>
      {canRemove && confirming ? (
        <View style={styles.confirm}>
          <Text style={styles.question}>
            Remove {email} from {storeName}? They&apos;ll become a regular user.
          </Text>
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="text"
              onPress={() => setConfirming(false)}
              disabled={saving}
              style={styles.action}
            />
            <Button
              title="Remove"
              variant="secondary"
              onPress={remove}
              loading={saving}
              accessibilityLabel={`Remove ${email}`}
              style={styles.action}
            />
          </View>
        </View>
      ) : canRemove ? (
        <Button
          title="Remove"
          variant="text"
          onPress={() => {
            setError(null);
            setConfirming(true);
          }}
          accessibilityLabel={`Remove ${email}`}
          style={styles.left}
        />
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xxs,
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  left: {
    alignSelf: 'flex-start',
  },
  switcher: {
    flexDirection: 'row',
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: spacing.xxs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  switchOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  switchOptionSelected: {
    backgroundColor: colors.surface,
  },
  switchText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  switchTextSelected: {
    color: colors.textPrimary,
  },
  search: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  list: {
    gap: spacing.md,
    padding: spacing.xl,
  },
  name: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  grow: {
    flex: 1,
  },
  staffHeader: {
    gap: spacing.md,
  },
  addCard: {
    gap: spacing.sm,
  },
  success: {
    ...textStyles.body,
    color: colors.success,
  },
  staffCard: {
    gap: spacing.sm,
  },
  staffSummary: {
    ...sharedStyles.row,
    gap: spacing.sm,
  },
  confirm: {
    gap: spacing.xs,
  },
  question: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  action: {
    alignSelf: 'auto',
  },
});
