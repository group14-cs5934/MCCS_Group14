import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { updateUser, type ApiError } from '@/api';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import { colors, radius, spacing, textStyles } from '@/theme';
import type { Store } from '@/types/store';
import { STAFF_ROLES, type AdminUserAccount, type Role, type UserUpdateBody } from '@/types/user';

const ROLE_LABELS: Record<Role, string> = {
  user: 'User',
  worker: 'Worker',
  manager: 'Manager',
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

/** The role an admin is choosing for someone, and (for workers and managers) their store. */
type RoleDraft = { role: Role; storeId: number | null };

/** What saving the draft will do, e.g. "Make a@b.com a worker at Quantico MCX?". */
function roleQuestion(draft: RoleDraft, email: string, storeName: string): string {
  switch (draft.role) {
    case 'admin':
      return `Make ${email} an admin? They'll be able to manage products, users and reviews.`;
    case 'manager':
      return `Make ${email} a manager at ${storeName}? They'll edit its stock and add or remove its workers.`;
    case 'worker':
      return `Make ${email} a worker at ${storeName}? They'll edit its stock.`;
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
  const isStaff = STAFF_ROLES.includes(user.role);
  const roleText = isStaff
    ? `${ROLE_LABELS[user.role]} at ${storeName(user.store_id)}`
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
    setDraft({ role: user.role, storeId: user.store_id ?? null });
  }

  function saveRole(next: RoleDraft) {
    const body: UserUpdateBody = { role: next.role };
    if (STAFF_ROLES.includes(next.role) && next.storeId !== null) body.store_id = next.storeId;
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
          {user.role === 'user' ? null : <Badge label={ROLE_LABELS[user.role]} tone="accent" />}
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
          unchanged={draft.role === user.role && draft.storeId === (user.store_id ?? null)}
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
  const needsStore = STAFF_ROLES.includes(draft.role);
  const ready = !unchanged && (!needsStore || draft.storeId !== null);
  return (
    <View style={styles.confirm}>
      <Choices
        label={`Role for ${email}`}
        options={(Object.keys(ROLE_LABELS) as Role[]).map((role) => ({
          key: role,
          label: ROLE_LABELS[role],
        }))}
        selected={draft.role}
        onSelect={(role) => onChange({ ...draft, role })}
      />
      {needsStore ? (
        <Choices
          label={`Store for ${email}`}
          options={stores.map((store) => ({ key: store.id, label: store.name }))}
          selected={draft.storeId}
          onSelect={(storeId) => onChange({ ...draft, storeId })}
        />
      ) : null}
      {ready ? (
        <Text style={styles.question}>{roleQuestion(draft, email, storeName)}</Text>
      ) : needsStore && draft.storeId === null ? (
        <Text style={styles.caption}>Choose their store.</Text>
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

/** A labelled row of options with one chosen, e.g. the roles. */
function Choices<T extends string | number>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { key: T; label: string }[];
  selected: T | null;
  onSelect: (key: T) => void;
}) {
  return (
    <View style={styles.choiceGroup}>
      <Text style={styles.caption}>{label}</Text>
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const isSelected = option.key === selected;
          return (
            <Pressable
              key={option.key}
              onPress={() => onSelect(option.key)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: isSelected }}
              style={[styles.choice, isSelected && styles.choiceSelected]}
            >
              <Text style={[styles.choiceText, isSelected && styles.choiceTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
  choiceGroup: {
    gap: spacing.xs,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  choice: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choiceSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  choiceText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  choiceTextSelected: {
    color: colors.accent,
  },
});
