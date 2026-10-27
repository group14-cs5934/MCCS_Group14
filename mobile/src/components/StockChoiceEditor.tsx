import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import TextField from '@/components/TextField';
import { colors, radius, sharedStyles, spacing, textStyles } from '@/theme';
import type { StockChoice, StockFormRow } from '@/utils/productForm';

const choices: { key: StockChoice; label: string }[] = [
  { key: 'auto', label: 'Automatic' },
  { key: 'in', label: 'In stock' },
  { key: 'out', label: 'Out of stock' },
];

type Props = {
  /** What's being stocked: a store (admin product form, T091) or a product (My store). */
  title: string;
  row: StockFormRow;
  /** Shown under the quantity, e.g. "Enter a whole number above 0, or leave it empty." */
  error?: string;
  onChange: (change: Partial<StockFormRow>) => void;
  /** The quantity field's label; defaults to "Quantity at <title> (optional)". */
  quantityLabel?: string;
  /** Shown at the bottom of the card, e.g. Save and Cancel buttons. */
  children?: ReactNode;
};

/**
 * One store's stock of one product, set by hand: Automatic (the product monitor decides), In
 * stock (with an optional quantity), or Out of stock. Used by the admin product form and by store
 * staff on My store.
 */
export default function StockChoiceEditor({
  title,
  row,
  error,
  onChange,
  quantityLabel,
  children,
}: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {row.choice === 'auto' ? <Text style={styles.hint}>Now: {row.current}</Text> : null}
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {choices.map((choice) => {
          const selected = choice.key === row.choice;
          return (
            <Pressable
              key={choice.key}
              onPress={() => onChange({ choice: choice.key })}
              accessibilityRole="radio"
              accessibilityLabel={`${title}: ${choice.label}`}
              accessibilityState={{ checked: selected }}
              style={[styles.choice, selected && styles.choiceSelected]}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {row.choice === 'in' ? (
        <TextField
          label={quantityLabel ?? `Quantity at ${title} (optional)`}
          keyboardType="number-pad"
          value={row.quantity}
          error={error}
          onChangeText={(quantity) => onChange({ quantity })}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    ...sharedStyles.card,
    gap: spacing.sm,
  },
  title: {
    ...textStyles.bodyStrong,
    color: colors.textPrimary,
  },
  hint: {
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
