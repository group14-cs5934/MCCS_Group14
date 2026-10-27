import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { clearStoreStock, setStoreStock, type ApiError } from '@/api';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import StockChoiceEditor from '@/components/StockChoiceEditor';
import { colors, spacing, textStyles } from '@/theme';
import type { StaffStockRow } from '@/types/store';
import { stockChanges, validateStock, type StockFormRow } from '@/utils/productForm';

/** "In stock (12) · Aisle 7", "Out of stock", or "No stock record yet". */
function describe(row: StaffStockRow): string {
  if (!row.updated_at) return 'No stock record yet';
  const status = row.in_stock
    ? row.quantity
      ? `In stock (${row.quantity})`
      : 'In stock'
    : 'Out of stock';
  return row.aisle ? `${status} · ${row.aisle}` : status;
}

/** The row as the stock editor shows it: set by hand (in or out), or automatic. */
function formRow(storeId: number, row: StaffStockRow): StockFormRow {
  return {
    storeId,
    storeName: row.product.name,
    choice: row.admin_set_at ? (row.in_stock ? 'in' : 'out') : 'auto',
    quantity: row.admin_set_at && row.quantity ? String(row.quantity) : '',
    current: describe(row),
  };
}

type Props = {
  storeId: number;
  row: StaffStockRow;
  /** Called when the API refuses with 403: the user is no longer staff at this store. */
  onDenied: (code?: string) => void;
};

/**
 * One product's stock at the shopper's store, for its staff (My store). "Edit stock" sets it by
 * hand (in or out of stock, with an optional quantity), which the product monitor then leaves
 * alone; Automatic hands it back to the monitor.
 */
export default function StoreStockRow({ storeId, row: loaded, onDenied }: Props) {
  // The stock as last saved here; the list shows what it loaded until it loads again.
  const [row, setRow] = useState(loaded);
  const [editing, setEditing] = useState<StockFormRow | null>(null);
  const [quantityError, setQuantityError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set at once (state only changes on the next render), so a quick second tap can't save twice.
  const savingNow = useRef(false);
  const name = row.product.name;

  function fail(failure: ApiError) {
    if (failure.status === 403) onDenied(failure.code);
    else setError(`Couldn't save the stock of ${name}. ${failure.message}`);
  }

  async function save() {
    if (!editing || savingNow.current) return;
    const errors = validateStock([editing]);
    setQuantityError(errors[storeId]);
    if (errors[storeId]) return;
    const [change] = stockChanges([formRow(storeId, row)], [editing]);
    if (!change) return setEditing(null); // nothing changed

    savingNow.current = true;
    setSaving(true);
    setError(null);
    try {
      if (change.action === 'set') {
        const result = await setStoreStock(storeId, row.product.id, change.body);
        if (!result.ok) return fail(result.error);
        const { in_stock, quantity, aisle, updated_at, admin_set_at } = result.data;
        setRow({ ...row, in_stock, quantity, aisle, updated_at, admin_set_at });
      } else {
        const result = await clearStoreStock(storeId, row.product.id);
        // Already automatic (someone else handed it back) is as good as done.
        if (!result.ok && result.error.code !== 'admin_stock_not_found') {
          return fail(result.error);
        }
        setRow({ ...row, admin_set_at: null });
      }
      setEditing(null);
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <StockChoiceEditor
        title={name}
        row={editing}
        error={quantityError}
        onChange={(change) => setEditing({ ...editing, ...change })}
        quantityLabel={`Quantity of ${name} (optional)`}
      >
        {error ? <ErrorBanner message={error} /> : null}
        <View style={styles.actions}>
          <Button
            title="Cancel"
            variant="text"
            onPress={() => setEditing(null)}
            disabled={saving}
            style={styles.action}
          />
          <Button
            title="Save"
            onPress={save}
            loading={saving}
            accessibilityLabel={`Save the stock of ${name}`}
            style={styles.action}
          />
        </View>
      </StockChoiceEditor>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.text}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.caption}>
            {[row.product.size, `UPC ${row.product.barcode}`].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {row.admin_set_at ? <Badge label="Set by hand" tone="accent" /> : null}
      </View>
      <Text style={[styles.status, !row.in_stock && styles.out]}>{describe(row)}</Text>
      <Button
        title="Edit stock"
        variant="text"
        icon="create-outline"
        onPress={() => {
          setError(null);
          setQuantityError(undefined);
          setEditing(formRow(storeId, row));
        }}
        accessibilityLabel={`Edit the stock of ${name}`}
        style={styles.edit}
      />
    </Card>
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
    gap: spacing.xxs,
  },
  name: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  status: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  out: {
    color: colors.danger,
  },
  edit: {
    alignSelf: 'flex-start',
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
