import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, textStyles } from '@/theme';
import type { PermissionInfo } from '@/types/user';

type Props = {
  /** Every permission to offer, from GET /staff/permissions. */
  permissions: PermissionInfo[];
  /** The keys that are ticked. */
  selected: string[];
  onToggle: (key: string) => void;
};

/** A checklist of permissions, each with a label and what it allows, e.g. in the role form. */
export default function PermissionChecklist({ permissions, selected, onToggle }: Props) {
  return (
    <View style={styles.list}>
      {permissions.map((permission) => {
        const checked = selected.includes(permission.key);
        return (
          <Pressable
            key={permission.key}
            onPress={() => onToggle(permission.key)}
            accessibilityRole="checkbox"
            accessibilityLabel={permission.label}
            accessibilityHint={permission.description}
            accessibilityState={{ checked }}
            style={styles.row}
          >
            <Ionicons
              name={checked ? 'checkbox' : 'square-outline'}
              size={textStyles.body.lineHeight}
              color={checked ? colors.accent : colors.textMuted}
            />
            <View style={styles.text}>
              <Text style={styles.label}>{permission.label}</Text>
              <Text style={styles.description}>{permission.description}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  text: {
    flex: 1,
  },
  label: {
    ...textStyles.label,
    color: colors.textPrimary,
  },
  description: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
});
