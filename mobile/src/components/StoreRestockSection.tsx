import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  getRestockItems,
  getRestockRequests,
  setDefaultReorderPoint,
  type ApiError,
  type ApiResult,
} from '@/api';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import Loader from '@/components/Loader';
import RestockItemCard, { formatDate } from '@/components/RestockItemCard';
import { ProductPhoto } from '@/components/SearchResultsList';
import TextField from '@/components/TextField';
import { changeError, isAccessLost, type OnDenied } from '@/components/storeAccess';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, radius, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { RestockFilter, RestockItem, RestockRequest, RestockSummary } from '@/types/restock';

/** Most rows loaded at once (the API's limit); "Show more" loads the next page. */
export const RESTOCK_PAGE_SIZE = 50;

type Pane = 'items' | 'requests';

const FILTERS: { key: RestockFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'out', label: 'Out' },
  { key: 'low', label: 'Low' },
];

type Props = {
  storeId: number;
  /** Whether they may request reorders and change reorder points (request_restock). */
  canRequest: boolean;
  onDenied: OnDenied;
  /** The store's restock summary, loaded by My store so its header tiles share this copy. */
  summary: ReturnType<typeof useApiGet<RestockSummary>>;
};

/**
 * The store's low and out-of-stock products with their statistics, and the reorder requests, for
 * people with view_restock. With request_restock they can also request and cancel reorders and
 * change reorder points.
 */
export default function StoreRestockSection({ storeId, canRequest, onDenied, summary }: Props) {
  const [view, setView] = useState<Pane>('items');
  const refused = summary.error?.status === 403 ? summary.error.code : null;
  useEffect(() => {
    if (refused !== null) onDenied(refused);
  }, [refused, onDenied]);
  const [filter, setFilter] = useState<RestockFilter>('all');
  const [allRequests, setAllRequests] = useState(false);
  // Changing the store's default reorder point changes which products are low: load the list again.
  const [version, setVersion] = useState(0);
  const loadItems = useCallback(
    (offset: number) =>
      getRestockItems(storeId, { status: filter, limit: RESTOCK_PAGE_SIZE, offset }),
    [storeId, filter],
  );
  const loadRequests = useCallback(
    (offset: number) =>
      getRestockRequests(storeId, {
        status: allRequests ? 'all' : 'open',
        limit: RESTOCK_PAGE_SIZE,
        offset,
      }),
    [storeId, allRequests],
  );

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.section}>
      <DefaultPoint
        summary={summary}
        storeId={storeId}
        canRequest={canRequest}
        onDenied={onDenied}
        onChanged={() => {
          setVersion((count) => count + 1);
          summary.reload();
        }}
      />
      <FilterChips
        counts={summary.data}
        view={view}
        filter={filter}
        onFilter={(next) => {
          setView('items');
          setFilter(next);
        }}
        onRequests={() => setView('requests')}
      />
      {view === 'items' ? (
        <>
          <PagedList<RestockItem>
            key={`items:${filter}:${version}`}
            load={loadItems}
            onDenied={onDenied}
            empty="Nothing needs restocking."
            loadingMessage="Loading restock list…"
            keyOf={(item) => String(item.product.id)}
            renderItem={(item) => (
              <RestockItemCard
                storeId={storeId}
                item={item}
                canRequest={canRequest}
                onDenied={onDenied}
                onChanged={summary.reload}
              />
            )}
          />
        </>
      ) : (
        <>
          <Button
            title={allRequests ? 'Show open requests only' : 'Show all requests'}
            variant="text"
            onPress={() => setAllRequests((all) => !all)}
            style={styles.left}
          />
          <PagedList<RestockRequest>
            key={`requests:${allRequests}`}
            load={loadRequests}
            onDenied={onDenied}
            empty={allRequests ? 'No requests yet.' : 'No open requests.'}
            loadingMessage="Loading requests…"
            keyOf={(request) => String(request.id)}
            renderItem={(request) => <RequestRow request={request} />}
          />
        </>
      )}
    </ScrollView>
  );
}

/** The store's default reorder point, which people with request_restock can change. */
function DefaultPoint({
  summary,
  storeId,
  canRequest,
  onDenied,
  onChanged,
}: {
  summary: ReturnType<typeof useApiGet<RestockSummary>>;
  storeId: number;
  canRequest: boolean;
  onDenied: OnDenied;
  onChanged: () => void;
}) {
  // The value just saved, until the summary loads again.
  const [saved, setSaved] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  if (summary.error?.status === 403) return null;
  const current = saved ?? summary.data?.default_reorder_point;
  if (current === undefined) {
    return summary.error ? (
      <ErrorBanner message={summary.error.message} onRetry={summary.reload} />
    ) : (
      <Loader message="Loading…" size="small" />
    );
  }

  async function save() {
    const typed = text.trim();
    const value = Number(typed);
    if (!/^\d+$/.test(typed) || value > 10000) {
      setError('Enter a whole number from 0 to 10000.');
      return;
    }
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    const result = await setDefaultReorderPoint(storeId, value);
    busy.current = false;
    setSaving(false);
    if (result.ok) {
      setSaved(result.data.default_reorder_point);
      setEditing(false);
      onChanged();
    } else if (isAccessLost(result.error)) {
      onDenied(result.error.code);
    } else {
      setError(changeError(result.error, `Couldn't save the default reorder point.`));
    }
  }

  return (
    <Card style={styles.card}>
      {editing ? (
        <>
          <TextField
            label="Default reorder point"
            value={text}
            onChangeText={setText}
            keyboardType="number-pad"
          />
          {error ? <ErrorBanner message={error} /> : null}
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="text"
              onPress={() => setEditing(false)}
              disabled={saving}
              style={styles.action}
            />
            <Button title="Save default" onPress={save} loading={saving} style={styles.action} />
          </View>
        </>
      ) : (
        <View style={styles.defaultRow}>
          <Text style={styles.caption}>
            A product is low at or below its reorder point. The store default is {current}.
          </Text>
          {canRequest ? (
            <Button
              title="Change default"
              variant="text"
              onPress={() => {
                setText(String(current));
                setError(null);
                setEditing(true);
              }}
              accessibilityLabel="Change the default reorder point"
              style={styles.action}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}

/** All, Out and Low (with how many), and a Requests link that switches to the request list. */
function FilterChips({
  counts,
  view,
  filter,
  onFilter,
  onRequests,
}: {
  counts: RestockSummary | null;
  view: Pane;
  filter: RestockFilter;
  onFilter: (filter: RestockFilter) => void;
  onRequests: () => void;
}) {
  const count = (key: RestockFilter) =>
    counts ? (key === 'all' ? counts.out + counts.low : counts[key]) : null;
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Filter">
      {FILTERS.map((option) => {
        const selected = view === 'items' && filter === option.key;
        const number = count(option.key);
        return (
          <Pressable
            key={option.key}
            onPress={() => onFilter(option.key)}
            accessibilityRole="radio"
            accessibilityLabel={number === null ? option.label : `${option.label} ${number}`}
            accessibilityState={{ checked: selected }}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
              {number === null ? option.label : `${option.label} ${number}`}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        onPress={onRequests}
        accessibilityRole="radio"
        accessibilityLabel="Requests"
        accessibilityState={{ checked: view === 'requests' }}
        style={styles.requests}
      >
        <Text style={[sharedStyles.link, view === 'requests' && styles.requestsSelected]}>
          Requests
        </Text>
      </Pressable>
    </View>
  );
}

/** One reorder request: the product, how many, who asked and how it ended. */
function RequestRow({ request }: { request: RestockRequest }) {
  const state =
    request.status === 'open'
      ? 'Open'
      : request.status === 'restocked'
        ? `Restocked ${request.closed_at ? formatDate(request.closed_at) : ''}`.trim()
        : `Cancelled ${request.closed_at ? formatDate(request.closed_at) : ''}`.trim();
  return (
    <Card style={styles.row}>
      <ProductPhoto uri={request.product.image_url} name={request.product.name} />
      <View style={styles.rowText}>
        <Text style={styles.name}>{request.product.name}</Text>
        <Text style={styles.body}>
          {request.quantity} requested on {formatDate(request.requested_at)} · {state}
        </Text>
        {request.requested_by ? (
          <Text style={styles.caption}>By {request.requested_by}</Text>
        ) : null}
        {request.note ? <Text style={styles.caption}>{request.note}</Text> : null}
      </View>
    </Card>
  );
}

/**
 * A list loaded a page at a time, with Show more under it. Give it a new `key` to start again
 * (a different filter, or after a change that reorders the list).
 */
function PagedList<T>({
  load,
  onDenied,
  empty,
  loadingMessage,
  keyOf,
  renderItem,
}: {
  load: (offset: number) => Promise<ApiResult<T[]>>;
  onDenied: OnDenied;
  empty: string;
  loadingMessage: string;
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactElement;
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const show = useCallback((offset: number, result: ApiResult<T[]>) => {
    setLoading(false);
    if (!result.ok) return setError(result.error);
    setRows((current) => (offset === 0 ? result.data : [...current, ...result.data]));
    setMore(result.data.length >= RESTOCK_PAGE_SIZE);
  }, []);

  // The first page, again whenever `load` changes (a different filter or store).
  useEffect(() => {
    let cancelled = false;
    load(0).then((result) => {
      if (!cancelled) show(0, result);
    });
    return () => {
      cancelled = true;
    };
  }, [load, show]);

  /** The next page, or (after an error) the page that failed. */
  function fetchPage(offset: number) {
    setLoading(true);
    setError(null);
    load(offset).then((result) => show(offset, result));
  }

  const refused = error?.status === 403 ? error.code : null;
  useEffect(() => {
    if (refused !== null) onDenied(refused);
  }, [refused, onDenied]);

  if (refused !== null) return null; // My store shows what they can still do

  return (
    <View style={styles.list}>
      {rows.map((row) => (
        <View key={keyOf(row)}>{renderItem(row)}</View>
      ))}
      {loading ? <Loader message={loadingMessage} size="small" /> : null}
      {error ? (
        <ErrorBanner message={error.message} onRetry={() => fetchPage(rows.length)} />
      ) : null}
      {!loading && !error && rows.length === 0 ? <Text style={styles.caption}>{empty}</Text> : null}
      {!loading && more ? (
        <Button title="Show more" variant="secondary" onPress={() => fetchPage(rows.length)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    padding: spacing.xl,
  },
  card: {
    gap: spacing.sm,
  },
  defaultRow: {
    gap: spacing.xs,
  },
  list: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  name: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  body: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  left: {
    alignSelf: 'flex-start',
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chip: {
    minHeight: sizes.touch,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  chipText: {
    ...textStyles.label,
    color: colors.textPrimary,
  },
  chipTextSelected: {
    color: colors.textOnPrimary,
  },
  requests: {
    marginLeft: 'auto',
    minHeight: sizes.touch,
    justifyContent: 'center',
  },
  requestsSelected: {
    textDecorationLine: 'underline',
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
