import { useLocalSearchParams } from 'expo-router';

import ProductPage from '@/components/ProductPage';
import { useProductByBarcode } from '@/hooks/useProduct';

/** Product page opened by barcode, e.g. /product/barcode/036000291452 after a scan. */
export default function ProductByBarcodeScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <ProductPage state={useProductByBarcode(code)} />;
}
