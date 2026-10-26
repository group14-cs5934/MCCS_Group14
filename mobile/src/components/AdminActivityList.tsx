import { FlatList, StyleSheet, Text, View } from 'react-native';

import Card from '@/components/Card';
import { colors, spacing, textStyles } from '@/theme';
import type { AuditLogEntry } from '@/types/audit';

/** How many changed fields a row lists before "and N more". */
const MAX_FIELDS_SHOWN = 3;

/** Longest a value is shown before it's cut off with "…". */
const MAX_VALUE_LENGTH = 40;

const verbs: Record<string, string> = {
  'product.create': 'added',
  'product.update': 'edited',
  'product.delete': 'deleted',
  'user.update': 'changed',
  'review.hide': 'hid',
  'review.show': 'showed',
  'review.delete': 'deleted',
};

const fieldLabels: Record<string, string> = {
  image_url: 'Photo',
  category_id: 'Category',
  brand_id: 'Brand',
  product_id: 'Product',
  author_email: 'Author',
  active: 'Active',
  prices: 'Prices',
  ratings: 'Ratings',
  reviews: 'Reviews',
};

type Props = {
  entries: AuditLogEntry[];
  /** Called when a change to a product that still exists is tapped, e.g. to open its page. */
  onOpenProduct: (productId: number) => void;
};

/** The admin audit log: one card per change, newest first. */
export default function AdminActivityList({ entries, onOpenProduct }: Props) {
  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => String(entry.id)}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => <ActivityRow entry={item} onOpenProduct={onOpenProduct} />}
    />
  );
}

function ActivityRow({
  entry,
  onOpenProduct,
}: {
  entry: AuditLogEntry;
  onOpenProduct: (productId: number) => void;
}) {
  const summary = summarize(entry);
  const lines = changeLines(entry);
  const shown = lines.slice(0, MAX_FIELDS_SHOWN);
  const hidden = lines.length - shown.length;
  const when = new Date(entry.created_at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  // A deleted product has no page to open.
  const opensProduct = entry.target_type === 'product' && entry.action !== 'product.delete';
  const label = [summary, ...lines, when].join(', ');

  return (
    <Card
      onPress={opensProduct ? () => onOpenProduct(Number(entry.target_id)) : undefined}
      accessibilityLabel={label}
    >
      <View accessible={!opensProduct} accessibilityLabel={label} style={styles.row}>
        <Text style={styles.summary}>{summary}</Text>
        {shown.map((line) => (
          <Text key={line} style={styles.change} numberOfLines={2}>
            {line}
          </Text>
        ))}
        {hidden > 0 ? (
          <Text style={styles.change}>
            and {hidden} more {hidden === 1 ? 'change' : 'changes'}
          </Text>
        ) : null}
        {lines.length === 0 ? <Text style={styles.change}>Nothing changed</Text> : null}
        <Text style={styles.when}>{when}</Text>
      </View>
    </Card>
  );
}

/** e.g. "admin@example.com edited product #7". */
function summarize(entry: AuditLogEntry): string {
  const who = entry.admin_email ?? 'A deleted admin';
  const verb = verbs[entry.action] ?? entry.action;
  const what =
    entry.target_type === 'user'
      ? `user ${entry.target_id.slice(0, 8)}`
      : `${entry.target_type} #${entry.target_id}`;
  return `${who} ${verb} ${what}`;
}

/** One line per changed field, e.g. "Price: $2.49 → $2.99", or "Name: Coke" when added. */
function changeLines(entry: AuditLogEntry): string[] {
  const created = entry.action.endsWith('.create');
  const deleted = entry.action.endsWith('.delete');
  return Object.entries(entry.changes).map(([field, { from, to }]) => {
    const label = fieldLabels[field] ?? capitalize(field);
    if (created) return `${label}: ${formatValue(field, to)}`;
    // What was deleted; counts (e.g. ratings removed with a product) read as "Ratings: 3".
    if (deleted) return `${label}: ${formatValue(field, from)}`;
    return `${label}: ${formatValue(field, from)} → ${formatValue(field, to)}`;
  });
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (field === 'price') return `$${value}`;
  const text = String(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : text;
}

function capitalize(field: string): string {
  const words = field.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  row: {
    gap: spacing.xxs,
  },
  summary: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  change: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  when: {
    ...textStyles.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
