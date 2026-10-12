import { useLocalSearchParams } from 'expo-router';

import ProductPage from '@/components/ProductPage';
import { useProduct } from '@/hooks/useProduct';

/** Product page opened by product ID, e.g. /product/123 from a search result or saved list. */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProductPage state={useProduct(id)} />;
}
