import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing } from '@/theme';

/** Ratings are 1 to 5 stars (the API rejects anything else). */
export const MAX_STARS = 5;

const STAR_NUMBERS = Array.from({ length: MAX_STARS }, (_, index) => index + 1);

/** Interactive stars get at least this much room to tap, even when drawn smaller. */
const MIN_TOUCH_SIZE = 44;

type Props = {
  /**
   * How many stars are highlighted. 0 highlights none (not rated yet). When read-only, a fraction
   * like an average of 3.67 is shown to the nearest half star.
   */
  value: number;
  /**
   * Makes the stars tappable: tapping the fourth star calls this with 4. The parent keeps the
   * value, so pass the new number back in as `value` to highlight it.
   */
  onChange?: (stars: number) => void;
  /** Ignores taps, e.g. while a rating is being saved. */
  disabled?: boolean;
  /** Star size in points. */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * A row of five stars. With onChange the shopper taps a star to rate (1 to 5); without it, the
 * stars only show a rating, such as a product's average.
 *
 *   const [stars, setStars] = useState(0);
 *   <StarRating value={stars} onChange={setStars} />
 *   <StarRating value={summary.average ?? 0} size={16} />
 */
export default function StarRating({ value, onChange, disabled = false, size = 24, style }: Props) {
  if (!onChange) {
    // Nearest half star: 3.67 shows 3½, 3.2 shows 3.
    const shown = Math.round(value * 2) / 2;
    return (
      <View
        style={[styles.row, style]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Rated ${formatStars(value)} out of ${MAX_STARS}`}
      >
        {STAR_NUMBERS.map((star) => (
          <Ionicons
            key={star}
            name={shown >= star ? 'star' : shown >= star - 0.5 ? 'star-half' : 'star-outline'}
            size={size}
            color={shown >= star - 0.5 ? colors.rating : colors.textMuted}
          />
        ))}
      </View>
    );
  }

  const padding = Math.max(0, (MIN_TOUCH_SIZE - size) / 2);
  return (
    <View style={[styles.row, style]} accessibilityRole="radiogroup" accessibilityLabel="Rating">
      {STAR_NUMBERS.map((star) => {
        const highlighted = star <= value;
        return (
          <Pressable
            key={star}
            onPress={() => onChange(star)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'}`}
            accessibilityState={{ checked: star === value, disabled }}
            style={({ pressed }) => [{ padding }, pressed && styles.pressed]}
          >
            <Ionicons
              name={highlighted ? 'star' : 'star-outline'}
              size={size}
              color={highlighted ? colors.rating : colors.textMuted}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** 3 -> "3", 3.666 -> "3.7". */
function formatStars(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  pressed: {
    opacity: 0.6,
  },
});
