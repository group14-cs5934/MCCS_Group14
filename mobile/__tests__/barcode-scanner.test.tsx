import Ionicons from '@expo/vector-icons/Ionicons';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// T029 acceptance: when I point the camera at a supported barcode, it is detected. When the
// barcode is blurry or partial, nothing is submitted until a full read succeeds.

// Stand-in for the native camera with access already allowed. CameraView is a plain view, so a
// test can find it and fire the same event the real camera sends when it reads a barcode.
jest.mock('expo-camera', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    CameraView: (props: object) => createElement(View, props),
    useCameraPermissions: () => [
      { granted: true, canAskAgain: true, status: 'granted', expires: 'never' },
      jest.fn(),
      jest.fn(),
    ],
  };
});

const SAMPLE_UPC = '036000291452';

const openScan = () => renderRouter('src/app', { initialUrl: '/scan' });

/** The camera reads a barcode, as it does many times a second while one is in view. */
const cameraReads = (type: string, data: string) =>
  fireEvent(screen.getByTestId('scanner-camera'), 'barcodeScanned', { type, data });

/** Tab bar buttons are announced as e.g. "Scan, tab, 2 of 3". */
const tab = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, tab`) });

beforeAll(() => Ionicons.loadFont());

describe('barcode scanner', () => {
  it('shows the camera with a hint, looking only for product barcodes', async () => {
    openScan();

    const camera = await screen.findByTestId('scanner-camera');
    expect(screen.getByText('Point your camera at a barcode')).toBeOnTheScreen();
    expect(camera.props.barcodeScannerSettings.barcodeTypes).toEqual([
      'upc_a',
      'upc_e',
      'ean13',
      'ean8',
    ]);
  });

  it('detects a supported barcode', async () => {
    openScan();
    await screen.findByTestId('scanner-camera');

    cameraReads('upc_a', SAMPLE_UPC);

    expect(screen.getByText(`Barcode ${SAMPLE_UPC}`)).toBeOnTheScreen();
  });

  it('submits nothing for a blurry or partial read, then accepts the full read', async () => {
    openScan();
    await screen.findByTestId('scanner-camera');

    cameraReads('upc_a', '03600029145'); // last digit cut off
    cameraReads('upc_a', '036000291457'); // a digit misread, so the check digit is wrong
    cameraReads('qr', 'https://example.com'); // not a product barcode

    expect(screen.getByText('Point your camera at a barcode')).toBeOnTheScreen();
    expect(screen.queryByText(/^Barcode /)).not.toBeOnTheScreen();

    cameraReads('upc_a', SAMPLE_UPC);

    expect(screen.getByText(`Barcode ${SAMPLE_UPC}`)).toBeOnTheScreen();
  });

  it('turns the flashlight on and off', async () => {
    openScan();
    const camera = await screen.findByTestId('scanner-camera');
    expect(camera.props.enableTorch).toBe(false);

    fireEvent.press(screen.getByRole('button', { name: 'Turn flashlight on' }));
    expect(screen.getByTestId('scanner-camera').props.enableTorch).toBe(true);

    fireEvent.press(screen.getByRole('button', { name: 'Turn flashlight off' }));
    expect(screen.getByTestId('scanner-camera').props.enableTorch).toBe(false);
  });

  it('turns the camera off while another tab is showing', async () => {
    openScan();
    await screen.findByTestId('scanner-camera');

    fireEvent.press(tab('Home'));
    expect(screen.queryByTestId('scanner-camera')).not.toBeOnTheScreen();

    fireEvent.press(tab('Scan'));
    expect(screen.getByTestId('scanner-camera')).toBeOnTheScreen();
  });
});
