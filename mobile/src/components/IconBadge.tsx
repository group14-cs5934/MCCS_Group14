import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  /** Ionicons name, e.g. "barcode-outline". */
  icon: IconName;
  style?: StyleProp<ViewStyle>;
};

/** Icon in a soft circle, for call-to-action, empty, and error states. */
export default function IconBadge({ icon, style }: Props) {
  return (
    <View style={[styles.badge, style]}>
      <Ionicons name={icon} size={32} color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.iconBadge,
  },
});
