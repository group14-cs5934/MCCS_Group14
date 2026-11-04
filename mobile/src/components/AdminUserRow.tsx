import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { updateUser, type ApiError } from '@/api';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Choices from '@/components/Choices';
import ErrorBanner from '@/components/ErrorBanner';
import Loader from '@/components/Loader';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, spacing, textStyles } from '@/theme';
import type { Store } from '@/types/store';
import type { AdminUserAccount, Role, StoreRole, UserUpdateBody } from '@/types/user';

const ROLE_LABELS: Record<Role, string> = {
  user: 'User',
  staff: 'Staff',
  admin: 'Admin',
};

/** One thing an admin can do to a user, and what they're asked before it's sent. */
type Change = { label: string; body: UserUpdateBody; question: string };

/** Whether they can sign in; their role is changed with the role editor instead. */
function changesFor(user: AdminUserAccount, email: string): Change[] {
  return [
    user.active
      ? {
          label: 'Deactivate',
          body: { active: false },
          question: `Deactivate ${email}? They'll be signed out and won't be able to sign in.`,
        }
      : {
          label: 'Reactivate',
          body: { active: true },
          question: `Reactivate ${email}? They'll be able to sign in again.`,
        },
  ];
}

/**
 * The account type an admin is choosing for someone and, for staff, their store and the role they
 * will have there.
 */
type RoleDraft = {
  role: Role;
  storeId: number | null;
  storeRoleId: number | null;
  storeRoleName: string | null;
};

/** What saving the draft will do, e.g. "Make a@b.com Manager at Quantico MCX?". */
function roleQuestion(draft: RoleDraft, email: string, storeName: string): string {
  switch (draft.role) {
    case 'admin':
      return `Make ${email} an admin? They'll be able to manage products, users and reviews.`;
    case 'staff':
      return `Make ${email} ${draft.storeRoleName} at ${storeName}? They'll get that role's permissions.`;
    default:
      return `Make ${email} a regular user? They'll lose any admin or store access.`;
  }
}

function failureMessage(error: ApiError, email: string): string {
  if (error.code === 'user_not_found') return `${email} no longer exists.`;
  // 409: an admin's own role or account, which the API explains.
  if (error.status === 409 && error.serverMessage) return error.serverMessage;
  return `Couldn't update ${email}. ${error.message}`;
}

type Props = {
  user: AdminUserAccount;
  /** Every store, to name a staff member's store and choose one (GET /locations). */
  stores: Store[];
  /**
   * The signed-in admin's own row. It has no actions, since admins can't remove their own admin
   * role or deactivate themselves (the API refuses with 409).
   */
  isSelf: boolean;
  /** Called with the user as the API returns them after a change. */
  onUpdated: (user: AdminUserAccount) => void;
  /** Called when the API refuses with 403: the signed-in user is no longer an admin. */
  onDenied: () => void;
};

/**
 * A user in the admin area (T097): email, when they joined, their role (and store, for workers and
 * managers) and whether they're deactivated, with buttons to change the role or deactivate or
 * reactivate them. Each change is confirmed first. A deactivated user is signed out of the app and
 * can't sign in again.
 */
export default function AdminUserRow({ user, stores, isSelf, onUpdated, onDenied }: Props) {
  const [confirming, setConfirming] = useState<Change | null>(null);
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set at once (state only changes on the next render), so a quick second tap can't send twice.
  const savingNow = useRef(false);

  const email = user.email ?? 'No email';
  // How the confirm questions and errors name them.
  const name = user.email ?? 'this user';
  const joined = new Date(user.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const storeName = (storeId: number | null | undefined) =>
    stores.find((store) => store.id === storeId)?.name ??
    (storeId ? `store #${storeId}` : 'an unknown store');
  const isStaff = user.role === 'staff';
  const staffRoleName = user.store_role?.name ?? ROLE_LABELS.staff;
  const roleText = isStaff
    ? `${staffRoleName} at ${storeName(user.store_id)}`
    : ROLE_LABELS[user.role];
  const status = [isSelf ? 'You' : null, roleText, user.active ? null : 'Deactivated']
    .filter(Boolean)
    .join(', ');

  function ask(change: Change) {
    setError(null);
    setConfirming(change);
  }

  function editRole() {
    setError(null);
    setDraft({
      role: user.role,
      storeId: user.store_id ?? null,
      storeRoleId: user.store_role?.id ?? null,
      storeRoleName: user.store_role?.name ?? null,
    });
  }

  function saveRole(next: RoleDraft) {
    const body: UserUpdateBody = { role: next.role };
    if (next.role === 'staff' && next.storeRoleId !== null) body.store_role_id = next.storeRoleId;
    apply({ label: 'Save role', body, question: '' });
  }

  async function apply(change: Change) {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    const result = await updateUser(user.id, change.body);
    savingNow.current = false;
    setSaving(false);
    if (!result.ok && result.error.status === 403) return onDenied();
    setConfirming(null);
    setDraft(null);
    if (result.ok) {
      onUpdated(result.data);
    } else {
      setError(failureMessage(result.error, name));
    }
  }

  return (
    <Card style={styles.card}>
      <View
        accessible
        accessibilityLabel={`${email}, ${status}, joined ${joined}`}
        style={styles.summary}
      >
        <View style={styles.userText}>
          <Text style={styles.email} numberOfLines={1}>
            {email}
          </Text>
          <Text style={styles.caption}>Joined {joined}</Text>
          {isStaff ? <Text style={styles.caption}>At {storeName(user.store_id)}</Text> : null}
        </View>
        <View style={styles.badges}>
          {isSelf ? <Badge label="You" tone="accent" /> : null}
          {user.role === 'user' ? null : (
            <Badge label={isStaff ? staffRoleName : ROLE_LABELS[user.role]} tone="accent" />
          )}
          {user.active ? null : <Badge label="Deactivated" tone="danger" />}
        </View>
      </View>

      {isSelf ? null : draft ? (
        <RoleEditor
          email={name}
          draft={draft}
          stores={stores}
          storeName={storeName(draft.storeId)}
          saving={saving}
          unchanged={
            draft.role === user.role &&
            (draft.role !== 'staff' || draft.storeRoleId === (user.store_role?.id ?? null))
          }
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => saveRole(draft)}
        />
      ) : confirming ? (
        <View style={styles.confirm}>
          <Text style={styles.question}>{confirming.question}</Text>
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="text"
              onPress={() => setConfirming(null)}
              disabled={saving}
              style={styles.action}
            />
            <Button
              title={confirming.label}
              variant="secondary"
              onPress={() => apply(confirming)}
              loading={saving}
              accessibilityLabel={`${confirming.label} ${name}`}
              style={styles.action}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            title="Change role"
            variant="text"
            onPress={editRole}
            accessibilityLabel={`Change role of ${name}`}
            style={styles.action}
          />
          {changesFor(user, name).map((change) => (
            <Button
              key={change.label}
              title={change.label}
              variant="text"
              onPress={() => ask(change)}
              // Every row has these buttons, so say whose they are.
              accessibilityLabel={`${change.label} ${name}`}
              style={styles.action}
            />
          ))}
        </View>
      )}

      {error ? <ErrorBanner message={error} /> : null}
    </Card>
  );
}

function RoleEditor({
  email,
  draft,
  stores,
  storeName,
  saving,
  unchanged,
  onChange,
  onCancel,
  onSave,
}: {
  email: string;
  draft: RoleDraft;
  stores: Store[];
  storeName: string;
  saving: boolean;
  unchanged: boolean;
  onChange: (draft: RoleDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const needsRole = draft.role === 'staff';
  const ready = !unchanged && (!needsRole || draft.storeRoleId !== null);
  return (
    <View style={styles.confirm}>
      <Choices
        label={`Account type for ${email}`}
        options={(Object.keys(ROLE_LABELS) as Role[]).map((role) => ({
          key: role,
          label: ROLE_LABELS[role],
        }))}
        selected={draft.role}
        onSelect={(role) => onChange({ ...draft, role })}
      />
      {needsRole ? (
        <Choices
          label={`Store for ${email}`}
          options={stores.map((store) => ({ key: store.id, label: store.name }))}
          selected={draft.storeId}
          // Roles belong to a store, so choosing another store clears the role.
          onSelect={(storeId) =>
            onChange({ ...draft, storeId, storeRoleId: null, storeRoleName: null })
          }
        />
      ) : null}
      {needsRole && draft.storeId !== null ? (
        <StoreRoleChoices
          key={draft.storeId}
          email={email}
          storeId={draft.storeId}
          selected={draft.storeRoleId}
          onSelect={(role) =>
            onChange({ ...draft, storeRoleId: role.id, storeRoleName: role.name })
          }
        />
      ) : null}
      {ready ? (
        <Text style={styles.question}>{roleQuestion(draft, email, storeName)}</Text>
      ) : needsRole && draft.storeId === null ? (
        <Text style={styles.caption}>Choose their store.</Text>
      ) : needsRole && draft.storeRoleId === null ? (
        <Text style={styles.caption}>Choose their role at the store.</Text>
      ) : null}
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
          onPress={onSave}
          loading={saving}
          disabled={!ready}
          accessibilityLabel={`Save role of ${email}`}
          style={styles.action}
        />
      </View>
    </View>
  );
}

/** The roles of the chosen store (GET /staff/stores/{id}/roles, which admins may call). */
function StoreRoleChoices({
  email,
  storeId,
  selected,
  onSelect,
}: {
  email: string;
  storeId: number;
  selected: number | null;
  onSelect: (role: StoreRole) => void;
}) {
  const { loading, data, error, reload } = useApiGet<StoreRole[]>(`/staff/stores/${storeId}/roles`);
  if (loading) return <Loader message="Loading roles…" size="small" />;
  if (error) return <ErrorBanner message={error.message} onRetry={reload} />;
  const roles = data ?? [];
  if (roles.length === 0) return <Text style={styles.caption}>This store has no roles yet.</Text>;
  return (
    <Choices
      label={`Role for ${email}`}
      options={roles.map((role) => ({ key: role.id, label: role.name }))}
      selected={selected}
      onSelect={(id) => onSelect(roles.find((role) => role.id === id)!)}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  userText: {
    flex: 1,
    gap: spacing.xxs,
  },
  email: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  badges: {
    alignItems: 'flex-end',
    gap: spacing.xs,
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
