import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { createStoreRole, deleteStoreRole, updateStoreRole } from '@/api';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import Loader from '@/components/Loader';
import PermissionChecklist from '@/components/PermissionChecklist';
import { changeError, isAccessLost, type OnDenied } from '@/components/storeAccess';
import TextField from '@/components/TextField';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, spacing, textStyles } from '@/theme';
import type { PermissionInfo, StoreRole } from '@/types/user';

/** The longest role name the API accepts. */
const ROLE_NAME_MAX_LENGTH = 50;

type Props = {
  storeId: number;
  onDenied: OnDenied;
};

/**
 * The store's roles with how many people have each: create, edit (name and permission checklist,
 * drawn from GET /staff/permissions) and delete. For people with manage_roles.
 */
export default function StoreRolesSection({ storeId, onDenied }: Props) {
  const roles = useApiGet<StoreRole[]>(`/staff/stores/${storeId}/roles`);
  const permissions = useApiGet<PermissionInfo[]>('/staff/permissions');
  // 'new' for the create form, or the ID of the role being edited.
  const [editing, setEditing] = useState<'new' | number | null>(null);
  const refused = roles.error?.status === 403 ? roles.error.code : null;
  useEffect(() => {
    if (refused !== null) onDenied(refused);
  }, [refused, onDenied]);

  if (refused !== null) return null; // My store shows what they can still do

  const catalog = permissions.data ?? [];
  const labelOf = (key: string) => catalog.find((item) => item.key === key)?.label ?? key;
  const saved = () => {
    setEditing(null);
    roles.reload();
  };

  return (
    <FlatList
      data={roles.loading || roles.error ? [] : (roles.data ?? [])}
      keyExtractor={(role) => String(role.id)}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          {editing === 'new' ? (
            <RoleForm
              storeId={storeId}
              catalog={catalog}
              onSaved={saved}
              onCancel={() => setEditing(null)}
              onDenied={onDenied}
            />
          ) : (
            <Button
              title="New role"
              variant="secondary"
              icon="add-outline"
              onPress={() => setEditing('new')}
            />
          )}
          {roles.loading || permissions.loading ? (
            <Loader message="Loading roles…" size="small" />
          ) : null}
          {roles.error ? (
            <ErrorBanner message={roles.error.message} onRetry={roles.reload} />
          ) : null}
          {permissions.error ? (
            <ErrorBanner message={permissions.error.message} onRetry={permissions.reload} />
          ) : null}
        </View>
      }
      renderItem={({ item }) =>
        editing === item.id ? (
          <RoleForm
            storeId={storeId}
            role={item}
            catalog={catalog}
            onSaved={saved}
            onCancel={() => setEditing(null)}
            onDenied={onDenied}
          />
        ) : (
          <RoleRow
            storeId={storeId}
            role={item}
            labelOf={labelOf}
            onEdit={() => setEditing(item.id)}
            onDeleted={roles.reload}
            onDenied={onDenied}
          />
        )
      }
    />
  );
}

function RoleRow({
  storeId,
  role,
  labelOf,
  onEdit,
  onDeleted,
  onDenied,
}: {
  storeId: number;
  role: StoreRole;
  labelOf: (key: string) => string;
  onEdit: () => void;
  onDeleted: () => void;
  onDenied: OnDenied;
}) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingNow = useRef(false);
  const members = `${role.member_count} ${role.member_count === 1 ? 'person' : 'people'}`;

  async function remove() {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setError(null);
    const result = await deleteStoreRole(storeId, role.id);
    savingNow.current = false;
    setSaving(false);
    // Already gone (deleted elsewhere) is as good as deleted.
    if (result.ok || result.error.code === 'store_role_not_found') return onDeleted();
    if (isAccessLost(result.error)) return onDenied(result.error.code);
    setConfirming(false);
    setError(changeError(result.error, `Couldn't delete ${role.name}.`));
  }

  return (
    <Card style={styles.card}>
      <View accessible accessibilityLabel={`${role.name}, ${members}`}>
        <Text style={styles.name}>{role.name}</Text>
        <Text style={styles.caption}>{members}</Text>
      </View>
      <Text style={styles.caption}>
        {role.permissions.length > 0
          ? role.permissions.map(labelOf).join(', ')
          : 'No permissions yet.'}
      </Text>
      {confirming ? (
        <View style={styles.confirm}>
          <Text style={styles.question}>Delete the {role.name} role?</Text>
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="text"
              onPress={() => setConfirming(false)}
              disabled={saving}
              style={styles.action}
            />
            <Button
              title="Delete"
              variant="secondary"
              onPress={remove}
              loading={saving}
              accessibilityLabel={`Delete ${role.name}`}
              style={styles.action}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            title="Edit"
            variant="text"
            onPress={onEdit}
            accessibilityLabel={`Edit ${role.name}`}
            style={styles.action}
          />
          <Button
            title="Delete"
            variant="text"
            onPress={() => {
              setError(null);
              setConfirming(true);
            }}
            accessibilityLabel={`Delete ${role.name}`}
            style={styles.action}
          />
        </View>
      )}
      {error ? <ErrorBanner message={error} /> : null}
    </Card>
  );
}

/** Name and permission checklist, to create a role or (with `role`) change one. */
function RoleForm({
  storeId,
  role,
  catalog,
  onSaved,
  onCancel,
  onDenied,
}: {
  storeId: number;
  role?: StoreRole;
  catalog: PermissionInfo[];
  onSaved: () => void;
  onCancel: () => void;
  onDenied: OnDenied;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingNow = useRef(false);

  const toggle = (key: string) =>
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

  async function save() {
    const typed = name.trim();
    if (savingNow.current) return;
    if (!typed) {
      setError('Enter a name for the role.');
      return;
    }
    savingNow.current = true;
    setSaving(true);
    setError(null);
    const body = { name: typed, permissions: selected };
    const result = role
      ? await updateStoreRole(storeId, role.id, body)
      : await createStoreRole(storeId, body);
    savingNow.current = false;
    setSaving(false);
    if (result.ok) return onSaved();
    if (isAccessLost(result.error)) return onDenied(result.error.code);
    setError(changeError(result.error, `Couldn't save the role.`));
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.name}>{role ? `Edit ${role.name}` : 'New role'}</Text>
      <TextField
        label="Role name"
        value={name}
        onChangeText={setName}
        maxLength={ROLE_NAME_MAX_LENGTH}
        autoCapitalize="words"
      />
      <Text style={styles.caption}>What this role allows</Text>
      <PermissionChecklist permissions={catalog} selected={selected} onToggle={toggle} />
      {error ? <ErrorBanner message={error} /> : null}
      <View style={styles.actions}>
        <Button
          title="Cancel"
          variant="text"
          onPress={onCancel}
          disabled={saving}
          style={styles.action}
        />
        <Button
          title="Save role"
          variant="secondary"
          onPress={save}
          loading={saving}
          accessibilityLabel={role ? `Save ${role.name}` : 'Save new role'}
          style={styles.action}
        />
      </View>
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
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
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
