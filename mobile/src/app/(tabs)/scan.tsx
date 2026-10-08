import { CameraView } from 'expo-camera';
import { StyleSheet, View } from 'react-native';

import CameraPermissionGate from '@/components/CameraPermissionGate';
import { sharedStyles } from '@/theme';

/** Scan tab: asks for camera access, then opens the camera. Barcode reading is built in T029. */
export default function ScanScreen() {
  return (
    <View style={sharedStyles.screen}>
      <CameraPermissionGate>
        <CameraView testID="scanner-camera" facing="back" style={StyleSheet.absoluteFill} />
      </CameraPermissionGate>
    </View>
  );
}
