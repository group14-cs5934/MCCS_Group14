import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccessDenied } from '@/components/AdminGate';
import { formatWhen, summarize } from '@/components/AdminActivityList';
import ErrorBanner from '@/components/ErrorBanner';
import { useApiGet } from '@/hooks/useApiGet';
import { colors, radius, sharedStyles, sizes, spacing, textStyles } from '@/theme';
import type { AuditLogEntry } from '@/types/audit';
import type { AdminOverview } from '@/types/insights';

/** The parts of the admin area the Manage list opens. */
export type AdminSection = 'products' | 'users' | 'reviews' | 'stores' | 'activity';

/** How many audit entries Recent activity shows. */
const RECENT_COUNT = 3;

const manage: {
  key: AdminSection;
  title: string;
  detail: string;
  letter: string;
  fg: string;
  bg: string;
}[] = [
  {
    key: 'products',
    title: 'Products',
    detail: 'Add, edit and set stock',
    letter: 'P',
    fg: colors.actionPressed,
    bg: colors.actionSoft,
  },
  {
    key: 'users',
    title: 'Users',
    detail: 'Roles, stores and access',
    letter: 'U',
    fg: colors.accent,
    bg: colors.accentSoft,
  },
  {
    key: 'reviews',
    title: 'Reviews',
    detail: 'Hide or remove reviews',
    letter: 'R',
    fg: colors.warning,
    bg: colors.warningSoft,
  },
  {
    key: 'stores',
    title: 'Stores',
    detail: 'Locations, hours and staff',
    letter: 'S',
    fg: colors.success,
    bg: colors.successSoft,
  },
  {
    key: 'activity',
    title: 'Activity',
    detail: 'Every change, who made it',
    letter: 'A',
    fg: colors.info,
    bg: colors.infoSoft,
  },
];

const dotColors: Record<string, string> = {
  review: colors.warning,
  user: colors.info,
  product: colors.accent,
};

type Props = {
  onOpen: (section: AdminSection) => void;
  /** Opens the store tools (/my-store). */
  onStoreTools: () => void;
};

/**
 * Admin's landing view: a navy band with the counts across every store, the list of areas to
 * manage, and the latest few changes.
 */
export default function AdminHome({ onOpen, onStoreTools }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const overview = useApiGet<AdminOverview>('/admin/overview');
  const recent = useApiGet<AuditLogEntry[]>(`/admin/audit-log?limit=${RECENT_COUNT}`);

  if (overview.error?.status === 403 || recent.error?.status === 403) return <AccessDenied />;

  const stats = overview.data;
  const value = (n: number | undefined) => (n === undefined ? '–' : String(n));
  const tiles = [
    { label: 'Products', value: value(stats?.products), highlight: false },
    {
      label: stats ? `Users · ${stats.staff} staff` : 'Users',
      value: value(stats?.users),
      highlight: false,
    },
    { label: 'New reviews today', value: value(stats?.reviews_today), highlight: true },
    { label: 'Out of stock, all stores', value: value(stats?.out_of_stock), highlight: true },
  ];
  const entries = recent.data ?? [];

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={styles.content}>
      <View style={[sharedStyles.headerBand, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.titleRow}>
          {/* The stack header is hidden here, so this is the way back to the shopper side. */}
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
            accessibilityLabel="Leave admin"
            hitSlop={spacing.sm}
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={sizes.iconLarge} color={colors.textOnHeader} />
          </Pressable>
          <View style={styles.logo}>
            <Ionicons name="shield-checkmark" size={sizes.icon} color={colors.textOnPrimary} />
          </View>
          <View style={styles.titleText}>
            <Text style={styles.title}>Admin</Text>
            <Text style={styles.subtitle}>Recon · all stores</Text>
          </View>
          <Pressable
            onPress={onStoreTools}
            accessibilityRole="button"
            accessibilityLabel="Store tools"
            style={styles.pill}
          >
            <Ionicons name="storefront-outline" size={16} color={colors.textOnHeader} />
            <Text style={styles.pillText}>Store tools</Text>
          </Pressable>
        </View>
        <View style={styles.tiles}>
          {tiles.map((tile) => (
            <View
              key={tile.label}
              accessible
              accessibilityLabel={`${tile.label}: ${tile.value}`}
              style={styles.tile}
            >
              <Text style={[styles.tileValue, tile.highlight && styles.tileValueHighlight]}>
                {tile.value}
              </Text>
              <Text style={styles.tileLabel}>{tile.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.body}>
        {overview.error ? (
          <ErrorBanner message={overview.error.message} onRetry={overview.reload} />
        ) : null}

        <View style={styles.manage}>
          {manage.map((item, index) => (
            <Pressable
              key={item.key}
              onPress={() => onOpen(item.key)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.detail}`}
              style={[styles.manageRow, index > 0 && styles.manageDivider]}
            >
              <View style={[styles.letter, { backgroundColor: item.bg }]}>
                <Text style={[styles.letterText, { color: item.fg }]}>{item.letter}</Text>
              </View>
              <View style={styles.manageText}>
                <Text style={styles.manageTitle}>{item.title}</Text>
                <Text style={styles.manageDetail}>{item.detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>

        <View style={styles.recent}>
          <View style={styles.recentHeader}>
            <Text style={sharedStyles.sectionTitle}>Recent activity</Text>
            <Pressable
              onPress={() => onOpen('activity')}
              accessibilityRole="button"
              accessibilityLabel="See all activity"
              hitSlop={spacing.sm}
            >
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>
          {recent.error ? (
            <ErrorBanner message={recent.error.message} onRetry={recent.reload} />
          ) : null}
          {!recent.loading && !recent.error && entries.length === 0 ? (
            <Text style={styles.manageDetail}>No changes yet.</Text>
          ) : null}
          {entries.map((entry) => (
            <View key={entry.id} style={styles.entry}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: dotColors[entry.target_type] ?? colors.textMuted },
                ]}
              />
              <View style={styles.entryText}>
                <Text style={styles.entrySummary}>{summarize(entry)}</Text>
                <Text style={styles.manageDetail}>{formatWhen(entry.created_at)}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xl,
  },
  titleRow: {
    ...sharedStyles.row,
    gap: spacing.md,
  },
  back: {
    width: sizes.avatar,
    height: sizes.avatar,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.headerChip,
  },
  logo: {
    width: sizes.avatar,
    height: sizes.avatar,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.action,
  },
  titleText: {
    flex: 1,
  },
  title: {
    ...textStyles.heading,
    color: colors.textOnHeader,
  },
  subtitle: {
    ...textStyles.caption,
    color: colors.textOnHeaderMuted,
  },
  pill: {
    ...sharedStyles.row,
    gap: spacing.xs,
    height: sizes.avatar,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.headerChip,
  },
  pillText: {
    ...textStyles.caption,
    fontFamily: textStyles.label.fontFamily,
    color: colors.textOnHeader,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    // Two to a row, minus half the gap each.
    flexBasis: '47%',
    flexGrow: 1,
    padding: spacing.md,
    gap: spacing.xxs,
    borderRadius: radius.lg,
    backgroundColor: colors.headerChip,
  },
  tileValue: {
    ...textStyles.price,
    color: colors.textOnHeader,
  },
  tileValueHighlight: {
    color: colors.avatar,
  },
  tileLabel: {
    ...textStyles.caption,
    color: colors.textOnHeaderMuted,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  manage: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  manageRow: {
    ...sharedStyles.row,
    gap: spacing.md,
    minHeight: sizes.actionButton,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  manageDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  letter: {
    width: sizes.thumbSmall,
    height: sizes.thumbSmall,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterText: {
    ...textStyles.subheading,
  },
  manageText: {
    flex: 1,
  },
  manageTitle: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  manageDetail: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  recent: {
    gap: spacing.md,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  seeAll: {
    ...textStyles.label,
    color: colors.accent,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  dot: {
    width: spacing.sm,
    height: spacing.sm,
    marginTop: spacing.sm,
    borderRadius: radius.pill,
  },
  entryText: {
    flex: 1,
    gap: spacing.xxs,
  },
  entrySummary: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
});
