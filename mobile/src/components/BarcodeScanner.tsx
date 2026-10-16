import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, textStyles } from '@/theme';
import { PRODUCT_BARCODE_TYPES, readProductBarcode } from '@/utils/barcode';

/**
 * A barcode must stay in view this long before it's accepted. While you aim, the camera can pass
 * over other barcodes nearby (e.g. on a shelf); waiting means only the one you settle on counts.
 */
export const SCAN_HOLD_MS = 500;

/**
 * A gap in reads longer than this means the barcode left the view, so the wait starts over. The
 * camera reads a barcode in view several times a second, but can miss a few frames.
 */
export const SCAN_GAP_MS = 300;

type Props = {
  /**
   * Called with the barcode's digits once the same barcode has stayed in view for SCAN_HOLD_MS,
   * then again on every read while it stays in view (the camera reads many times a second).
   */
  onScanned: (barcode: string) => void;
};

/**
 * Live camera that reads product barcodes (UPC and EAN), with a frame to aim with and a
 * flashlight button. Needs camera access, so render it inside a CameraPermissionGate.
 */
export default function BarcodeScanner({ onScanned }: Props) {
  const [torchOn, setTorchOn] = useState(false);
  // The barcode being read right now, since when, and when it was last read. A ref (not state)
  // because reads arrive faster than re-renders.
  const current = useRef<{ barcode: string; since: number; lastRead: number } | null>(null);

  const handleBarcodeScanned = ({ type, data }: BarcodeScanningResult) => {
    // Blurry or partial reads come back null and are dropped; the camera just keeps looking.
    const barcode = readProductBarcode(type, data);
    if (!barcode) {
      return;
    }
    const now = Date.now();
    const held = current.current;
    if (held?.barcode !== barcode || now - held.lastRead > SCAN_GAP_MS) {
      // A different barcode, or the same one back after leaving the view: start waiting again.
      current.current = { barcode, since: now, lastRead: now };
      return;
    }
    held.lastRead = now;
    if (now - held.since >= SCAN_HOLD_MS) {
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
