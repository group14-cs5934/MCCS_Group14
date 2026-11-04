import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, textStyles } from '@/theme';

export type SectionTab<K extends string> = {
  key: K;
  /** What screen readers say, e.g. "Store info". */
  label: string;
  /** What the tab shows, when the label is too long for a narrow tab, e.g. "Info". */
  shortLabel?: string;
  /** E.g. a count, shown on the tab's top-right corner so it takes no room from the label. */
  badge?: ReactNode;
};

type Props<K extends string> = {
  tabs: SectionTab<K>[];
  selected: K | undefined;
  onSelect: (key: K) => void;
};

/**
 * A row of tabs that always fits the screen: every tab gets the same width, labels stay on one
 * line (shrinking a little rather than wrapping), and badges sit on the corner.
 */
export default function SectionTabs<K extends string>({ tabs, selected, onSelect }: Props<K>) {
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const isSelected = tab.key === selected;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isSelected }}
            style={[styles.tab, isSelected && styles.tabSelected]}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={[styles.text, isSelected && styles.textSelected]}
            >
              {tab.shortLabel ?? tab.label}
            </Text>
            {tab.badge ? (
              <View style={styles.badge} pointerEvents="none">
                {tab.badge}
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    // Room above for the badges, which sit on the tabs' top corners.
    marginTop: spacing.lg,
    padding: spacing.xxs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  tab: {
    // Equal shares of the bar, however long the labels are.
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xxs,
    borderRadius: radius.pill,
  },
  tabSelected: {
    backgroundColor: colors.surface,
  },
  text: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  textSelected: {
    color: colors.textPrimary,
  },
  badge: {
    position: 'absolute',
    top: -spacing.md,
    right: -spacing.xxs,
  },
});
