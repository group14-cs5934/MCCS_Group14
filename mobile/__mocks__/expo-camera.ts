// Used automatically by every Jest test in place of the native camera module. Answers as a
// device that hasn't been asked for camera access yet; a test that needs another answer calls
// jest.mock('expo-camera', ...) itself (see __tests__/camera-permission.test.tsx).

export const CameraView = () => null;

export const useCameraPermissions = () => [
  { granted: false, canAskAgain: true, status: 'undetermined', expires: 'never' },
  jest.fn(),
  jest.fn(),
];
