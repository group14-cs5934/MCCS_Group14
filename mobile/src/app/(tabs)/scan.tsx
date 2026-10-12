import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { View } from 'react-native';

import BarcodeScanner from '@/components/BarcodeScanner';
import CameraPermissionGate from '@/components/CameraPermissionGate';
import { sharedStyles } from '@/theme';

/** Scan tab: asks for camera access, then reads a product barcode and opens that product's page. */
export default function ScanScreen() {
  const router = useRouter();
  // Tabs stay mounted in the background, so the camera is only on while this tab is showing.
  const isFocused = useIsFocused();

  // The camera reads the same barcode many times a second, and more reads can arrive before the
  // product page has opened. Only the first one may navigate, or the page would open repeatedly.
  // A ref (not state) because the next read can arrive before a re-render.
  const hasOpenedProduct = useRef(false);

  // Coming back to this tab (e.g. Back from the product page) makes it ready to scan again.
  useFocusEffect(
    useCallback(() => {
      hasOpenedProduct.current = false;
    }, []),
  );

  const openProduct = (barcode: string) => {
    if (hasOpenedProduct.current) {
      return;
    }
    hasOpenedProduct.current = true;
    router.push(`/product/barcode/${barcode}`);
  };

  return (
    <View style={sharedStyles.screen}>
      <CameraPermissionGate>
        {isFocused ? <BarcodeScanner onScanned={openProduct} /> : null}
      </CameraPermissionGate>
    </View>
  );
}
