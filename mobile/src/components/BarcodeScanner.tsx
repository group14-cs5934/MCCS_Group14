import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, textStyles } from '@/theme';
import { PRODUCT_BARCODE_TYPES, readProductBarcode } from '@/utils/barcode';

type Props = {
  /**
   * Called with the barcode's digits every time the camera gets a complete, valid read. The
   * camera reads many times a second, so this is called repeatedly while a barcode is in view.
   */
  onScanned: (barcode: string) => void;
};

/**
 * Live camera that reads product barcodes (UPC and EAN), with a frame to aim with and a
 * flashlight button. Needs camera access, so render it inside a CameraPermissionGate.
 */
export default function BarcodeScanner({ onScanned }: Props) {
  const [torchOn, setTorchOn] = useState(false);

  const handleBarcodeScanned = ({ type, data }: BarcodeScanningResult) => {
    // Blurry or partial reads come back null and are dropped; the camera just keeps looking.
    const barcode = readProductBarcode(type, data);
    if (barcode) {
      onScanned(barcode);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        testID="scanner-camera"
        facing="back"
        enableTorch={torchOn}
        barcodeScannerSettings={{ barcodeTypes: PRODUCT_BARCODE_TYPES }}
        onBarcodeScanned={handleBarcodeScanned}
        style={StyleSheet.absoluteFill}
      />

      {/* Drawn over the camera; box-none lets touches outside the button reach the camera. */}
      <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="box-none">
        <Pressable
          onPress={() => setTorchOn((on) => !on)}
          accessibilityRole="button"
          accessibilityLabel={torchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
          hitSlop={spacing.sm}
          style={styles.torchButton}
        >
          <Ionicons
            name={torchOn ? 'flash' : 'flash-outline'}
            size={22}
            color={colors.textOnPrimary}
          />
        </Pressable>

        <View style={styles.frame}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>

        <Text style={styles.hint}>Point your camera at a barcode</Text>
      </View>
    </View>
  );
}

const CORNER_SIZE = 28;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary, // shows while the camera starts up
  },
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    padding: spacing.xl,
  },
  torchButton: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  // Wide and short, like the barcodes it's aimed at.
  frame: {
    width: '85%',
    maxWidth: 320,
    aspectRatio: 1.6,
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: colors.textOnPrimary,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopLeftRadius: radius.md,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopRightRadius: radius.md,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomLeftRadius: radius.md,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomRightRadius: radius.md,
  },
  hint: {
    ...textStyles.label,
    color: colors.textOnPrimary,
    textAlign: 'center',
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    overflow: 'hidden', // clips the background to the rounded corners on iOS
  },
});
