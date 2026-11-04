import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { cancelRestockRequest, requestRestock, setReorderPoint } from '@/api';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import { ProductPhoto } from '@/components/SearchResultsList';
import TextField from '@/components/TextField';
import { changeError, isAccessLost, type OnDenied } from '@/components/storeAccess';
import { colors, spacing, textStyles } from '@/theme';
import type { RestockItem, RestockRequest } from '@/types/restock';

/** The largest quantity and reorder point the API accepts. */
const MAX_NUMBER = 10000;
const NOTE_MAX_LENGTH = 200;

/** "Oct 26, 2026" */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** A whole number from 0 (or 1) to the API's largest, or null if the text isn't one. */
function parseWhole(text: string, min: number): number | null {
  const typed = text.trim();
  if (!/^\d+$/.test(typed)) return null;
  const value = Number(typed);
  return value >= min && value <= MAX_NUMBER ? value : null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The views, scans and stock-outs of the last 30 days, as short lines. */
function statLines(item: RestockItem): string[] {
  const { stats } = item;
  const lines = [`Views ${stats.views_30d} · Scans ${stats.scans_30d} in 30 days`];
  if (stats.interest_change !== null) {
    const change = Math.round(stats.interest_change);
    lines.push(`Interest ${change > 0 ? '+' : ''}${change}% vs the 30 days before`);
  }
  lines.push(
    stats.stockouts_30d === 0
      ? 'Has not run out in 30 days'
      : `Ran out ${plural(stats.stockouts_30d, 'time', 'times')} in 30 days`,
  );
  if (stats.sold_per_day !== null) lines.push(`Sells about ${stats.sold_per_day} a day`);
  if (stats.days_left !== null) lines.push(`About ${plural(stats.days_left, 'day', 'days')} left`);
  return lines;
}

/** How the last request ended, when it isn't open. */
function closedText(request: RestockRequest): string {
  const when = request.closed_at ? ` on ${formatDate(request.closed_at)}` : '';
  return request.status === 'restocked'
    ? `Last request of ${request.quantity} was restocked${when}`
    : `Last request of ${request.quantity} was cancelled${when}`;
}

type Props = {
  storeId: number;
  item: RestockItem;
  /** Whether they may request reorders, cancel them and change reorder points. */
  canRequest: boolean;
  onDenied: OnDenied;
};

/**
 * One low or out-of-stock product: its status, statistics and the advice, with (for request_restock)
 * Request reorder, Cancel request and Change reorder point.
 */
export default function RestockItemCard({ storeId, item: loaded, canRequest, onDenied }: Props) {
  // The item as last changed here; the list shows what it loaded until it loads again.
  const [item, setItem] = useState(loaded);
  const [mode, setMode] = useState<'request' | 'point' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const name = item.product.name;
  const request = item.last_request;
  const open = request?.status === 'open' ? request : null;

  /** Runs one change once at a time; `run` returns true when it worked. */
  async function change(failure: string, run: () => Promise<string | true>) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    const outcome = await run();
    busy.current = false;
    setSaving(false);
    if (outcome === true) setMode(null);
    else setError(outcome || failure);
  }

  /** Turns a failed call into text, or hands a lost permission to My store. */
  const refused = (failure: string, result: { error: Parameters<typeof changeError>[0] }) => {
    if (isAccessLost(result.error)) {
      onDenied(result.error.code);
      return '';
    }
    return changeError(result.error, failure);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <ProductPhoto uri={item.product.image_url} name={name} />
        <View style={styles.text}>
          <Text style={styles.name}>{name}</Text>
          {item.product.size ? <Text style={styles.caption}>{item.product.size}</Text> : null}
          <View style={styles.badges}>
            <Badge label={item.status === 'out' ? 'Out' : 'Low'} tone="danger" />
            {item.stats.popular ? <Badge label="Popular" tone="accent" /> : null}
          </View>
        </View>
      </View>

      <Text style={styles.body}>
        {item.quantity === null ? 'Quantity unknown' : `Quantity ${item.quantity}`}
        {` · Reorder at ${item.reorder_point}`}
        {item.reorder_point_is_default ? ' (store default)' : ''}
        {item.aisle ? ` · ${item.aisle}` : ''}
      </Text>
      {statLines(item).map((line) => (
        <Text key={line} style={styles.caption}>
          {line}
        </Text>
      ))}
      {item.advice ? <Text style={styles.advice}>{item.advice}</Text> : null}

      {open ? (
        <Text style={styles.body}>
          Requested {open.quantity} on {formatDate(open.requested_at)}
          {open.note ? ` · ${open.note}` : ''}
        </Text>
      ) : request ? (
        <Text style={styles.caption}>{closedText(request)}</Text>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      {canRequest && mode === 'request' ? (
        <RequestForm
          item={item}
          saving={saving}
          onCancel={() => setMode(null)}
          onSubmit={(quantity, note) =>
            change(`Couldn't request ${name}.`, async () => {
              const result = await requestRestock(storeId, item.product.id, {
                quantity,
                ...(note && { note }),
              });
              if (!result.ok) return refused(`Couldn't request ${name}.`, result);
              setItem({ ...item, last_request: result.data });
              return true;
            })
          }
        />
      ) : canRequest && mode === 'point' ? (
        <ReorderPointForm
          item={item}
          saving={saving}
          onCancel={() => setMode(null)}
          onSubmit={(point) =>
            change(`Couldn't change the reorder point of ${name}.`, async () => {
              const result = await setReorderPoint(storeId, item.product.id, point);
              if (!result.ok) {
                return refused(`Couldn't change the reorder point of ${name}.`, result);
              }
              setItem({ ...item, ...result.data });
              return true;
            })
          }
        />
      ) : canRequest ? (
        <View style={styles.actions}>
          {open ? (
            <Button
              title="Cancel request"
              variant="text"
              loading={saving}
              accessibilityLabel={`Cancel the reorder request for ${name}`}
              style={styles.action}
              onPress={() =>
                change(`Couldn't cancel the request for ${name}.`, async () => {
                  const result = await cancelRestockRequest(storeId, item.product.id);
                  // Already closed (restocked or cancelled elsewhere) is as good as cancelled.
                  if (!result.ok && result.error.code !== 'no_open_request') {
                    return refused(`Couldn't cancel the request for ${name}.`, result);
                  }
                  setItem({ ...item, last_request: { ...open, status: 'cancelled' } });
                  return true;
                })
              }
            />
          ) : (
            <Button
              title="Request reorder"
              variant="secondary"
              icon="cart-outline"
              accessibilityLabel={`Request reorder of ${name}`}
              style={styles.action}
              onPress={() => {
                setError(null);
                setMode('request');
              }}
            />
          )}
          <Button
            title="Reorder point"
            variant="text"
            accessibilityLabel={`Change the reorder point of ${name}`}
            style={styles.action}
            onPress={() => {
              setError(null);
              setMode('point');
            }}
          />
        </View>
      ) : null}
    </Card>
  );
}

/** Quantity (suggested, or what was asked for last time) and an optional note. */
function RequestForm({
  item,
  saving,
  onCancel,
  onSubmit,
}: {
  item: RestockItem;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (quantity: number, note: string) => void;
}) {
  const start = item.suggested_quantity ?? item.last_request?.quantity;
  const [quantity, setQuantity] = useState(start === undefined ? '' : String(start));
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const name = item.product.name;

  function submit() {
    const value = parseWhole(quantity, 1);
    if (value === null) {
      setProblem(`Enter a whole number from 1 to ${MAX_NUMBER}.`);
      return;
    }
    setProblem(undefined);
    onSubmit(value, note.trim());
  }

  return (
    <View style={styles.form}>
      <TextField
        label={`Quantity to order of ${name}`}
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="number-pad"
        error={problem}
      />
      <TextField
        label={`Note for ${name} (optional)`}
        value={note}
        onChangeText={setNote}
        maxLength={NOTE_MAX_LENGTH}
      />
      <View style={styles.actions}>
        <Button
          title="Cancel"
          variant="text"
          onPress={onCancel}
          disabled={saving}
          style={styles.action}
        />
        <Button
          title="Send request"
          onPress={submit}
          loading={saving}
          accessibilityLabel={`Send the reorder request for ${name}`}
          style={styles.action}
        />
      </View>
    </View>
  );
}

/** This product's own reorder point, or back to the store's default. */
function ReorderPointForm({
  item,
  saving,
  onCancel,
  onSubmit,
}: {
  item: RestockItem;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (point: number | null) => void;
}) {
  const [text, setText] = useState(String(item.reorder_point));
  const [problem, setProblem] = useState<string | undefined>();
  const name = item.product.name;

  function submit() {
    const value = parseWhole(text, 0);
    if (value === null) {
      setProblem(`Enter a whole number from 0 to ${MAX_NUMBER}.`);
      return;
    }
    setProblem(undefined);
    onSubmit(value);
  }

  return (
    <View style={styles.form}>
      <TextField
        label={`Reorder point of ${name}`}
        value={text}
        onChangeText={setText}
        keyboardType="number-pad"
        error={problem}
      />
      <View style={styles.actions}>
        <Button
          title="Cancel"
          variant="text"
          onPress={onCancel}
          disabled={saving}
          style={styles.action}
        />
        {item.reorder_point_is_default ? null : (
          <Button
            title="Use store default"
            variant="text"
            onPress={() => onSubmit(null)}
            disabled={saving}
            accessibilityLabel={`Use the store default reorder point for ${name}`}
            style={styles.action}
          />
        )}
        <Button
          title="Save"
          onPress={submit}
          loading={saving}
          accessibilityLabel={`Save the reorder point of ${name}`}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  advice: {
    ...textStyles.bodyStrong,
    color: colors.accent,
  },
  form: {
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  action: {
    alignSelf: 'auto',
  },
});
