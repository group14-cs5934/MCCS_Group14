import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth';
import AsyncContent from '@/components/AsyncContent';
import Card from '@/components/Card';
import StaffGate, { StaffOnly } from '@/components/StaffGate';
import RestockBadge from '@/components/RestockBadge';
import SectionTabs from '@/components/SectionTabs';
import StoreInfoSection from '@/components/StoreInfoSection';
import StoreRestockSection from '@/components/StoreRestockSection';
import StoreRolesSection from '@/components/StoreRolesSection';
import StoreStaffSection from '@/components/StoreStaffSection';
import StoreStockRow from '@/components/StoreStockRow';
import TextField from '@/components/TextField';
import type { OnDenied } from '@/components/storeAccess';
import { useApiGet } from '@/hooks/useApiGet';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH } from '@/hooks/useProductSearch';
import { colors, radius, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { RestockSummary } from '@/types/restock';
import type { StaffStockRow, Store } from '@/types/store';
import { PERMISSIONS } from '@/types/user';

/** Most products the Stock list loads at once (the API's limit). */
export const STOCK_PAGE_SIZE = 50;

type Section = 'stock' | 'restock' | 'staff' | 'roles' | 'info';

/** Each section, its tab label, and the permission that shows it. */
const SECTIONS: { key: Section; label: string; shortLabel?: string; permission: string }[] = [
  { key: 'stock', label: 'Stock', permission: PERMISSIONS.editStock },
  { key: 'restock', label: 'Restock', permission: PERMISSIONS.viewRestock },
  { key: 'staff', label: 'Staff', permission: PERMISSIONS.viewStaff },
  { key: 'roles', label: 'Roles', permission: PERMISSIONS.manageRoles },
  { key: 'info', label: 'Store info', shortLabel: 'Info', permission: PERMISSIONS.editStoreInfo },
];

/**
 * My store (store staff): the sections of a store their store role allows: its stock, what needs
 * restocking, its staff, its roles and its address and hours. Admins pick any store and see everything. Everyone else
 * sees "Store staff only"; the API checks too.
 */
export default function MyStoreScreen() {
  return (
    <StaffGate>
      <MyStore />
    </StaffGate>
  );
}

function MyStore() {
  const { isAdmin, can, storeRole, storeId: ownStoreId, refreshRole } = useAuth();
  const [pickedStoreId, setPickedStoreId] = useState<number | null>(null);
  const [section, setSection] = useState<Section>('stock');
  const [denied, setDenied] = useState(false);
  // Sections the API refused since they signed in (their role changed): hidden until the role
  // has loaded again.
  const [lost, setLost] = useState<Section[]>([]);

  // Their access changed since they signed in, so load their role again (Home then shows the
  // right buttons), and show only what they can still do here.
  const onDenied = useCallback(
    (code: string | undefined, lostSection: Section) => {
      refreshRole();
      if (code === 'missing_permission') {
        setLost((current) => [...current, lostSection]);
      } else {
        setDenied(true);
      }
    },
    [refreshRole],
  );
  // One handler per section, so a section's effect doesn't run again on every render.
  const handlers = useMemo(
    () => ({
      stock: ((code) => onDenied(code, 'stock')) as OnDenied,
      restock: ((code) => onDenied(code, 'restock')) as OnDenied,
      staff: ((code) => onDenied(code, 'staff')) as OnDenied,
      roles: ((code) => onDenied(code, 'roles')) as OnDenied,
      info: ((code) => onDenied(code, 'info')) as OnDenied,
    }),
    [onDenied],
  );
  const locations = useApiGet<Store[]>('/locations');
  // Stores whose info was just changed, which show that until the app loads the stores again.
  const [saved, setSaved] = useState<Record<number, Store>>({});
  // Staff always act on their own store; admins choose one.
  const storeId = isAdmin ? pickedStoreId : ownStoreId;
  // One copy of the restock summary for the header tiles and the Restock section, so a reorder
  // request, a cancel or a new default point reloads both.
  const showRestock = can(PERMISSIONS.viewRestock) && !lost.includes('restock');
  const restockSummary = useApiGet<RestockSummary>(
    storeId !== null && showRestock ? `/staff/stores/${storeId}/restock/summary` : null,
  );

  if (denied) return <StaffOnly />;
  if (storeId === null) {
    return <StorePicker state={locations} onPick={setPickedStoreId} />;
  }

  const store = saved[storeId] ?? locations.data?.find((item) => item.id === storeId);
  const storeName = store?.name ?? 'Your store';
  const available = SECTIONS.filter((item) => can(item.permission) && !lost.includes(item.key));
  const current = available.find((item) => item.key === section) ?? available[0];

  return (
    <>
      {/* Navy and untitled, so the bar runs into the navy band below (only in this normal state). */}
      <Stack.Screen
        options={{
          title: '',
          headerBackTitle: 'Back',
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: colors.textOnHeader,
        }}
      />
      <View style={[sharedStyles.headerBand, styles.band]}>
        <View style={styles.headerText}>
          <Text style={styles.storeName}>{storeName}</Text>
          <Text style={styles.headerCaption}>
            {`Store tools · ${isAdmin ? 'Admin' : (storeRole?.name ?? 'Staff')}`}
          </Text>
        </View>
        {showRestock ? <RestockStats summary={restockSummary.data} /> : null}
        {isAdmin ? (
          <Pressable
            onPress={() => setPickedStoreId(null)}
            accessibilityRole="button"
            accessibilityLabel="Choose another store"
            style={styles.switchStore}
          >
            <Text style={styles.switchStoreText}>Choose another store</Text>
          </Pressable>
        ) : null}
      </View>

      {available.length > 1 ? (
        <SectionTabs
          tabs={available.map((item) => ({
            ...item,
            badge: item.key === 'restock' ? <RestockBadge storeId={storeId} /> : undefined,
          }))}
          selected={current?.key}
          onSelect={setSection}
        />
      ) : null}

      {current?.key === 'stock' ? (
        <StoreStock storeId={storeId} onDenied={handlers.stock} />
      ) : current?.key === 'restock' ? (
        <StoreRestockSection
          storeId={storeId}
          canRequest={can(PERMISSIONS.requestRestock)}
          onDenied={handlers.restock}
          summary={restockSummary}
        />
      ) : current?.key === 'staff' ? (
        <StoreStaffSection storeId={storeId} storeName={storeName} onDenied={handlers.staff} />
      ) : current?.key === 'roles' ? (
        <StoreRolesSection storeId={storeId} onDenied={handlers.roles} />
      ) : current?.key === 'info' && store ? (
        <StoreInfoSection
          store={store}
          onSaved={(updated) => setSaved((all) => ({ ...all, [updated.id]: updated }))}
          onDenied={handlers.info}
        />
      ) : (
        <Text style={[sharedStyles.secondaryText, styles.empty]}>
          Your role doesn&apos;t allow anything here yet. Ask your manager to change it.
        </Text>
      )}
    </>
  );
}

/** Out of stock, running low and open reorders at the store, in the header. */
function RestockStats({ summary: data }: { summary: RestockSummary | null }) {
  if (!data) return null;
  const tiles = [
    { label: 'Out of stock', value: data.out },
    { label: 'Running low', value: data.low },
    { label: 'Reorders open', value: data.open_requests },
  ];
  return (
    <View style={styles.tiles}>
      {tiles.map((tile) => (
        <View key={tile.label} style={styles.tile}>
          <Text style={styles.tileValue}>{tile.value}</Text>
          <Text style={styles.tileLabel}>{tile.label}</Text>
        </View>
      ))}
    </View>
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
          <Text style={sharedStyles.secondaryText}>Choose a store to manage.</Text>
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

const styles = StyleSheet.create({
  band: {
    paddingTop: spacing.md,
  },
  headerText: {
    gap: spacing.xxs,
  },
  storeName: {
    ...textStyles.heading,
    color: colors.textOnHeader,
  },
  headerCaption: {
    ...textStyles.caption,
    color: colors.textOnHeaderMuted,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.headerChip,
  },
  tileValue: {
    ...textStyles.heading,
    color: colors.textOnHeader,
  },
  tileLabel: {
    ...textStyles.caption,
    color: colors.textOnHeaderMuted,
  },
  switchStore: {
    alignSelf: 'flex-start',
    minHeight: sizes.touch,
    justifyContent: 'center',
  },
  switchStoreText: {
    ...textStyles.label,
    color: colors.textOnHeader,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
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
  empty: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
});
