import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, textStyles } from '@/theme';

type Props<T extends string | number> = {
  label: string;
  options: { key: T; label: string }[];
  selected: T | null;
  onSelect: (key: T) => void;
};

/** A labelled row of options with one chosen, e.g. an account type or a store role. */
export default function Choices<T extends string | number>({
  label,
  options,
  selected,
  onSelect,
}: Props<T>) {
  return (
    <View style={styles.group}>
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
  group: {
    gap: spacing.xs,
  },
  caption: {
    ...textStyles.caption,
    color: colors.textSecondary,
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
