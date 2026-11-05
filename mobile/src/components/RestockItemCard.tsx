import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { cancelRestockRequest, requestRestock, setReorderPoint } from '@/api';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import { ProductPhoto } from '@/components/SearchResultsList';
import TextField from '@/components/TextField';
import { changeError, isAccessLost, type OnDenied } from '@/components/storeAccess';
import { colors, radius, sizes, spacing, textStyles } from '@/theme';
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

/** 1200 as "1.2k". */
function compact(count: number): string {
  return count >= 1000 ? `${Math.round(count / 100) / 10}k` : String(count);
}

/** The three figures under the name: views, stock-outs, and the sales rate (else scans). */
function figures(item: RestockItem): { value: string; label: string }[] {
  const { stats } = item;
  return [
    { value: compact(stats.views_30d), label: 'views, 30 days' },
    { value: `${stats.stockouts_30d}×`, label: 'ran out, 30 days' },
    stats.sold_per_day !== null
      ? { value: `~${stats.sold_per_day} / day`, label: 'sells' }
      : { value: compact(stats.scans_30d), label: 'scans, 30 days' },
  ];
}

/** Facts that don't fit in the figures, as short lines. */
function extraLines(item: RestockItem): string[] {
  const { stats } = item;
  const lines: string[] = [];
  if (stats.interest_change !== null) {
    const change = Math.round(stats.interest_change);
    lines.push(`Interest ${change > 0 ? '+' : ''}${change}% vs the 30 days before`);
  }
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
  /** Called after a request, cancel or reorder-point change, so counts elsewhere can reload. */
  onChanged: () => void;
};

/**
 * One low or out-of-stock product: its status, figures and the advice, with (for request_restock)
 * a quantity stepper with Request reorder, Cancel, and Change reorder point.
 */
export default function RestockItemCard({
  storeId,
  item: loaded,
  canRequest,
  onDenied,
  onChanged,
}: Props) {
  // The item as last changed here; the list shows what it loaded until it loads again.
  const [item, setItem] = useState(loaded);
  const [pointOpen, setPointOpen] = useState(false);
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
    if (outcome === true) {
      setPointOpen(false);
      onChanged();
    } else {
      setError(outcome || failure);
    }
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
            {item.status === 'out' ? (
              <Badge label="Out of stock" tone="danger" />
            ) : (
              <Badge
                label={item.quantity === null ? 'Low' : `Low · ${item.quantity} left`}
                tone="warning"
              />
            )}
            {item.stats.popular ? <Badge label="Popular" tone="info" /> : null}
          </View>
        </View>
      </View>

      <View style={styles.figures}>
        {figures(item).map((figure) => (
          <View key={figure.label} style={styles.figure}>
            <Text style={styles.figureValue}>{figure.value}</Text>
            <Text style={styles.caption}>{figure.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption}>
        {item.quantity === null ? 'Quantity unknown' : `Quantity ${item.quantity}`}
        {` · Reorder at ${item.reorder_point}`}
        {item.reorder_point_is_default ? ' (store default)' : ''}
        {item.aisle ? ` · ${item.aisle}` : ''}
      </Text>
      {extraLines(item).map((line) => (
        <Text key={line} style={styles.caption}>
          {line}
        </Text>
      ))}
      {item.advice ? (
        <View style={styles.advice}>
          <Text style={styles.adviceText}>{item.advice}</Text>
        </View>
      ) : null}

      {open ? (
        <View style={styles.requested}>
          <Ionicons name="cube-outline" size={sizes.icon} color={colors.accent} />
          <Text style={styles.requestedText}>
            Requested {open.quantity} on {formatDate(open.requested_at)}
            {open.note ? ` · ${open.note}` : ''}
          </Text>
          {canRequest ? (
            <Button
              title="Cancel"
              variant="secondary"
              loading={saving}
              accessibilityLabel={`Cancel the reorder request for ${name}`}
              style={styles.cancel}
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
          ) : null}
        </View>
      ) : request ? (
        <Text style={styles.caption}>{closedText(request)}</Text>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      {canRequest && pointOpen ? (
        <ReorderPointForm
          item={item}
          saving={saving}
          onCancel={() => setPointOpen(false)}
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
        <>
          {open ? null : (
            <RequestForm
              item={item}
              saving={saving}
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
          )}
          <Button
            title="Reorder point"
            variant="text"
            accessibilityLabel={`Change the reorder point of ${name}`}
            style={styles.left}
            onPress={() => {
              setError(null);
              setPointOpen(true);
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

/** A quantity stepper (suggested, or what was asked for last time), Request reorder, and a note. */
function RequestForm({
  item,
  saving,
  onSubmit,
}: {
  item: RestockItem;
  saving: boolean;
  onSubmit: (quantity: number, note: string) => void;
}) {
  const start = item.suggested_quantity ?? item.last_request?.quantity;
  const [quantity, setQuantity] = useState(start === undefined ? '' : String(start));
  const [note, setNote] = useState('');
  const [noting, setNoting] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const name = item.product.name;

  function step(by: number) {
    const current = parseWhole(quantity, 0) ?? 0;
    setQuantity(String(Math.min(MAX_NUMBER, Math.max(1, current + by))));
    setProblem(undefined);
  }

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
      <View style={styles.order}>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => step(-1)}
            accessibilityRole="button"
            accessibilityLabel={`One less of ${name}`}
            style={styles.step}
          >
            <Ionicons name="remove" size={sizes.icon} color={colors.textPrimary} />
          </Pressable>
          <TextInput
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="number-pad"
            accessibilityLabel={`Quantity to order of ${name}`}
            style={styles.quantity}
          />
          <Pressable
            onPress={() => step(1)}
            accessibilityRole="button"
            accessibilityLabel={`One more of ${name}`}
            style={styles.step}
          >
            <Ionicons name="add" size={sizes.icon} color={colors.textPrimary} />
          </Pressable>
        </View>
        <Button
          title="Request reorder"
          variant="action"
          onPress={submit}
          loading={saving}
          accessibilityLabel={`Request reorder of ${name}`}
          style={styles.orderButton}
        />
      </View>
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      {noting ? (
        <TextField
          label={`Note for ${name} (optional)`}
          value={note}
          onChangeText={setNote}
          maxLength={NOTE_MAX_LENGTH}
        />
      ) : (
        <Button
          title="Add a note"
          variant="text"
          accessibilityLabel={`Add a note to the reorder of ${name}`}
          onPress={() => setNoting(true)}
          style={styles.left}
        />
      )}
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
    gap: spacing.sm,
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
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  figures: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  figure: {
    flex: 1,
    gap: spacing.xxs,
  },
  figureValue: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  advice: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.actionSoft,
  },
  adviceText: {
    ...textStyles.body,
    color: colors.actionPressed,
  },
  requested: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  requestedText: {
    ...textStyles.bodyStrong,
    flex: 1,
    color: colors.textPrimary,
  },
  cancel: {
    alignSelf: 'auto',
  },
  order: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  step: {
    width: sizes.touch,
    height: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantity: {
    ...textStyles.bodyStrong,
    minWidth: sizes.touch,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  orderButton: {
    flex: 1,
  },
  problem: {
    ...textStyles.caption,
    color: colors.danger,
  },
  left: {
    alignSelf: 'flex-start',
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
