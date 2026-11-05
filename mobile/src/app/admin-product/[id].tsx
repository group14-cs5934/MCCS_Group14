import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  clearStock,
  createProduct,
  deleteProduct,
  getProductStock,
  setStock,
  updateProduct,
  type ApiError,
} from '@/api';
import AdminGate, { AccessDenied } from '@/components/AdminGate';
import AsyncContent from '@/components/AsyncContent';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import ErrorState from '@/components/ErrorState';
import { ProductPhoto } from '@/components/SearchResultsList';
import SectionTabs from '@/components/SectionTabs';
import StockChoiceEditor from '@/components/StockChoiceEditor';
import TextField from '@/components/TextField';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, radius, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { AdminProductStock, AdminStoreStock, StockBody, Store } from '@/types/admin';
import type { Product } from '@/types/product';
import { formatPrice } from '@/utils/formatPrice';
import {
  EMPTY_PRODUCT_FORM,
  MAX_LENGTHS,
  createBody,
  editBody,
  formValuesFrom,
  hasProductErrors,
  stockChanges,
  validateProductForm,
  validateStock,
  type ProductFormErrors,
  type ProductFormValues,
  type StockFormRow,
} from '@/utils/productForm';

/**
 * Admin product page (T091): add a product (/admin-product/new) or open one (/admin-product/7).
 * An existing product opens on its stock at every store, which can be edited a store at a time,
 * with its details on the other tab. Missing or invalid fields are shown and nothing is sent.
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

type Message = { tone: 'success' | 'error'; text: string };

type Tab = 'stock' | 'details';

const tabs: { key: Tab; label: string }[] = [
  { key: 'stock', label: 'Stock' },
  { key: 'details', label: 'Details' },
];

function AddProduct() {
  const { loading, data, error, reload } = useApiGet<Store[]>('/locations');
  const [denied, setDenied] = useState(false);
  if (denied) return <AccessDenied />;
  return (
    <AsyncContent loading={loading} error={error?.message} onRetry={reload}>
      {data ? (
        <ScrollView
          style={sharedStyles.screen}
          contentContainerStyle={sharedStyles.screenContent}
          keyboardShouldPersistTaps="handled"
        >
          <ProductForm
            productId={null}
            initialValues={EMPTY_PRODUCT_FORM}
            initialStock={newProductStock(data)}
            onDenied={() => setDenied(true)}
          />
        </ScrollView>
      ) : null}
    </AsyncContent>
  );
}

function EditProduct({ productId, firstMessage }: { productId: number; firstMessage?: Message }) {
  const product = useApiGet<Product>(`/products/${productId}`);
  const stock = useApiGet<AdminProductStock>(`/admin/products/${productId}/stock`);
  // Kept here, because saving reloads the form (to show what the server has now).
  const [message, setMessage] = useState<Message | undefined>(firstMessage);
  const [tab, setTab] = useState<Tab>('stock');
  // The stores' stock once an edit has changed it; until then, what the page loaded with.
  const [edited, setEdited] = useState<AdminStoreStock[] | null>(null);
  const [denied, setDenied] = useState(false);

  if (denied || stock.error?.status === 403) return <AccessDenied />;
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
        <ScrollView
          style={sharedStyles.screen}
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
        >
          <ProductHeader product={product.data} />
          <SectionTabs
            tabs={tabs}
            selected={tab}
            onSelect={(next) => {
              setTab(next);
              setMessage(undefined);
            }}
          />
          <View style={styles.body}>
            {message ? <MessageText message={message} /> : null}
            {/* Both stay mounted, so details typed in aren't lost when looking at the stock. */}
            <View style={tab === 'stock' ? undefined : styles.hidden}>
              <StockTab
                productId={productId}
                rows={edited ?? stock.data.stores}
                onRows={setEdited}
                onDenied={() => setDenied(true)}
              />
            </View>
            <View style={tab === 'details' ? undefined : styles.hidden}>
              <ProductForm
                // A fresh form for each load, e.g. after saving, so it shows what the server has now.
                key={product.data.updated_at}
                productId={productId}
                initialValues={formValuesFrom(product.data)}
                initialStock={[]}
                onSaved={(result) => {
                  setMessage(result);
                  product.reload();
                }}
                onDenied={() => setDenied(true)}
              />
            </View>
          </View>
        </ScrollView>
      ) : null}
    </AsyncContent>
  );
}

/** The product at a glance: photo, name, barcode, price, and a link to its page in the app. */
function ProductHeader({ product }: { product: Product }) {
  const router = useRouter();
  const detail = [product.barcode, product.size].filter(Boolean).join(' · ');
  return (
    <Card style={styles.header}>
      <View style={styles.headerTop}>
        <ProductPhoto uri={product.image_url} name={product.name} size={sizes.thumb} />
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={2}>
            {product.name}
          </Text>
          <Text style={styles.caption} numberOfLines={1}>
            {detail}
          </Text>
          <Text style={product.price ? styles.headerPrice : styles.caption}>
            {product.price ? formatPrice(product.price) : 'No price yet'}
          </Text>
        </View>
      </View>
      <Button
        title="View in app"
        variant="text"
        icon="open-outline"
        onPress={() => router.push(`/product/${product.id}`)}
      />
    </Card>
  );
}

// --- Stock tab ---

/** How one store stands: the pill's words and colors. */
function statusOf(row: AdminStoreStock): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | null;
} {
  if (!row.updated_at) return { label: 'No record', tone: null };
  if (!row.in_stock) return { label: 'Out', tone: 'danger' };
  if (row.low) return { label: 'Low', tone: 'warning' };
  return { label: 'In stock', tone: 'success' };
}

/** Every store's stock of the product, one tap from being edited. */
function StockTab({
  productId,
  rows,
  onRows,
  onDenied,
}: {
  productId: number;
  rows: AdminStoreStock[];
  onRows: (rows: AdminStoreStock[]) => void;
  onDenied: () => void;
}) {
  // Only one store is open at a time.
  const [openId, setOpenId] = useState<number | null>(null);

  if (rows.length === 0) return <Text style={styles.caption}>No stores yet.</Text>;
  return (
    <View style={styles.stockCard}>
      {rows.map((row, index) => (
        <StockRow
          key={row.store.id}
          row={row}
          first={index === 0}
          open={openId === row.store.id}
          onToggle={() => setOpenId(openId === row.store.id ? null : row.store.id)}
        >
          <StockEditor
            productId={productId}
            row={row}
            onSaved={(saved, keepOpen) => {
              onRows(rows.map((item) => (item.store.id === saved.store.id ? saved : item)));
              if (!keepOpen) setOpenId(null);
            }}
            onReplaced={(all) => {
              onRows(all);
              setOpenId(null);
            }}
            onCancel={() => setOpenId(null)}
            onDenied={onDenied}
          />
        </StockRow>
      ))}
    </View>
  );
}

function StockRow({
  row,
  first,
  open,
  onToggle,
  children,
}: {
  row: AdminStoreStock;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const status = statusOf(row);
  const facts = [row.quantity !== null ? `${row.quantity} on hand` : null, row.aisle].filter(
    Boolean,
  );
  const factsText = facts.join(' · ');
  return (
    <View style={[!first && styles.divider, open && styles.openRow]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={[
          row.store.name,
          status.label,
          factsText,
          row.admin_set_at && 'Admin set',
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.stockSummary, pressed && styles.pressed]}
      >
        <View style={styles.stockText}>
          <Text style={styles.storeName}>{row.store.name}</Text>
          <Text style={styles.caption}>{factsText || 'Quantity and aisle not set'}</Text>
          {row.admin_set_at ? (
            <Text style={styles.adminSet}>Admin set: automatic updates leave it alone</Text>
          ) : null}
        </View>
        {status.tone ? (
          <Badge label={status.label} tone={status.tone} />
        ) : (
          <Text style={[sharedStyles.pill, styles.noRecord]}>{status.label}</Text>
        )}
        <Ionicons
          name={open ? 'chevron-up' : 'create-outline'}
          size={sizes.icon}
          color={colors.textSecondary}
        />
      </Pressable>
      {open ? children : null}
    </View>
  );
}

/** One store's stock, set by hand: in or out, how many, and the aisle. */
function StockEditor({
  productId,
  row,
  onSaved,
  onReplaced,
  onCancel,
  onDenied,
}: {
  productId: number;
  row: AdminStoreStock;
  /** keepOpen leaves the editor open, e.g. to show a note about the saved row. */
  onSaved: (row: AdminStoreStock, keepOpen?: boolean) => void;
  /** After removing the record: every store's stock as it is now. */
  onReplaced: (rows: AdminStoreStock[]) => void;
  onCancel: () => void;
  onDenied: () => void;
}) {
  const store = row.store.name;
  const [inStock, setInStock] = useState(row.updated_at ? row.in_stock : true);
  const [quantity, setQuantity] = useState(row.quantity ? String(row.quantity) : '');
  const [aisle, setAisle] = useState(row.aisle ?? '');
  const [quantityError, setQuantityError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  // Set at once (state only changes on the next render), so a quick second tap can't send twice.
  const busyNow = useRef(false);

  const count = /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : 0;

  function fail(failure: ApiError, what: string) {
    if (failure.status === 403) return onDenied();
    const detail = failure.serverMessage ? ` ${failure.serverMessage}.` : '';
    setError(`Couldn't ${what} at ${store}. ${failure.message}${detail}`);
  }

  async function save() {
    if (busyNow.current) return;
    const problem = validateStock([
      { storeId: 0, storeName: store, choice: inStock ? 'in' : 'out', quantity, current: '' },
    ])[0];
    setQuantityError(problem);
    if (problem) return;

    busyNow.current = true;
    setBusy('save');
    setError(undefined);
    const body: StockBody = { in_stock: inStock };
    if (inStock && quantity.trim()) body.quantity = Number(quantity.trim());
    // Leaving aisle out keeps the store's aisle, so an emptied box has to send null to clear it.
    if (aisle.trim()) body.aisle = aisle.trim();
    else if (row.aisle) body.aisle = null;
    const result = await setStock(productId, row.store.id, body);
    busyNow.current = false;
    setBusy(null);
    if (result.ok) onSaved(result.data);
    else fail(result.error, 'save stock');
  }

  async function remove() {
    if (busyNow.current) return;
    busyNow.current = true;
    setBusy('remove');
    setError(undefined);
    const removed = await clearStock(productId, row.store.id);
    // The store then follows automatic updates again, so ask what it says now.
    const now = removed.ok ? await getProductStock(productId) : null;
    busyNow.current = false;
    setBusy(null);
    if (!removed.ok) fail(removed.error, 'remove the record');
    else if (now && now.ok) onReplaced(now.data.stores);
    else {
      // Removed, but what the store says now couldn't be loaded, so the values shown may be old.
      onSaved({ ...row, admin_set_at: null }, true);
      setError(`Removed the record at ${store}. Reload to see its current stock.`);
    }
  }

  return (
    <View style={styles.editor}>
      <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={store}>
        {[
          { value: true, label: 'In stock' },
          { value: false, label: 'Out of stock' },
        ].map((option) => (
          <Pressable
            key={option.label}
            onPress={() => setInStock(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={`${store}: ${option.label}`}
            accessibilityState={{ checked: inStock === option.value }}
            style={[styles.segment, inStock === option.value && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, inStock === option.value && styles.segmentTextOn]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {inStock ? (
        <View style={styles.stepper}>
          <StepButton
            icon="remove"
            label={`Decrease quantity at ${store}`}
            disabled={count <= 1}
            onPress={() => setQuantity(String(count - 1))}
          />
          <TextField
            label={`Quantity at ${store}`}
            keyboardType="number-pad"
            value={quantity}
            error={quantityError}
            onChangeText={setQuantity}
            style={styles.quantity}
          />
          <StepButton
            icon="add"
            label={`Increase quantity at ${store}`}
            onPress={() => setQuantity(String(count + 1))}
          />
        </View>
      ) : null}

      <TextField
        label={`Aisle at ${store}`}
        placeholder="Aisle 7"
        maxLength={50}
        value={aisle}
        onChangeText={setAisle}
      />

      {error ? <ErrorBanner message={error} /> : null}
      <View style={styles.actions}>
        <Button
          title="Cancel"
          variant="secondary"
          onPress={onCancel}
          disabled={busy !== null}
          accessibilityLabel={`Cancel editing ${store}`}
          style={styles.action}
        />
        <Button
          title="Save"
          onPress={save}
          loading={busy === 'save'}
          disabled={busy === 'remove'}
          accessibilityLabel={`Save stock at ${store}`}
          style={[styles.action, styles.primaryAction]}
        />
      </View>
      {row.admin_set_at ? (
        <Button
          title="Remove record"
          variant="text"
          onPress={remove}
          loading={busy === 'remove'}
          disabled={busy === 'save'}
          accessibilityLabel={`Remove record at ${store}`}
        />
      ) : null}
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.step, disabled && styles.stepDisabled]}
    >
      <Ionicons name={icon} size={sizes.iconLarge} color={colors.textPrimary} />
    </Pressable>
  );
}

// --- Details tab ---

function newProductStock(stores: Store[]): StockFormRow[] {
  return stores.map((store) => ({
    storeId: store.id,
    storeName: store.name,
    choice: 'auto',
    quantity: '',
    current: 'No stock record yet',
  }));
}

function MessageText({ message }: { message: Message }) {
  return (
    <Text
      style={[styles.message, message.tone === 'error' ? styles.error : styles.success]}
      accessibilityLiveRegion="polite"
      accessibilityRole={message.tone === 'error' ? 'alert' : undefined}
    >
      {message.text}
    </Text>
  );
}

/**
 * A product's fields in grouped cards. Adding also takes its starting stock at each store (those
 * are saved after the product); an existing product's stock is edited on the Stock tab instead.
 */
function ProductForm({
  productId,
  initialValues,
  initialStock,
  onSaved,
  onDenied,
}: {
  productId: number | null;
  initialValues: ProductFormValues;
  initialStock: StockFormRow[];
  /** After saving an edit: reload, then show this. */
  onSaved?: (result: Message) => void;
  /** When the API says the signed-in user is no longer an admin. */
  onDenied: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [stock, setStockRows] = useState(initialStock);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [stockErrors, setStockErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<Message>();
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      onDenied();
    } else if (error.code === 'barcode_taken') {
      setErrors((all) => ({ ...all, barcode: 'Another product already has this barcode.' }));
      setMessage({ tone: 'error', text: 'Fix the highlighted fields.' });
    } else {
      const detail = error.serverMessage ? ` ${error.serverMessage}.` : '';
      setMessage({ tone: 'error', text: `Couldn't ${what}. ${error.message}${detail}` });
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
        if (!created.ok) return showFailure(created.error, 'save the product');
        // From here the product exists, so the form always switches to editing it.
        const failed = await saveStock(created.data.id);
        const params = failed
          ? { id: created.data.id, stockFailed: failed.store }
          : { id: created.data.id, saved: '1' };
        router.replace({ pathname: '/admin-product/[id]', params });
        return;
      }

      const body = editBody(initialValues, values);
      if (Object.keys(body).length === 0) {
        setMessage({ tone: 'success', text: 'Nothing to save: no changes.' });
        return;
      }
      const updated = await updateProduct(productId, body);
      if (!updated.ok) return showFailure(updated.error, 'save the product');
      onSaved?.({ tone: 'success', text: 'Saved.' });
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  async function remove() {
    if (productId === null || deleting) return;
    setDeleting(true);
    const result = await deleteProduct(productId);
    setDeleting(false);
    if (result.ok) {
      // Back to the list, which loads again when it's shown.
      if (router.canGoBack()) router.back();
      else router.replace('/admin');
      return;
    }
    setConfirmingDelete(false);
    showFailure(result.error, 'delete the product');
  }

  return (
    <View style={styles.form}>
      <FormCard title="Basics">
        <TextField label="Name (required)" maxLength={MAX_LENGTHS.name} {...field('name')} />
        <TextField
          label="Barcode (required)"
          keyboardType="number-pad"
          maxLength={14}
          {...field('barcode')}
        />
        <TextField
          label="Size"
          placeholder="184g"
          maxLength={MAX_LENGTHS.size}
          {...field('size')}
        />
      </FormCard>

      <FormCard title="Price">
        <TextField
          label="Price (USD)"
          keyboardType="decimal-pad"
          placeholder="3.49"
          {...field('price')}
        />
      </FormCard>

      <FormCard title="Description and photo">
        <TextField
          label="Description"
          multiline
          maxLength={MAX_LENGTHS.description}
          inputStyle={styles.description}
          {...field('description')}
        />
        <TextField
          label="Photo URL"
          placeholder="https://…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          {...field('imageUrl')}
        />
      </FormCard>

      {productId === null ? (
        <View style={styles.stockForm}>
          <Text style={sharedStyles.sectionTitle}>Stock (optional)</Text>
          <Text style={styles.caption}>
            Automatic follows the MCCS online store. In stock or Out of stock is kept until you set
            it back to Automatic.
          </Text>
          {stock.length === 0 ? <Text style={styles.caption}>No stores yet.</Text> : null}
          {stock.map((row) => (
            <StockChoiceEditor
              key={row.storeId}
              title={row.storeName}
              row={row}
              error={stockErrors[row.storeId]}
              onChange={(change) => changeStock(row.storeId, change)}
            />
          ))}
        </View>
      ) : null}

      {message ? <MessageText message={message} /> : null}
      <Button
        title={productId ? 'Save changes' : 'Add product'}
        variant="action"
        onPress={save}
        loading={saving}
      />

      {productId !== null ? (
        confirmingDelete ? (
          <Card style={styles.confirm}>
            <Text style={styles.confirmText}>
              Delete {initialValues.name}? This removes it from the app and can&apos;t be undone.
            </Text>
            <View style={styles.actions}>
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => setConfirmingDelete(false)}
                disabled={deleting}
                style={styles.action}
              />
              <DangerButton
                title="Confirm delete"
                onPress={remove}
                loading={deleting}
                style={styles.primaryAction}
              />
            </View>
          </Card>
        ) : (
          <DangerButton
            title="Delete product"
            icon="trash-outline"
            onPress={() => setConfirmingDelete(true)}
          />
        )
      ) : null}
    </View>
  );
}

function FormCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={styles.formCard}>
      <Text style={sharedStyles.sectionTitle}>{title}</Text>
      {children}
    </Card>
  );
}

/** A destructive button: red text on a soft red fill. */
function DangerButton({
  title,
  icon,
  loading = false,
  onPress,
  style,
}: {
  title: string;
  icon?: 'trash-outline';
  loading?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: loading }}
      style={({ pressed }) => [styles.danger, pressed && styles.pressed, style]}
    >
      {icon ? <Ionicons name={icon} size={sizes.icon} color={colors.danger} /> : null}
      <Text style={styles.dangerText}>{loading ? 'Deleting…' : title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  body: {
    gap: spacing.md,
  },
  hidden: {
    display: 'none',
  },
  header: {
    gap: spacing.sm,
  },
  headerTop: {
    ...sharedStyles.row,
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  headerName: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  headerPrice: {
    ...textStyles.priceSmall,
    color: colors.textPrimary,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  stockCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  openRow: {
    backgroundColor: colors.surfaceMuted,
  },
  pressed: {
    opacity: 0.7,
  },
  stockSummary: {
    ...sharedStyles.row,
    gap: spacing.md,
    padding: spacing.lg,
  },
  stockText: {
    flex: 1,
    gap: spacing.xxs,
  },
  storeName: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  adminSet: {
    ...textStyles.caption,
    color: colors.accent,
  },
  noRecord: {
    color: colors.textSecondary,
    backgroundColor: colors.surfaceMuted,
  },
  editor: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  segmented: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  segmentSelected: {
    backgroundColor: colors.surface,
  },
  segmentText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  segmentTextOn: {
    color: colors.textPrimary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  quantity: {
    flex: 1,
  },
  step: {
    width: sizes.button,
    height: sizes.button,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepDisabled: {
    opacity: 0.4,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
  primaryAction: {
    flex: 1.4,
  },
  form: {
    gap: spacing.md,
  },
  formCard: {
    gap: spacing.md,
  },
  stockForm: {
    gap: spacing.sm,
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
  confirm: {
    gap: spacing.md,
    backgroundColor: colors.dangerSoft,
  },
  confirmText: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  danger: {
    ...sharedStyles.row,
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: sizes.button,
    borderRadius: radius.lg,
    backgroundColor: colors.dangerSoft,
  },
  dangerText: {
    ...textStyles.label,
    color: colors.danger,
  },
});
