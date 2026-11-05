import { StyleSheet, Text } from 'react-native';

import { colors, sharedStyles } from '@/theme';

export type BadgeTone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

type Props = {
  label: string;
  /**
   * accent: e.g. a role, "You", or "Your store". success: in stock, available. warning: low
   * stock, only N left. danger: something taken away or missing, e.g. Hidden, Out of stock.
   * info: a demo note.
   */
  tone: BadgeTone;
};

/** Small pill label on a row, e.g. "Admin" or "Hidden" in the admin area, or "In stock". */
export default function Badge({ label, tone }: Props) {
  return <Text style={[sharedStyles.pill, styles[tone]]}>{label}</Text>;
}

const styles = StyleSheet.create({
  accent: {
    color: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  success: {
    color: colors.success,
    backgroundColor: colors.successSoft,
  },
  warning: {
    color: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  danger: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  info: {
    color: colors.info,
    backgroundColor: colors.infoSoft,
  },
});
