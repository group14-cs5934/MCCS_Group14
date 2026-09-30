import { useLocalSearchParams } from 'expo-router';

import PlaceholderScreen from '@/components/PlaceholderScreen';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <PlaceholderScreen
      title={`Product ${id}`}
      description="Product information page is built in T040. Press back to return."
    />
  );
}
