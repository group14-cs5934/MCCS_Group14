import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { clearStock, createProduct, setStock, updateProduct, type ApiError } from '@/api';
import AdminGate, { AccessDenied } from '@/components/AdminGate';
import AsyncContent from '@/components/AsyncContent';
import Button from '@/components/Button';
import ErrorState from '@/components/ErrorState';
import StockChoiceEditor from '@/components/StockChoiceEditor';
import TextField from '@/components/TextField';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';
import type { AdminProductStock, Store } from '@/types/admin';
import type { Product } from '@/types/product';
import {
  EMPTY_PRODUCT_FORM,
  MAX_LENGTHS,
  createBody,
  editBody,
  formValuesFrom,
  hasProductErrors,
  stockChanges,
  stockRowsFrom,
  validateProductForm,
  validateStock,
  type ProductFormErrors,
  type ProductFormValues,
  type StockFormRow,
} from '@/utils/productForm';

/**
 * Admin product form (T091): add a product (/admin-product/new) or edit one (/admin-product/7),
 * including its stock at each store. Missing or invalid fields are shown and nothing is sent.
 */
export default function AdminProductScreen() {
  const { id, saved, stockFailed } = useLocalSearchParams<{
    id: string;
    saved?: string;
    stockFailed?: string;
  }>();
  const productId = /^[1-9]\d*$/.test(id) ? Number(id) : null;

  if (id === 'new') {
    return (
      <AdminGate>
        <Stack.Screen options={{ title: 'Add product' }} />
        <AddProduct />
      </AdminGate>
    );
  }
  // A product just added opens here; if some of its stock couldn't be saved, say where.
  const firstMessage: Message | undefined = stockFailed
    ? {
        tone: 'error',
        text: `Product added, but its stock at ${stockFailed} couldn't be saved. Set it again below.`,
      }
    : saved === '1'
      ? { tone: 'success', text: 'Product added.' }
      : undefined;
  return (
    <AdminGate>
      <Stack.Screen options={{ title: 'Edit product' }} />
      {productId ? (
        <EditProduct productId={productId} firstMessage={firstMessage} />
      ) : (
        <ErrorState
          title="Product not found"
          message="This link doesn't point to a product."
          icon="help-circle-outline"
          style={sharedStyles.centered}
        />
      )}
    </AdminGate>
  );
}

function AddProduct() {
  const { loading, data, error, reload } = useApiGet<Store[]>('/locations');
  return (
    <AsyncContent loading={loading} error={error?.message} onRetry={reload}>
      {data ? (
        <ProductForm
          productId={null}
          initialValues={EMPTY_PRODUCT_FORM}
          initialStock={newProductStock(data)}
        />
      ) : null}
    </AsyncContent>
  );
}

function EditProduct({ productId, firstMessage }: { productId: number; firstMessage?: Message }) {
  const product = useApiGet<Product>(`/products/${productId}`);
  const stock = useApiGet<AdminProductStock>(`/admin/products/${productId}/stock`);
  // Kept here, because saving reloads the form (to show what the server has now).
  const [message, setMessage] = useState<Message | undefined>(firstMessage);

  if (stock.error?.status === 403) return <AccessDenied />;
  const loading = product.loading || stock.loading;
  const error = product.error ?? stock.error;
  return (
    <AsyncContent
      loading={loading}
      error={error?.message}
      onRetry={() => {
        product.reload();
        stock.reload();
      }}
      loadingMessage="Loading product…"
    >
      {product.data && stock.data ? (
        <ProductForm
          // A fresh form for each load, e.g. after saving, so it shows what the server has now.
          key={`${product.data.updated_at}|${stock.data.stores.map(stockKey).join()}`}
          productId={productId}
          initialValues={formValuesFrom(product.data)}
          initialStock={stockRowsFrom(stock.data.stores)}
          initialMessage={message}
          onSaved={(result) => {
            setMessage(result);
            product.reload();
            stock.reload();
          }}
        />
      ) : null}
    </AsyncContent>
  );
}

const stockKey = (row: AdminProductStock['stores'][number]) =>
  `${row.store.id}:${row.in_stock}:${row.quantity}:${row.admin_set_at}`;

function newProductStock(stores: Store[]): StockFormRow[] {
  return stores.map((store) => ({
    storeId: store.id,
    storeName: store.name,
    choice: 'auto',
    quantity: '',
    current: 'No stock record yet',
  }));
}

type Message = { tone: 'success' | 'error'; text: string };

function ProductForm({
  productId,
  initialValues,
  initialStock,
  initialMessage,
  onSaved,
}: {
  productId: number | null;
  initialValues: ProductFormValues;
  initialStock: StockFormRow[];
  initialMessage?: Message;
  /** After a save (all of it, or the product but not all its stock): reload, then show this. */
  onSaved?: (result: Message) => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [stock, setStockRows] = useState(initialStock);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [stockErrors, setStockErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<Message | undefined>(initialMessage);
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState(false);
  // Set at once (state only changes on the next render), so a quick second tap can't save twice.
  const savingNow = useRef(false);

  const field = (key: keyof ProductFormValues) => ({
    value: values[key],
    error: errors[key],
    onChangeText: (text: string) => setValues((all) => ({ ...all, [key]: text })),
  });

  function changeStock(storeId: number, change: Partial<StockFormRow>) {
    setStockRows((rows) =>
      rows.map((row) => (row.storeId === storeId ? { ...row, ...change } : row)),
    );
  }

  /** Shows why saving failed; a taken barcode goes on the barcode field. */
  function showFailure(error: ApiError, what: string) {
    if (error.status === 403) {
      setDenied(true);
    } else if (error.code === 'barcode_taken') {
      setErrors((all) => ({ ...all, barcode: 'Another product already has this barcode.' }));
      setMessage({ tone: 'error', text: 'Fix the highlighted fields.' });
    } else {
      const detail = error.serverMessage ? ` ${error.serverMessage}.` : '';
      setMessage({ tone: 'error', text: `Couldn't save ${what}. ${error.message}${detail}` });
    }
  }

  /** Saves each store whose stock changed; returns the first that failed, if any. */
  async function saveStock(id: number): Promise<{ store: string; error: ApiError } | null> {
    for (const change of stockChanges(initialStock, stock)) {
      const result =
        change.action === 'set'
          ? await setStock(id, change.storeId, change.body)
          : await clearStock(id, change.storeId);
      if (!result.ok) {
        const store = stock.find((row) => row.storeId === change.storeId)?.storeName ?? 'a store';
        return { store, error: result.error };
      }
    }
    return null;
  }

  async function save() {
    if (savingNow.current) return;
    const fieldErrors = validateProductForm(values);
    if (productId !== null && initialValues.price && !values.price.trim()) {
      // A product's price history can't be removed, so emptying it can't be saved.
      fieldErrors.price = "A price can't be removed. Enter the current price, or a new one.";
    }
    const quantityErrors = validateStock(stock);
    setErrors(fieldErrors);
    setStockErrors(quantityErrors);
    if (hasProductErrors(fieldErrors) || Object.keys(quantityErrors).length > 0) {
      setMessage({ tone: 'error', text: 'Fix the highlighted fields.' });
      return;
    }

    savingNow.current = true;
    setSaving(true);
    setMessage(undefined);
    try {
      if (productId === null) {
        const created = await createProduct(createBody(values));
        if (!created.ok) return showFailure(created.error, 'the product');
        // From here the product exists, so the form always switches to editing it.
        const failed = await saveStock(created.data.id);
        const params = failed
          ? { id: created.data.id, stockFailed: failed.store }
          : { id: created.data.id, saved: '1' };
        router.replace({ pathname: '/admin-product/[id]', params });
        return;
      }

      const body = editBody(initialValues, values);
      const changes = stockChanges(initialStock, stock);
      if (Object.keys(body).length === 0 && changes.length === 0) {
        setMessage({ tone: 'success', text: 'Nothing to save: no changes.' });
        return;
      }
      if (Object.keys(body).length > 0) {
        const updated = await updateProduct(productId, body);
        if (!updated.ok) return showFailure(updated.error, 'the product');
      }
      const failed = await saveStock(productId);
      if (failed?.error.status === 403) return setDenied(true);
      // Reload either way, so a retry starts from what was actually saved.
      onSaved?.(
        failed
          ? {
              tone: 'error',
              text: `Saved, except the stock at ${failed.store}: ${failed.error.message} Set it again below.`,
            }
          : { tone: 'success', text: 'Saved.' },
      );
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  if (denied) return <AccessDenied />;

  return (
    <ScrollView
      style={sharedStyles.screen}
      contentContainerStyle={[sharedStyles.screenContent, styles.form]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.section}>Product</Text>
      <TextField
        label="Barcode (required)"
        keyboardType="number-pad"
        maxLength={14}
        {...field('barcode')}
      />
      <TextField label="Name (required)" maxLength={MAX_LENGTHS.name} {...field('name')} />
      <TextField
        label="Price (USD)"
        keyboardType="decimal-pad"
        placeholder="3.49"
        {...field('price')}
      />
      <TextField label="Size" placeholder="184g" maxLength={MAX_LENGTHS.size} {...field('size')} />
      <TextField
        label="Photo URL"
        placeholder="https://…"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        {...field('imageUrl')}
      />
      <TextField
        label="Description"
        multiline
        maxLength={MAX_LENGTHS.description}
        inputStyle={styles.description}
        {...field('description')}
      />

      <Text style={styles.section}>Stock at each store</Text>
      <Text style={styles.hint}>
        Automatic follows the MCCS online store. In stock or Out of stock is kept until you set it
        back to Automatic.
      </Text>
      {stock.length === 0 ? <Text style={styles.hint}>No stores yet.</Text> : null}
      {stock.map((row) => (
        <StockChoiceEditor
          key={row.storeId}
          title={row.storeName}
          row={row}
          error={stockErrors[row.storeId]}
          onChange={(change) => changeStock(row.storeId, change)}
        />
      ))}

      {message ? (
        <Text
          style={[styles.message, message.tone === 'error' ? styles.error : styles.success]}
          accessibilityLiveRegion="polite"
          accessibilityRole={message.tone === 'error' ? 'alert' : undefined}
        >
          {message.text}
        </Text>
      ) : null}
      <Button title={productId ? 'Save changes' : 'Add product'} onPress={save} loading={saving} />
      {productId ? (
        <Button
          title="View in app"
          variant="text"
          onPress={() => router.push(`/product/${productId}`)}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
  section: {
    ...textStyles.subheading,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  hint: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  description: {
    minHeight: spacing.xxxl * 2,
    textAlignVertical: 'top',
  },
  message: {
    ...textStyles.body,
  },
  error: {
    color: colors.danger,
  },
  success: {
    color: colors.success,
  },
});
