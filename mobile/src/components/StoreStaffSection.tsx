import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { addStaff, changeStaffRole, removeStaff, type ApiResult } from '@/api';
import { useAuth } from '@/auth';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Choices from '@/components/Choices';
import ErrorBanner from '@/components/ErrorBanner';
import Loader from '@/components/Loader';
import { changeError, isAccessLost, type OnDenied } from '@/components/storeAccess';
import TextField from '@/components/TextField';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';
import { PERMISSIONS, type AdminUserAccount, type StoreRole } from '@/types/user';

type Props = {
  storeId: number;
  storeName: string;
  onDenied: OnDenied;
};

/**
 * The store's staff with their role names. Anyone who can see staff gets the list; with
 * manage_staff they can also add people by email with a role, change a person's role, and remove
 * them.
 */
export default function StoreStaffSection({ storeId, storeName, onDenied }: Props) {
  const { user, can } = useAuth();
  const canManage = can(PERMISSIONS.manageStaff);
  const staff = useApiGet<AdminUserAccount[]>(`/staff/stores/${storeId}/staff`);
  const roles = useApiGet<StoreRole[]>(`/staff/stores/${storeId}/roles`);
  const refused = staff.error?.status === 403 ? staff.error.code : null;
  useEffect(() => {
    if (refused !== null) onDenied(refused);
  }, [refused, onDenied]);

  if (refused !== null) return null; // My store shows what they can still do

  return (
    <FlatList
      data={staff.loading || staff.error ? [] : (staff.data ?? [])}
      keyExtractor={(person) => person.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          {canManage ? (
            <AddStaff
              storeId={storeId}
              roles={roles.data ?? []}
              rolesError={roles.error?.message}
              onAdded={staff.reload}
              onDenied={onDenied}
            />
          ) : null}
          {staff.loading ? <Loader message="Loading staff…" size="small" /> : null}
          {staff.error ? (
            <ErrorBanner message={staff.error.message} onRetry={staff.reload} />
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <StaffRow
          storeId={storeId}
          storeName={storeName}
          person={item}
          roles={roles.data ?? []}
          isSelf={item.id === user?.id}
          canManage={canManage && item.id !== user?.id}
          onChanged={staff.reload}
          onDenied={onDenied}
        />
      )}
    />
  );
}

/** Email and role for someone who signed up in the app but isn't staff yet. */
function AddStaff({
  storeId,
  roles,
  rolesError,
  onAdded,
  onDenied,
}: {
  storeId: number;
  roles: StoreRole[];
  rolesError?: string;
  onAdded: () => void;
  onDenied: OnDenied;
}) {
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);

  async function add() {
    const typed = email.trim();
    const role = roles.find((item) => item.id === roleId);
    if (savingNow.current) return;
    if (!typed) {
      setMessage({ tone: 'error', text: 'Enter the email they signed up with.' });
      return;
    }
    if (!role) {
      setMessage({ tone: 'error', text: 'Choose their role.' });
      return;
    }
    savingNow.current = true;
    setSaving(true);
    setMessage(null);
    const result = await addStaff(storeId, typed, role.id);
    savingNow.current = false;
    setSaving(false);
    if (result.ok) {
      setEmail('');
      setRoleId(null);
      setMessage({
        tone: 'success',
        text: `${result.data.email ?? typed} was added as ${role.name}.`,
      });
      onAdded();
    } else if (isAccessLost(result.error)) {
      onDenied(result.error.code);
    } else {
      setMessage({ tone: 'error', text: changeError(result.error, "Couldn't add them.") });
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.name}>Add a staff member</Text>
      <Text style={styles.caption}>
        They sign up in the app first, then you add them by their email.
      </Text>
      <TextField
        label="Their email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        onSubmitEditing={add}
      />
      {rolesError ? <ErrorBanner message={rolesError} /> : null}
      <Choices
        label="Their role"
        options={roles.map((role) => ({ key: role.id, label: role.name }))}
        selected={roleId}
        onSelect={setRoleId}
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
      <Button title="Add staff member" onPress={add} loading={saving} />
    </Card>
  );
}

function StaffRow({
  storeId,
  storeName,
  person,
  roles,
  isSelf,
  canManage,
  onChanged,
  onDenied,
}: {
  storeId: number;
  storeName: string;
  person: AdminUserAccount;
  roles: StoreRole[];
  isSelf: boolean;
  canManage: boolean;
  onChanged: () => void;
  onDenied: OnDenied;
}) {
  const [mode, setMode] = useState<'view' | 'removing' | 'changing'>('view');
  const [newRoleId, setNewRoleId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingNow = useRef(false);
  const email = person.email ?? 'No email';
  const roleName = person.store_role?.name ?? 'Staff';

  /** Runs a change; on success the list loads again, otherwise says why it failed. */
  async function run(call: () => Promise<ApiResult<unknown>>, failure: string) {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setError(null);
    const result = await call();
    savingNow.current = false;
    setSaving(false);
    // Already gone (removed elsewhere) is as good as removed.
    if (result.ok || result.error.code === 'staff_not_found') {
      setMode('view');
      return onChanged();
    }
    if (isAccessLost(result.error)) return onDenied(result.error.code);
    setMode('view');
    setError(changeError(result.error, failure));
  }

  return (
    <Card style={styles.card}>
      <View
        style={styles.summary}
        accessible
        accessibilityLabel={`${email}, ${isSelf ? 'you, ' : ''}${roleName}`}
      >
        <Text style={[styles.name, styles.grow]} numberOfLines={1}>
          {email}
        </Text>
        {isSelf ? <Badge label="You" tone="accent" /> : null}
        <Badge label={roleName} tone="accent" />
      </View>
      {canManage && mode === 'removing' ? (
        <View style={styles.confirm}>
          <Text style={styles.question}>
            Remove {email} from {storeName}? They&apos;ll become a regular user.
          </Text>
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="text"
              onPress={() => setMode('view')}
              disabled={saving}
              style={styles.action}
            />
            <Button
              title="Remove"
              variant="secondary"
              onPress={() =>
                run(() => removeStaff(storeId, person.id), `Couldn't remove ${email}.`)
              }
              loading={saving}
              accessibilityLabel={`Remove ${email}`}
              style={styles.action}
            />
          </View>
        </View>
      ) : canManage && mode === 'changing' ? (
        <View style={styles.confirm}>
          <Choices
            label={`New role for ${email}`}
            options={roles.map((role) => ({ key: role.id, label: role.name }))}
            selected={newRoleId}
            onSelect={setNewRoleId}
          />
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="text"
              onPress={() => setMode('view')}
              disabled={saving}
              style={styles.action}
            />
            <Button
              title="Save role"
              variant="secondary"
              onPress={() =>
                run(
                  () => changeStaffRole(storeId, person.id, newRoleId!),
                  `Couldn't change the role of ${email}.`,
                )
              }
              disabled={newRoleId === null || newRoleId === person.store_role?.id}
              loading={saving}
              accessibilityLabel={`Save role of ${email}`}
              style={styles.action}
            />
          </View>
        </View>
      ) : canManage ? (
        <View style={styles.actions}>
          <Button
            title="Change role"
            variant="text"
            onPress={() => {
              setError(null);
              setNewRoleId(person.store_role?.id ?? null);
              setMode('changing');
            }}
            accessibilityLabel={`Change role of ${email}`}
            style={styles.action}
          />
          <Button
            title="Remove"
            variant="text"
            onPress={() => {
              setError(null);
              setMode('removing');
            }}
            accessibilityLabel={`Remove ${email}`}
            style={styles.action}
          />
        </View>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
    padding: spacing.xl,
  },
  header: {
    gap: spacing.md,
  },
  card: {
    gap: spacing.sm,
  },
  name: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  grow: {
    flex: 1,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  success: {
    ...textStyles.body,
    color: colors.success,
  },
  summary: {
    ...sharedStyles.row,
    gap: spacing.sm,
  },
  confirm: {
    gap: spacing.xs,
  },
  question: {
    ...textStyles.body,
    color: colors.textPrimary,
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
