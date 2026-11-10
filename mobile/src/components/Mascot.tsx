import { Image, StyleSheet, type ImageStyle, type StyleProp } from 'react-native';

import { sizes } from '@/theme';

// Chesty art from MCCS's "Meet Chesty" page, trimmed and scaled for @3x screens.
const POSES = {
  sitting: require('../../assets/chesty-sitting.png'),
  lying: require('../../assets/chesty-lying.png'),
};

type Props = {
  /** "sitting" (default) for sign-in, sign-up and order confirmation; "lying" for empty states. */
  pose?: keyof typeof POSES;
  style?: StyleProp<ImageStyle>;
};

/** Chesty, the Marine Corps bulldog. Decorative, so screen readers skip it. */
export default function Mascot({ pose = 'sitting', style }: Props) {
  return (
    <Image
      source={POSES[pose]}
      resizeMode="contain"
      style={[styles[pose], style]}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="mascot"
    />
  );
}

const styles = StyleSheet.create({
  sitting: {
    width: sizes.mascot,
    height: sizes.mascot,
  },
  // Both sides are set: Image doesn't reliably size itself from width plus aspectRatio.
  lying: {
    width: sizes.mascotLying,
    height: Math.round((sizes.mascotLying * 284) / 480), // the image is 480x284
  },
});
