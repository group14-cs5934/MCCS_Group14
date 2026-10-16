import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { SCAN_GAP_MS, SCAN_HOLD_MS } from '@/components/BarcodeScanner';

// T029 acceptance: when I point the camera at a supported barcode, it is detected. When the
// barcode is blurry or partial, nothing is submitted until a full read succeeds.
// T030 acceptance: when a barcode is detected, the app navigates to that product's page exactly
// once (no duplicate navigations).
// A barcode only counts once it has stayed in view for SCAN_HOLD_MS, so a barcode the camera
// passes over while aiming isn't opened by mistake.

// These tests stop at "the product page opened", so the page never calls the API: it just shows
// its loading spinner.
jest.mock('@/hooks/useProduct', () => {
  const loading = () => ({ loading: true, product: null, error: null, reload: () => {} });
  return { useProduct: loading, useProductByBarcode: loading };
});

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
const SAMPLE_EAN = '4006381333931';

const openScan = () => renderRouter('src/app', { initialUrl: '/scan' });

/**
 * Moves the scanner's clock (Date.now) forward. renderRouter turns on Jest's fake timers, which
 * fake the clock too, so time only passes when a test says so.
 */
const tick = (ms: number) => jest.setSystemTime(Date.now() + ms);

/** The camera reads a barcode once, as it does many times a second while one is in view. */
const cameraReads = (type: string, data: string) =>
  fireEvent(screen.getByTestId('scanner-camera'), 'barcodeScanned', { type, data });

/** The barcode stays in view long enough to count: read every 100 ms for SCAN_HOLD_MS. */
const cameraHolds = (type: string, data: string) => {
  cameraReads(type, data);
  for (let waited = 0; waited < SCAN_HOLD_MS; waited += 100) {
    tick(100);
    cameraReads(type, data);
  }
};

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

  it('opens the product page for a detected barcode', async () => {
    openScan();
    await screen.findByTestId('scanner-camera');

    cameraHolds('upc_a', SAMPLE_UPC);

    expect(screen).toHavePathname(`/product/barcode/${SAMPLE_UPC}`);
    expect(screen.getByText('Loading product…')).toBeOnTheScreen();
  });

  it('waits for the barcode to stay in view before opening it', async () => {
    openScan();
    await screen.findByTestId('scanner-camera');

    // Read every 100 ms, stopping just short of SCAN_HOLD_MS.
    cameraReads('upc_a', SAMPLE_UPC);
    for (let waited = 100; waited < SCAN_HOLD_MS; waited += 100) {
      tick(100);
      cameraReads('upc_a', SAMPLE_UPC);
    }
    expect(screen).toHavePathname('/scan');

    tick(100);
    cameraReads('upc_a', SAMPLE_UPC);
    expect(screen).toHavePathname(`/product/barcode/${SAMPLE_UPC}`);
  });

  it('ignores a barcode the camera passes over on the way to another', async () => {
    openScan();
    await screen.findByTestId('scanner-camera');

    // Aiming sweeps past a neighbouring barcode for a moment, then settles on the right one.
    cameraReads('ean13', SAMPLE_EAN);
    tick(100);
    cameraReads('ean13', SAMPLE_EAN);
    tick(100);
    cameraHolds('upc_a', SAMPLE_UPC);

    expect(screen).toHavePathname(`/product/barcode/${SAMPLE_UPC}`);
  });

  it('starts waiting again when the barcode leaves the view and comes back', async () => {
    openScan();
    await screen.findByTestId('scanner-camera');

    cameraReads('upc_a', SAMPLE_UPC);
    tick(SCAN_GAP_MS + 1); // no reads for a moment: it left the view
    cameraReads('upc_a', SAMPLE_UPC);
    tick(SCAN_HOLD_MS - SCAN_GAP_MS);
    cameraReads('upc_a', SAMPLE_UPC);

    expect(screen).toHavePathname('/scan');
  });

  it('submits nothing for a blurry or partial read, then accepts the full read', async () => {
    openScan();
    await screen.findByTestId('scanner-camera');

    cameraReads('upc_a', '03600029145'); // last digit cut off
    cameraReads('upc_a', '036000291457'); // a digit misread, so the check digit is wrong
    cameraReads('qr', 'https://example.com'); // not a product barcode

    expect(screen).toHavePathname('/scan');

    cameraHolds('upc_a', SAMPLE_UPC);

    expect(screen).toHavePathname(`/product/barcode/${SAMPLE_UPC}`);
  });

  it('opens the product page exactly once when the camera keeps reading the barcode', async () => {
    openScan();
    const camera = await screen.findByTestId('scanner-camera');
    // Reads that arrive before the screen has re-rendered all go to the same handler.
    const { onBarcodeScanned } = camera.props;

    act(() => {
      // Held in view long enough, so the last read here opens the product...
      onBarcodeScanned({ type: 'upc_a', data: SAMPLE_UPC });
      for (let waited = 0; waited < SCAN_HOLD_MS; waited += 100) {
        tick(100);
        onBarcodeScanned({ type: 'upc_a', data: SAMPLE_UPC });
      }
      // ...and the camera keeps reading it before the screen changes.
      tick(50);
      onBarcodeScanned({ type: 'upc_a', data: SAMPLE_UPC });
      onBarcodeScanned({ type: 'upc_a', data: SAMPLE_UPC });
    });

    expect(screen).toHavePathname(`/product/barcode/${SAMPLE_UPC}`);
    // The camera is off while the product page is showing, so nothing more can be scanned.
    expect(screen.queryByTestId('scanner-camera')).not.toBeOnTheScreen();

    // One Back returns to the scanner, so only one product page was opened.
    act(() => router.back());
    expect(screen).toHavePathname('/scan');
  });

  it('is ready to scan another product after going back', async () => {
    openScan();
    await screen.findByTestId('scanner-camera');

    cameraHolds('upc_a', SAMPLE_UPC);
    act(() => router.back());
    cameraHolds('ean13', SAMPLE_EAN);

    expect(screen).toHavePathname(`/product/barcode/${SAMPLE_EAN}`);
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
