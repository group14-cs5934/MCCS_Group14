import { useIsFocused } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import BarcodeScanner from '@/components/BarcodeScanner';
import CameraPermissionGate from '@/components/CameraPermissionGate';
import { sharedStyles } from '@/theme';

/**
 * Scan tab: asks for camera access, then reads product barcodes. For now it shows the barcode
 * it read; opening the product page is built in T030.
 */
export default function ScanScreen() {
  // Tabs stay mounted in the background, so the camera is only on while this tab is showing.
  const isFocused = useIsFocused();
  const [barcode, setBarcode] = useState<string | null>(null);

  return (
    <View style={sharedStyles.screen}>
      <CameraPermissionGate>
        {isFocused ? (
          <BarcodeScanner
            onScanned={setBarcode}
            hint={barcode ? `Barcode ${barcode}` : undefined}
          />
        ) : null}
      </CameraPermissionGate>
    </View>
  );
}
