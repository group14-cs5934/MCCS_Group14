import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/auth';
import AdminActivityList from '@/components/AdminActivityList';
import AdminGate, { AccessDenied } from '@/components/AdminGate';
import AdminUserRow from '@/components/AdminUserRow';
import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import SearchResultsList from '@/components/SearchResultsList';
import { useApiGet } from '@/hooks/useApiGet';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH } from '@/hooks/useProductSearch';
import { colors, radius, sharedStyles, spacing, textStyles } from '@/theme';
import type { AuditLogEntry } from '@/types/audit';
import type { Product } from '@/types/product';
import type { AdminUserAccount } from '@/types/user';

/** Most rows a list loads at once (the API's limit for GET /admin/products, /users, /audit-log). */
export const ADMIN_PAGE_SIZE = 100;

type Section = 'products' | 'users' | 'activity';

const sections: { key: Section; label: string; searchLabel?: string }[] = [
  { key: 'products', label: 'Products', searchLabel: 'Search products' },
  { key: 'users', label: 'Users', searchLabel: 'Search users by email' },
  { key: 'activity', label: 'Activity' },
];

/** The Activity tab's filters: every change, or only changes to one kind of thing. */
const activityFilters: { targetType: string | null; label: string }[] = [
  { targetType: null, label: 'All' },
  { targetType: 'product', label: 'Products' },
  { targetType: 'user', label: 'Users' },
  { targetType: 'review', label: 'Reviews' },
];

/**
 * Admin area: the catalog's products (T090) and the app's users, each with a search box, and the
 * audit log of admin changes (Activity, T083). Only admins can open it; anyone else sees "Admins
 * only". The API checks too, so hiding the screen isn't the only guard.
 */
export default function AdminScreen() {
  return (
    <AdminGate>
      <AdminArea />
    </AdminGate>
  );
}

function AdminArea() {
  const [section, setSection] = useState<Section>('products');
  // Each section keeps its own search text, so switching back shows what was there.
  const [searches, setSearches] = useState<Record<Section, string>>({
    products: '',
    users: '',
    activity: '',
  });
  const text = searches[section];
  const typed = text.trim();
  // While typing, search once typing pauses. Switching lists or clearing the box applies right
  // away, and one list's search never runs against the other.
  const debounced = useDebouncedValue(`${section}:${typed}`, SEARCH_DEBOUNCE_MS);
  const query = !typed
    ? ''
    : debounced.startsWith(`${section}:`)
      ? debounced.slice(section.length + 1)
      : typed;
  const current = sections.find((item) => item.key === section)!;

  return (
    <>
      <View style={styles.switcher} accessibilityRole="tablist">
        {sections.map((item) => {
          const selected = item.key === section;
          return (
            <Pressable
              key={item.key}
              onPress={() => setSection(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[styles.switchOption, selected && styles.switchOptionSelected]}
            >
              <Text style={[styles.switchText, selected && styles.switchTextSelected]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {current.searchLabel ? (
        <SearchBar
          label={current.searchLabel}
          value={text}
          onChange={(value) => setSearches((all) => ({ ...all, [section]: value }))}
        />
      ) : null}

      {section === 'products' ? <AdminProducts query={query} /> : null}
      {section === 'users' ? <AdminUsers query={query} /> : null}
      {section === 'activity' ? <AdminActivity /> : null}
    </>
  );
}

function SearchBar({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.searchBar}>
      <Ionicons name="search" size={20} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={label}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        maxLength={SEARCH_MAX_LENGTH}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={styles.input}
      />
      {value ? (
        <Pressable
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={spacing.sm}
        >
          <Ionicons name="close-circle" size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Every product, sorted by name. Tapping one opens its product page. */
function AdminProducts({ query }: { query: string }) {
  const router = useRouter();
  const params = new URLSearchParams({ limit: String(ADMIN_PAGE_SIZE) });
  if (query) params.set('q', query);
  const { loading, data, error, reload } = useApiGet<Product[]>(`/admin/products?${params}`);

  // The API decides who's an admin. If it says no (e.g. the role was removed since sign-in),
  // show the same message as for anyone else.
  if (error?.status === 403) return <AccessDenied />;

  const products = data ?? [];
  return (
    <AsyncContent
      loading={loading}
      error={error?.message}
      onRetry={reload}
      loadingMessage="Loading products…"
    >
      <View style={styles.listHeader}>
        <Text style={styles.listCount} accessibilityLiveRegion="polite">
          {countText(products.length, query, 'product')}
        </Text>
        <Button
          title="Add product"
          variant="text"
          icon="add-circle-outline"
          onPress={() => router.push('/admin-product/new')}
          style={styles.addButton}
        />
      </View>
      {/* Tapping a product opens it for editing (T091); the form links to its page in the app. */}
      <SearchResultsList
        results={products}
        onOpen={(product) => router.push(`/admin-product/${product.id}`)}
      />
    </AsyncContent>
  );
}

/**
 * Every user in the order they joined, with their role and whether their account is active.
 * Admins can change a user's role, or deactivate them so they can't sign in (T097).
 */
function AdminUsers({ query }: { query: string }) {
  const { user: me } = useAuth();
  const params = new URLSearchParams({ limit: String(ADMIN_PAGE_SIZE) });
  if (query) params.set('email', query);
  const { loading, data, error, reload } = useApiGet<AdminUserAccount[]>(`/admin/users?${params}`);
  const [denied, setDenied] = useState(false);
  // Users changed since the list loaded, shown in place of their rows until it loads again.
  const [changed, setChanged] = useState<{
    list: AdminUserAccount[] | null;
    byId: Record<string, AdminUserAccount>;
  }>({ list: null, byId: {} });

  if (denied || error?.status === 403) return <AccessDenied />;

  const byId = changed.list === data ? changed.byId : {};
  const users = (data ?? []).map((user) => byId[user.id] ?? user);
  const showUpdated = (user: AdminUserAccount) =>
    setChanged((prev) => ({
      list: data,
      byId: { ...(prev.list === data ? prev.byId : {}), [user.id]: user },
    }));
  return (
    <AsyncContent
      loading={loading}
      error={error?.message}
      onRetry={reload}
      loadingMessage="Loading users…"
    >
      <Text style={styles.count} accessibilityLiveRegion="polite">
        {countText(users.length, query, 'user')}
      </Text>
      <FlatList
        data={users}
        keyExtractor={(user) => user.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <AdminUserRow
            user={item}
            isSelf={item.id === me?.id}
            onUpdated={showUpdated}
            onDenied={() => setDenied(true)}
          />
        )}
      />
    </AsyncContent>
  );
}

/** Every admin change, newest first, optionally only changes to products, users, or reviews. */
function AdminActivity() {
  const router = useRouter();
  const [targetType, setTargetType] = useState<string | null>(null);
  const params = new URLSearchParams({ limit: String(ADMIN_PAGE_SIZE) });
  if (targetType) params.set('target_type', targetType);
  const { loading, data, error, reload } = useApiGet<AuditLogEntry[]>(`/admin/audit-log?${params}`);

  if (error?.status === 403) return <AccessDenied />;

  const entries = data ?? [];
  return (
    <>
      <View style={styles.filters}>
        {activityFilters.map((filter) => {
          const selected = filter.targetType === targetType;
          return (
            <Pressable
              key={filter.label}
              onPress={() => setTargetType(filter.targetType)}
              accessibilityRole="button"
              accessibilityLabel={`Show ${filter.label.toLowerCase()} changes`}
              accessibilityState={{ selected }}
              style={[styles.filter, selected && styles.filterSelected]}
            >
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading activity…"
      >
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {activityCountText(entries.length)}
        </Text>
        <AdminActivityList
          entries={entries}
          onOpenProduct={(productId) => router.push(`/product/${productId}`)}
        />
      </AsyncContent>
    </>
  );
}

/** "12 changes", "No changes yet.", or "Showing the latest 100 changes." */
function activityCountText(count: number): string {
  if (count === 0) return 'No changes yet.';
  if (count >= ADMIN_PAGE_SIZE) return `Showing the latest ${ADMIN_PAGE_SIZE} changes.`;
  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

/** "12 products", "1 user", "No users match "x".", or "Showing the first 100 products…". */
function countText(count: number, query: string, noun: 'product' | 'user'): string {
  if (count === 0) return query ? `No ${noun}s match "${query}".` : `No ${noun}s yet.`;
  if (count >= ADMIN_PAGE_SIZE) {
    return `Showing the first ${ADMIN_PAGE_SIZE} ${noun}s. Search to find others.`;
  }
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

const styles = StyleSheet.create({
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
  searchBar: {
    ...sharedStyles.row,
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    ...textStyles.body,
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  filter: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  filterText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  filterTextSelected: {
    color: colors.accent,
  },
  count: {
    ...textStyles.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  listHeader: {
    ...sharedStyles.row,
    justifyContent: 'space-between',
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  listCount: {
    ...textStyles.caption,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  addButton: {
    alignSelf: 'auto',
  },
  list: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
});
