import { Link, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import Mascot from '@/components/Mascot';
import { colors, sharedStyles, spacing, textStyles } from '@/theme';

type Props = {
  title: string;
  description: string;
  links?: { label: string; href: Href }[];
  /** Show the bulldog above the title, e.g. on Page not found. */
  mascot?: boolean;
};

/** Temporary screen body used until each screen's real task builds it. */
export default function PlaceholderScreen({ title, description, links = [], mascot }: Props) {
  return (
    <View style={[sharedStyles.screen, styles.container]}>
      {mascot ? <Mascot pose="lying" /> : null}
      <Text style={sharedStyles.title}>{title}</Text>
      <Text style={[sharedStyles.secondaryText, styles.description]}>{description}</Text>
      {links.map((link) => (
        <Link key={link.label} href={link.href} style={styles.link}>
          {link.label}
        </Link>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  description: {
    textAlign: 'center',
  },
  link: {
    ...textStyles.label,
    color: colors.accent,
    paddingVertical: spacing.sm,
  },
});
