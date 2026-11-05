import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ApiError, ApiResult, StoreBody } from '@/api';
import Button from '@/components/Button';
import ErrorBanner from '@/components/ErrorBanner';
import TextField from '@/components/TextField';
import { spacing } from '@/theme';
import type { Store } from '@/types/store';

type Props = {
  /** The store being edited; leave out to add one. */
  store?: Store;
  submitLabel: string;
  /** Sends the body; for an edit it holds only what changed. */
  onSubmit: (body: StoreBody) => Promise<ApiResult<Store>>;
  onSaved: (store: Store) => void;
  /** Shown as a Cancel button when given. */
  onCancel?: () => void;
};

type Field = 'name' | 'slug' | 'address' | 'hours';
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: Field[] = ['name', 'slug', 'address', 'hours'];

/** Puts a failed save's problems on the fields they belong to; the rest go in a banner. */
function readErrors(error: ApiError): { fields: FieldErrors; banner: string | null } {
  if (error.status === 409 && error.code === 'slug_taken') {
    return {
      fields: { slug: 'Another store already has this slug. Try a different one.' },
      banner: null,
    };
  }
  const fields: FieldErrors = {};
  for (const detail of error.status === 422 ? (error.details ?? []) : []) {
    const field = FIELDS.find((name) => name === detail.loc[1]);
    if (field && !fields[field]) fields[field] = detail.msg;
  }
  if (Object.keys(fields).length > 0) return { fields, banner: null };
  return { fields, banner: `Couldn't save the store. ${error.serverMessage ?? error.message}` };
}

/** Name, slug, address and hours of a store, for admins adding or editing one. */
export default function StoreForm({ store, submitLabel, onSubmit, onSaved, onCancel }: Props) {
  const [name, setName] = useState(store?.name ?? '');
  const [slug, setSlug] = useState(store?.slug ?? '');
  const [address, setAddress] = useState(store?.address ?? '');
  const [hours, setHours] = useState(store?.hours ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);

  async function save() {
    if (savingNow.current) return;
    if (!name.trim()) {
      setErrors({ name: 'Enter the store’s name.' });
      setBanner(null);
      return;
    }
    // An edit sends only what changed; a blank address or hours clears it.
    const body: StoreBody = {};
    if (name.trim() !== store?.name) body.name = name.trim();
    if (slug.trim() && slug.trim() !== store?.slug) body.slug = slug.trim();
    if (address.trim() !== (store?.address ?? '')) body.address = address.trim() || null;
    if (hours.trim() !== (store?.hours ?? '')) body.hours = hours.trim() || null;
    if (store && Object.keys(body).length === 0) {
      setErrors({});
      setBanner('Change something first.');
      return;
    }
    savingNow.current = true;
    setSaving(true);
    setErrors({});
    setBanner(null);
    const result = await onSubmit(body);
    savingNow.current = false;
    setSaving(false);
    if (result.ok) {
      onSaved(result.data);
      return;
    }
    const failure = readErrors(result.error);
    setErrors(failure.fields);
    setBanner(failure.banner);
  }

  return (
    <View style={styles.form}>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Camp Lejeune MCX"
        error={errors.name}
      />
      <TextField
        label="Slug"
        value={slug}
        onChangeText={setSlug}
        placeholder={store ? undefined : 'Made from the name if left blank'}
        autoCapitalize="none"
        autoCorrect={false}
        error={errors.slug}
      />
      <TextField
        label="Address"
        value={address}
        onChangeText={setAddress}
        placeholder="Optional"
        error={errors.address}
      />
      <TextField
        label="Hours"
        value={hours}
        onChangeText={setHours}
        placeholder="e.g. Mon–Sat 9 AM–9 PM"
        error={errors.hours}
      />
      {banner ? <ErrorBanner message={banner} /> : null}
      <Button title={submitLabel} onPress={save} loading={saving} />
      {onCancel ? <Button title="Cancel" variant="secondary" onPress={onCancel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
});
