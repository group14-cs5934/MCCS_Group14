import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { updateStoreInfo } from '@/api';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import { changeError, isAccessLost, type OnDenied } from '@/components/storeAccess';
import TextField from '@/components/TextField';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';
import type { Store } from '@/types/store';

type Props = {
  store: Store;
  /** Called with the store as the API returns it after a change. */
  onSaved: (store: Store) => void;
  onDenied: OnDenied;
};

/** The store's address and hours, for people with edit_store_info. */
export default function StoreInfoSection({ store, onSaved, onDenied }: Props) {
  const [address, setAddress] = useState(store.address ?? '');
  const [hours, setHours] = useState(store.hours ?? '');
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);

  async function save() {
    if (savingNow.current) return;
    // Only what changed is sent.
    const body: { address?: string; hours?: string } = {};
    if (address.trim() !== (store.address ?? '')) body.address = address.trim();
    if (hours.trim() !== (store.hours ?? '')) body.hours = hours.trim();
    if (Object.keys(body).length === 0) {
      setMessage({ tone: 'error', text: 'Change the address or hours first.' });
      return;
    }
    if (body.address === '' || body.hours === '') {
      setMessage({ tone: 'error', text: 'The address and hours can’t be empty.' });
      return;
    }
    savingNow.current = true;
    setSaving(true);
    setMessage(null);
    const result = await updateStoreInfo(store.id, body);
    savingNow.current = false;
    setSaving(false);
    if (result.ok) {
      setMessage({ tone: 'success', text: 'Store info saved.' });
      onSaved(result.data);
    } else if (isAccessLost(result.error)) {
      onDenied(result.error.code);
    } else {
      setMessage({ tone: 'error', text: changeError(result.error, "Couldn't save.") });
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card style={styles.card}>
        <Text style={styles.name}>Store info</Text>
        <Text style={styles.caption}>Shown to shoppers on the store&apos;s page.</Text>
        <TextField label="Address" value={address} onChangeText={setAddress} />
        <TextField
          label="Hours"
          value={hours}
          onChangeText={setHours}
          placeholder="e.g. Mon–Sat 9 AM–9 PM"
        />
        {message ? (
          message.tone === 'error' ? (
            <ErrorBanner message={message.text} />
          ) : (
            <Text style={styles.success} accessibilityLiveRegion="polite">
              {message.text}
            </Text>
          )
        ) : null}
        <Button title="Save store info" onPress={save} loading={saving} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    ...sharedStyles.screenContent,
  },
  card: {
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
  success: {
    ...textStyles.body,
    color: colors.success,
  },
});
