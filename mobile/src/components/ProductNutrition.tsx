import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, textStyles } from '@/theme';

export default function ProductNutrition() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>
        Nutrition Information
      </Text>

      <Text style={styles.message}>
        Nutrition information is not available
        for this product yet.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  heading: {
    ...textStyles.subheading,
    color: colors.textPrimary,
  },
  message: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
});