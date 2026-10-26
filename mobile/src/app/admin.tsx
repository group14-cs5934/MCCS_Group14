import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/auth';
import AdminActivityList from '@/components/AdminActivityList';
import AdminGate, { AccessDenied } from '@/components/AdminGate';
import AdminReviewRow from '@/components/AdminReviewRow';
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
import type { AdminReview } from '@/types/review';
import type { AdminUserAccount } from '@/types/user';

/** Most rows a list loads at once (the API's limit for GET /admin/products, /users, /audit-log). */
export const ADMIN_PAGE_SIZE = 100;

type Section = 'products' | 'users' | 'reviews' | 'activity';

const sections: { key: Section; label: string; searchLabel?: string }[] = [
  { key: 'products', label: 'Products', searchLabel: 'Search products' },
  { key: 'users', label: 'Users', searchLabel: 'Search users by email' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'activity', label: 'Activity' },
];

/** A filter button's value (sent to the API) and label. */
type Filter<T> = { value: T; label: string };

/** The Activity tab's filters: every change, or only changes to one kind of thing. */
const activityFilters: Filter<string | null>[] = [
  { value: null, label: 'All' },
  { value: 'product', label: 'Products' },
  { value: 'user', label: 'Users' },
  { value: 'review', label: 'Reviews' },
];

/** The Reviews tab's filters: every review, or only those shown on or hidden from product pages. */
const reviewFilters: Filter<boolean | null>[] = [
  { value: null, label: 'All' },
  { value: false, label: 'Visible' },
  { value: true, label: 'Hidden' },
];

/**
 * Admin area: the catalog's products (T090) and the app's users, each with a search box, reviews
 * to moderate (T098), and the audit log of admin changes (Activity, T083). Only admins can open
 * it; anyone else sees "Admins only". The API checks too, so hiding the screen isn't the only
 * guard.
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
    reviews: '',
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
      {section === 'reviews' ? <AdminReviews /> : null}
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
  const [users, setUser] = useChangedRows(data);

  if (denied || error?.status === 403) return <AccessDenied />;

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
            onUpdated={(user) => setUser(user.id, user)}
            onDenied={() => setDenied(true)}
          />
        )}
      />
    </AsyncContent>
  );
}

/**
 * Every review, newest first, including hidden ones, optionally only the visible or hidden ones
 * (T098). Admins can hide a review from its product page, show it again, or delete it.
 */
function AdminReviews() {
  const router = useRouter();
  const [hidden, setHidden] = useState<boolean | null>(null);
  const params = new URLSearchParams({ limit: String(ADMIN_PAGE_SIZE) });
  if (hidden !== null) params.set('hidden', String(hidden));
  const { loading, data, error, reload } = useApiGet<AdminReview[]>(`/admin/reviews?${params}`);
  const [denied, setDenied] = useState(false);
  // A review hidden while viewing only visible ones (or shown while viewing hidden ones) stays in
  // the list with its new badge until the list reloads, so it can be undone.
  const [reviews, setReview] = useChangedRows(data);

  if (denied || error?.status === 403) return <AccessDenied />;

  return (
    <>
      <FilterPills filters={reviewFilters} selected={hidden} onSelect={setHidden} noun="reviews" />

      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading reviews…"
      >
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {reviewCountText(reviews.length, hidden)}
        </Text>
        <FlatList
          data={reviews}
          keyExtractor={(review) => String(review.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <AdminReviewRow
              review={item}
              onUpdated={(review) => setReview(review.id, review)}
              onDeleted={(reviewId) => setReview(reviewId, null)}
              onOpenProduct={(productId) => router.push(`/product/${productId}`)}
              onDenied={() => setDenied(true)}
            />
          )}
        />
      </AsyncContent>
    </>
  );
}

/** "12 reviews", "No hidden reviews.", or "Showing the latest 100 visible reviews." */
function reviewCountText(count: number, hidden: boolean | null): string {
  const kind = hidden === null ? '' : hidden ? 'hidden ' : 'visible ';
  if (count === 0) return `No ${kind}reviews.`;
  if (count >= ADMIN_PAGE_SIZE) return `Showing the latest ${ADMIN_PAGE_SIZE} ${kind}reviews.`;
  return `${count} ${kind}${count === 1 ? 'review' : 'reviews'}`;
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
      <FilterPills
        filters={activityFilters}
        selected={targetType}
        onSelect={setTargetType}
        noun="changes"
      />

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

/** A row of filter buttons with one selected; each reads e.g. "Show hidden reviews". */
function FilterPills<T>({
  filters,
  selected,
  onSelect,
  noun,
}: {
  filters: Filter<T>[];
  selected: T;
  onSelect: (value: T) => void;
  noun: string;
}) {
  return (
    <View style={styles.filters}>
      {filters.map((filter) => {
        const isSelected = filter.value === selected;
        return (
          <Pressable
            key={filter.label}
            onPress={() => onSelect(filter.value)}
            accessibilityRole="button"
            accessibilityLabel={`Show ${filter.label.toLowerCase()} ${noun}`}
            accessibilityState={{ selected: isSelected }}
            style={[styles.filter, isSelected && styles.filterSelected]}
          >
            <Text style={[styles.filterText, isSelected && styles.filterTextSelected]}>
              {filter.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * `list` with the rows changed since it loaded put in their place (or left out, if set to null
 * because they were deleted), so a change shows at once without reloading the whole list. The
 * changes are dropped when the list loads again, since it then comes from the server.
 */
function useChangedRows<T extends { id: string | number }>(list: T[] | null) {
  const [changed, setChanged] = useState<{
    list: T[] | null;
    byId: Record<string, T | null>;
  }>({ list: null, byId: {} });

  const byId = changed.list === list ? changed.byId : {};
  const rows = (list ?? []).flatMap((row) => {
    const now = row.id in byId ? byId[row.id] : row;
    return now ? [now] : [];
  });
  const setRow = (id: T['id'], row: T | null) =>
    setChanged((prev) => ({
      list,
      byId: { ...(prev.list === list ? prev.byId : {}), [id]: row },
    }));
  return [rows, setRow] as const;
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
