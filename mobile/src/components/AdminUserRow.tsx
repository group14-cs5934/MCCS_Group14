import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { updateUser, type ApiError } from '@/api';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorBanner from '@/components/ErrorBanner';
import { colors, radius, spacing, textStyles } from '@/theme';
import type { AdminUserAccount, UserUpdateBody } from '@/types/user';

/** One thing an admin can do to a user, and what they're asked before it's sent. */
type Change = { label: string; body: UserUpdateBody; question: string };

/** What an admin can change about this user: their role, and whether they can sign in. */
function changesFor(user: AdminUserAccount, email: string): Change[] {
  return [
    user.role === 'admin'
      ? {
          label: 'Remove admin',
          body: { role: 'user' },
          question: `Remove ${email}'s admin role? They won't be able to open the admin area.`,
        }
      : {
          label: 'Make admin',
          body: { role: 'admin' },
          question: `Make ${email} an admin? They'll be able to manage products, users and reviews.`,
        },
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

function failureMessage(error: ApiError, email: string): string {
  if (error.code === 'user_not_found') return `${email} no longer exists.`;
  // 409: an admin's own role or account, which the API explains.
  if (error.status === 409 && error.serverMessage) return error.serverMessage;
  return `Couldn't update ${email}. ${error.message}`;
}

type Props = {
  user: AdminUserAccount;
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
 * A user in the admin area (T097): email, when they joined, their role and whether they're
 * deactivated, with buttons to change the role or deactivate/reactivate them. Each change is
 * confirmed first. A deactivated user is signed out of the app and can't sign in again.
 */
export default function AdminUserRow({ user, isSelf, onUpdated, onDenied }: Props) {
  const [confirming, setConfirming] = useState<Change | null>(null);
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
  const status = [
    isSelf ? 'You' : null,
    user.role === 'admin' ? 'Admin' : 'User',
    user.active ? null : 'Deactivated',
  ]
    .filter(Boolean)
    .join(', ');

  function ask(change: Change) {
    setError(null);
    setConfirming(change);
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
        </View>
        <View style={styles.badges}>
          {isSelf ? <Badge label="You" tone="accent" /> : null}
          {user.role === 'admin' ? <Badge label="Admin" tone="accent" /> : null}
          {user.active ? null : <Badge label="Deactivated" tone="danger" />}
        </View>
      </View>

      {isSelf ? null : confirming ? (
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

function Badge({ label, tone }: { label: string; tone: 'accent' | 'danger' }) {
  return (
    <Text style={[styles.badge, tone === 'accent' ? styles.badgeAccent : styles.badgeDanger]}>
      {label}
    </Text>
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
  badge: {
    ...textStyles.caption,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  badgeAccent: {
    color: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  badgeDanger: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
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
