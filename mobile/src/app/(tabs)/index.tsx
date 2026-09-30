import type { Href } from 'expo-router';

import PlaceholderScreen from '@/components/PlaceholderScreen';

const links: { label: string; href: Href }[] = [
  { label: 'Open a sample product', href: '/product/sample-lays' },
  { label: 'Search products', href: '/search' },
];
if (__DEV__) {
  links.push({ label: 'Theme preview (dev)', href: '/theme-preview' });
}

export default function HomeScreen() {
  return (
    <PlaceholderScreen
      title="Scan & compare."
      description="Home screen layout is built in T016."
      links={links}
    />
  );
}
