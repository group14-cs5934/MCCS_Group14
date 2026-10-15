import { Stack, useLocalSearchParams } from 'expo-router';

import ProductPage from '@/components/ProductPage';
import { useProduct } from '@/hooks/useProduct';

/**
 * Product page opened by product ID,
 * e.g. /product/123 from a search result or saved list.
 */
export default function ProductByIdScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const state = useProduct(id);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProductPage state={state} />
    </>
  );
}
