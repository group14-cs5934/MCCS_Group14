import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth';
import AdminActivityList from '@/components/AdminActivityList';
import AdminGate, { AccessDenied } from '@/components/AdminGate';
import AdminHome, { type AdminSection } from '@/components/AdminHome';
import AdminReviewRow from '@/components/AdminReviewRow';
import AdminUserRow from '@/components/AdminUserRow';
import AsyncContent from '@/components/AsyncContent';
import Badge, { type BadgeTone } from '@/components/Badge';
import Button from '@/components/Button';
import { ProductPhoto } from '@/components/SearchResultsList';
import { useApiGet } from '@/hooks/useApiGet';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH } from '@/hooks/useProductSearch';
import { colors, radius, shadows, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { AdminProduct, StockSummary } from '@/types/admin';
import type { AuditLogEntry } from '@/types/audit';
import type { AdminReview } from '@/types/review';
import type { Store } from '@/types/store';
import type { AdminUserAccount } from '@/types/user';
import { formatPrice } from '@/utils/formatPrice';

/** Most rows a list loads at once (the API's limit for GET /admin/products, /users, /audit-log). */
export const ADMIN_PAGE_SIZE = 100;

/** The Overview, or one of its lists. Stores is its own screen, so it isn't one of these. */
type Page = 'overview' | Exclude<AdminSection, 'stores'>;

/** The lists with a search box, and the box's label. */
const searchLabels = {
  products: 'Search products',
  users: 'Search users by email',
} as const;

type Searchable = keyof typeof searchLabels;

/** A filter button's value (sent to the API, or matched on the client) and label. */
type Filter<T> = { value: T; label: string; accessibilityLabel?: string };

/** The Activity list's filters: every change, or only changes to one kind of thing. */
const activityFilters: Filter<string | null>[] = [
  { value: null, label: 'All' },
  { value: 'product', label: 'Products' },
  { value: 'user', label: 'Users' },
  { value: 'review', label: 'Reviews' },
];

/** The Reviews list's filters: every review, or only those shown on or hidden from product pages. */
const reviewFilters: Filter<boolean | null>[] = [
  { value: null, label: 'All' },
  { value: false, label: 'Shown', accessibilityLabel: 'Show visible reviews' },
  { value: true, label: 'Hidden', accessibilityLabel: 'Show hidden reviews' },
];

type UserFilter = 'all' | 'staff' | 'admin' | 'deactivated';

/** The Users list's filters. The API has no role filter, so these apply to the loaded page. */
const userFilters: Filter<UserFilter>[] = [
  { value: 'all', label: 'All', accessibilityLabel: 'Show all users' },
  { value: 'staff', label: 'Staff', accessibilityLabel: 'Show staff users' },
  { value: 'admin', label: 'Admins', accessibilityLabel: 'Show admin users' },
  { value: 'deactivated', label: 'Deactivated', accessibilityLabel: 'Show deactivated users' },
];

function matchesUserFilter(user: AdminUserAccount, filter: UserFilter): boolean {
  if (filter === 'staff') return user.role === 'staff';
  if (filter === 'admin') return user.role === 'admin';
  if (filter === 'deactivated') return !user.active;
  return true;
}

/**
 * Admin area: an Overview (counts, the areas to manage and the latest changes) that opens the
 * catalog's products (T090), the app's users, reviews to moderate (T098) and the audit log of admin
 * changes (Activity, T083), each with a back arrow to the Overview. Only admins can open it;
 * anyone else sees "Admins only". The API checks too, so hiding the screen isn't the only guard.
 */
export default function AdminScreen() {
  return (
    <AdminGate>
      <AdminArea />
    </AdminGate>
  );
}

function AdminArea() {
  const router = useRouter();
  const [view, setView] = useState<Page>('overview');
  // Each list keeps its own search text, so going back to it shows what was there.
  const [searches, setSearches] = useState<Record<Searchable, string>>({
    products: '',
    users: '',
  });
  const searchable = view in searchLabels ? (view as Searchable) : null;
  const typed = searchable ? searches[searchable].trim() : '';
  // While typing, search once typing pauses. Switching lists or clearing the box applies right
  // away, and one list's search never runs against the other.
  const debounced = useDebouncedValue(`${view}:${typed}`, SEARCH_DEBOUNCE_MS);
  const query = !typed
    ? ''
    : debounced.startsWith(`${view}:`)
      ? debounced.slice(view.length + 1)
      : typed;
  const search = searchable
    ? {
        label: searchLabels[searchable],
        value: searches[searchable],
        onChange: (value: string) => setSearches((all) => ({ ...all, [searchable]: value })),
      }
    : null;
  const back = () => setView('overview');

  function open(section: AdminSection) {
    if (section === 'stores') router.push('/stores');
    else setView(section);
  }

  return (
    <>
      {/* The Overview's navy band and each list's own title replace the stack's header. */}
      <Stack.Screen options={{ headerShown: false }} />
      {view === 'overview' ? (
        <AdminHome onOpen={open} onStoreTools={() => router.push('/my-store')} />
      ) : null}
      {view === 'products' && search ? (
        <AdminProducts query={query} search={search} onBack={back} />
      ) : null}
      {view === 'users' && search ? (
        <AdminUsers query={query} search={search} onBack={back} />
      ) : null}
      {view === 'reviews' ? <AdminReviews onBack={back} /> : null}
      {view === 'activity' ? <AdminActivity onBack={back} /> : null}
    </>
  );
}

/** A list's title with a back arrow to the Overview, and something at the right (e.g. a count). */
function SectionHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to admin"
        style={styles.back}
      >
        <Ionicons name="chevron-back" size={sizes.icon} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.headerTitle} accessibilityRole="header">
        {title}
      </Text>
      {right}
    </View>
  );
}

type SearchProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function SearchBar({ label, value, onChange }: SearchProps) {
  return (
    <View style={styles.searchBar}>
      <Ionicons name="search" size={sizes.icon} color={colors.textMuted} />
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
          <Ionicons name="close-circle" size={sizes.icon} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Every product, sorted by name, with how it stands across the stores. Tapping one opens its admin
 * page, where its stock can be read and edited store by store.
 */
function AdminProducts({
  query,
  search,
  onBack,
}: {
  query: string;
  search: SearchProps;
  onBack: () => void;
}) {
  const router = useRouter();
  const params = new URLSearchParams({ limit: String(ADMIN_PAGE_SIZE) });
  if (query) params.set('q', query);
  const { loading, data, error, reload } = useApiGet<AdminProduct[]>(`/admin/products?${params}`);
  // Coming back from a product's page, which may have changed its stock or deleted it.
  const shown = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (shown.current) reload();
      shown.current = true;
    }, [reload]),
  );

  // The API decides who's an admin. If it says no (e.g. the role was removed since sign-in),
  // show the same message as for anyone else.
  if (error?.status === 403) return <AccessDenied />;

  const products = data ?? [];
  const note = productsNote(products.length, query);
  return (
    <View style={sharedStyles.screen}>
      <SectionHeader
        title="Products"
        onBack={onBack}
        right={
          data ? (
            <Text style={styles.headerCount} accessibilityLiveRegion="polite">
              {products.length} {products.length === 1 ? 'product' : 'products'}
            </Text>
          ) : null
        }
      />
      <SearchBar {...search} />
      <Button
        title="Add product"
        variant="action"
        icon="add"
        onPress={() => router.push('/admin-product/new')}
        style={styles.addButton}
      />
      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading products…"
      >
        {note ? <Text style={styles.count}>{note}</Text> : null}
        {/* Tapping a product opens it for editing (T091); its page links on to the app. */}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
          <View style={styles.productCard}>
            {products.map((product, index) => (
              <AdminProductRow
                key={product.id}
                product={product}
                first={index === 0}
                onPress={() => router.push(`/admin-product/${product.id}`)}
              />
            ))}
          </View>
        </ScrollView>
      </AsyncContent>
    </View>
  );
}

/** Photo, name, size and price, with the product's stock across the stores underneath. */
function AdminProductRow({
  product,
  first,
  onPress,
}: {
  product: AdminProduct;
  first: boolean;
  onPress: () => void;
}) {
  const price = product.price ? formatPrice(product.price) : 'No price yet';
  const detail = product.size ?? product.barcode;
  const stock = stockLine(product.stock);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[product.name, detail, price, stock.text].join(', ')}
      style={({ pressed }) => [
        styles.productRow,
        !first && styles.divider,
        pressed && styles.pressed,
      ]}
    >
      <ProductPhoto uri={product.image_url} name={product.name} size={sizes.thumb} />
      <View style={styles.productText}>
        <Text style={styles.productName} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.productDetail} numberOfLines={1}>
          {detail}
        </Text>
        <View style={styles.stockLine}>
          {stock.pills.map((pill) => (
            <Badge key={pill.label} {...pill} />
          ))}
          {stock.muted ? <Text style={styles.noStock}>{stock.muted}</Text> : null}
        </View>
      </View>
      <Text style={product.price ? styles.productPrice : styles.noStock}>{price}</Text>
    </Pressable>
  );
}

/** The stock pills for a product's row, and the same in words for screen readers. */
function stockLine(stock: StockSummary | null | undefined): {
  pills: { label: string; tone: BadgeTone }[];
  muted?: string;
  text: string;
} {
  if (!stock || stock.stores === 0 || stock.unknown === stock.stores) {
    return { pills: [], muted: 'No stock records', text: 'No stock records' };
  }
  if (stock.out === stock.stores) {
    return {
      pills: [{ label: 'Out everywhere', tone: 'danger' }],
      text: 'Out of stock everywhere',
    };
  }
  const pills: { label: string; tone: BadgeTone }[] = [];
  if (stock.in_stock > 0) {
    pills.push({ label: `In stock ${stock.in_stock}/${stock.stores}`, tone: 'success' });
  }
  if (stock.low > 0) pills.push({ label: `${stock.low} low`, tone: 'warning' });
  if (stock.out > 0) pills.push({ label: `Out at ${stock.out}`, tone: 'danger' });
  return { pills, text: pills.map((pill) => pill.label).join(', ') };
}

/** Why the list is empty or cut short, e.g. "No products match "x"."; empty when it needs no note. */
function productsNote(count: number, query: string): string {
  if (count === 0) return query ? `No products match "${query}".` : 'No products yet.';
  if (count >= ADMIN_PAGE_SIZE) {
    return `Showing the first ${ADMIN_PAGE_SIZE} products. Search to find others.`;
  }
  return '';
}

/**
 * Every user in the order they joined, with their role and whether their account is active.
 * Admins can change a user's role (making them a store worker or manager at a store), or
 * deactivate them so they can't sign in (T097). The Staff / Admins / Deactivated filters apply to
 * the loaded page only, since the API has no role filter.
 */
function AdminUsers({
  query,
  search,
  onBack,
}: {
  query: string;
  search: SearchProps;
  onBack: () => void;
}) {
  const { user: me } = useAuth();
  const params = new URLSearchParams({ limit: String(ADMIN_PAGE_SIZE) });
  if (query) params.set('email', query);
  const { loading, data, error, reload } = useApiGet<AdminUserAccount[]>(`/admin/users?${params}`);
  // To name staff members' stores and choose one; without it, stores show as "store #3".
  const locations = useApiGet<Store[]>('/locations');
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState<UserFilter>('all');
  const [users, setUser] = useChangedRows(data);

  if (denied || error?.status === 403) return <AccessDenied />;

  const shown = users.filter((user) => matchesUserFilter(user, filter));
  return (
    <View style={sharedStyles.screen}>
      <SectionHeader
        title="Users"
        onBack={onBack}
        right={
          data ? (
            <Text style={styles.headerCount} accessibilityLiveRegion="polite">
              {users.length} {users.length === 1 ? 'person' : 'people'}
            </Text>
          ) : null
        }
      />
      <SearchBar {...search} />
      <FilterPills filters={userFilters} selected={filter} onSelect={setFilter} noun="users" />
      <AsyncContent
        loading={loading}
        error={error?.message}
        onRetry={reload}
        loadingMessage="Loading users…"
      >
        {users.length >= ADMIN_PAGE_SIZE || shown.length === 0 ? (
          <Text style={styles.count}>{usersNote(users.length, shown.length, query, filter)}</Text>
        ) : null}
        <FlatList
          data={shown}
          keyExtractor={(user) => user.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <AdminUserRow
              user={item}
              stores={locations.data ?? []}
              isSelf={item.id === me?.id}
              onUpdated={(user) => setUser(user.id, user)}
              onDenied={() => setDenied(true)}
            />
          )}
        />
      </AsyncContent>
    </View>
  );
}

/** Why the list is empty or cut short, e.g. "No users match "x"." */
function usersNote(loaded: number, shown: number, query: string, filter: UserFilter): string {
  if (shown === 0) {
    if (loaded > 0) {
      return `No ${userFilters.find((item) => item.value === filter)!.label.toLowerCase()} among these users.`;
    }
    return query ? `No users match "${query}".` : 'No users yet.';
  }
  return `Showing the first ${ADMIN_PAGE_SIZE} users. Search to find others.`;
}

/**
 * Every review, newest first, including hidden ones, optionally only the visible or hidden ones
 * (T098). Admins can hide a review from its product page, show it again, or delete it.
 */
function AdminReviews({ onBack }: { onBack: () => void }) {
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
    <View style={sharedStyles.screen}>
      <SectionHeader title="Reviews" onBack={onBack} />
      <FilterPills
        filters={reviewFilters}
        selected={hidden}
        onSelect={setHidden}
        noun="reviews"
        segmented
      />

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
    </View>
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
function AdminActivity({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [targetType, setTargetType] = useState<string | null>(null);
  const params = new URLSearchParams({ limit: String(ADMIN_PAGE_SIZE) });
  if (targetType) params.set('target_type', targetType);
  const { loading, data, error, reload } = useApiGet<AuditLogEntry[]>(`/admin/audit-log?${params}`);

  if (error?.status === 403) return <AccessDenied />;

  const entries = data ?? [];
  return (
    <View style={sharedStyles.screen}>
      <SectionHeader title="Activity" onBack={onBack} />
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
    </View>
  );
}

/**
 * A row of filter buttons with one selected; each reads e.g. "Show hidden reviews". Chips by
 * default, or a segmented control that fills the width.
 */
function FilterPills<T>({
  filters,
  selected,
  onSelect,
  noun,
  segmented = false,
}: {
  filters: Filter<T>[];
  selected: T;
  onSelect: (value: T) => void;
  noun: string;
  segmented?: boolean;
}) {
  return (
    <View style={segmented ? styles.segmented : styles.filters}>
      {filters.map((filter) => {
        const isSelected = filter.value === selected;
        return (
          <Pressable
            key={filter.label}
            onPress={() => onSelect(filter.value)}
            accessibilityRole="button"
            accessibilityLabel={
              filter.accessibilityLabel ?? `Show ${filter.label.toLowerCase()} ${noun}`
            }
            accessibilityState={{ selected: isSelected }}
            style={[
              segmented ? styles.segment : styles.filter,
              isSelected && (segmented ? styles.segmentSelected : styles.filterSelected),
            ]}
          >
            <Text
              style={[
                styles.filterText,
                isSelected && (segmented ? styles.segmentTextSelected : styles.filterTextSelected),
              ]}
            >
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

const styles = StyleSheet.create({
  header: {
    ...sharedStyles.row,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  back: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  headerTitle: {
    ...textStyles.title,
    flex: 1,
    color: colors.textPrimary,
  },
  headerCount: {
    ...textStyles.caption,
    fontFamily: textStyles.label.fontFamily,
    color: colors.textSecondary,
  },
  searchBar: {
    ...sharedStyles.row,
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
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
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  filter: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  filterText: {
    ...textStyles.caption,
    fontFamily: textStyles.label.fontFamily,
    color: colors.textPrimary,
  },
  filterTextSelected: {
    color: colors.textOnPrimary,
  },
  segmented: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  segmentSelected: {
    backgroundColor: colors.surface,
  },
  segmentTextSelected: {
    color: colors.textPrimary,
  },
  count: {
    ...textStyles.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  addButton: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  productCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  productRow: {
    ...sharedStyles.row,
    gap: spacing.md,
    padding: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
  productText: {
    flex: 1,
    gap: spacing.xxs,
  },
  productName: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  productDetail: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  stockLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  productPrice: {
    ...textStyles.priceSmall,
    color: colors.textPrimary,
  },
  noStock: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  list: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
});
