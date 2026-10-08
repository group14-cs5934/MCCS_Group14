import Ionicons from '@expo/vector-icons/Ionicons';
import type { PermissionResponse } from 'expo-camera';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { AppState, Linking, type AppStateStatus } from 'react-native';

// T028 acceptance: when I allow camera access, the scanner opens. When I deny camera access,
// I see an explanation and a link to settings, and the app does not crash.

const permission = (granted: boolean, canAskAgain: boolean) =>
  ({
    granted,
    canAskAgain,
    status: granted ? 'granted' : canAskAgain ? 'undetermined' : 'denied',
    expires: 'never',
  }) as PermissionResponse;

const notAskedYet = permission(false, true);
const denied = permission(false, false);
const allowed = permission(true, true);

/** What the device reports when the screen opens, and what the system prompt answers. */
let mockCurrent: PermissionResponse;
let mockPromptAnswer: PermissionResponse;

// Stand-in for the native camera: the hook keeps real state so the screen re-renders the way it
// does on a device, and CameraView is a plain view the tests can find.
jest.mock('expo-camera', () => {
  const { createElement, useState } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    CameraView: (props: object) => createElement(View, props),
    useCameraPermissions: () => {
      const [status, setStatus] = useState(mockCurrent);
      const request = async () => {
        mockCurrent = mockPromptAnswer;
        setStatus(mockCurrent);
        return mockCurrent;
      };
      const get = async () => {
        setStatus(mockCurrent);
        return mockCurrent;
      };
      return [status, request, get];
    },
  };
});

const openScan = () => renderRouter('src/app', { initialUrl: '/scan' });
const camera = () => screen.queryByTestId('scanner-camera');

beforeAll(() => Ionicons.loadFont());

beforeEach(() => {
  mockCurrent = notAskedYet;
  mockPromptAnswer = allowed;
});

afterEach(() => jest.restoreAllMocks());

describe('camera permission flow', () => {
  it('explains why the camera is needed before asking', async () => {
    openScan();

    expect(await screen.findByText('Allow camera access')).toBeOnTheScreen();
    expect(screen.getByText(/scan product barcodes/)).toBeOnTheScreen();
    expect(camera()).not.toBeOnTheScreen();
  });

  it('opens the scanner when access is allowed', async () => {
    openScan();

    fireEvent.press(await screen.findByRole('button', { name: 'Allow Camera Access' }));

    expect(await screen.findByTestId('scanner-camera')).toBeOnTheScreen();
    expect(screen.queryByText('Allow camera access')).not.toBeOnTheScreen();
  });

  it('opens the scanner right away when access was already allowed', async () => {
    mockCurrent = allowed;
    openScan();

    expect(await screen.findByTestId('scanner-camera')).toBeOnTheScreen();
  });

  it('shows an explanation and a link to Settings when access is denied', async () => {
    mockPromptAnswer = denied;
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    openScan();

    fireEvent.press(await screen.findByRole('button', { name: 'Allow Camera Access' }));

    expect(await screen.findByText('Camera access is off')).toBeOnTheScreen();
    expect(screen.getByText(/Turn on Camera for Recon in Settings/)).toBeOnTheScreen();
    expect(camera()).not.toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('does not crash if Settings cannot be opened', async () => {
    mockCurrent = denied;
    jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('unavailable'));
    openScan();

    fireEvent.press(await screen.findByRole('button', { name: 'Open Settings' }));
    await act(async () => {});

    expect(screen.getByText('Camera access is off')).toBeOnTheScreen();
  });

  it('opens the scanner after access is turned on in Settings', async () => {
    mockCurrent = denied;
    const addListener = jest.spyOn(AppState, 'addEventListener');
    openScan();
    await screen.findByText('Camera access is off');

    // The user switches to Settings, turns the camera on, and comes back to the app.
    mockCurrent = allowed;
    const onAppStateChange = addListener.mock.calls
      .filter(([type]) => type === 'change')
      .map(([, listener]) => listener as (state: AppStateStatus) => void);
    await act(async () => onAppStateChange.forEach((listener) => listener('active')));

    expect(await screen.findByTestId('scanner-camera')).toBeOnTheScreen();
  });

  it('offers manual search when the camera is not available', async () => {
    mockCurrent = denied;
    openScan();

    fireEvent.press(await screen.findByRole('button', { name: 'Search manually' }));
    expect(screen).toHavePathname('/search');
  });
});
