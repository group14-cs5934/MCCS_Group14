import Constants from 'expo-constants';

/** Port the FastAPI dev server listens on (uv run fastapi dev). */
const DEV_API_PORT = 8000;

/**
 * Base URL of the FastAPI backend, with no trailing slash. Chosen in this order:
 * 1. EXPO_PUBLIC_API_URL, if set (e.g. in mobile/.env). Use this for a deployed API.
 * 2. In development: port 8000 on the computer running Expo. Works on simulators, emulators,
 *    and phones on the same Wi-Fi, if the backend listens on all interfaces
 *    (uv run fastapi dev app/main.py --host 0.0.0.0).
 * 3. http://localhost:8000.
 */
export function getApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }

  // Address of the Expo dev server, e.g. "192.168.1.20:8081". Only set in development.
  const devServer = Constants.expoConfig?.hostUri;
  if (devServer) {
    const host = devServer.replace(/:\d+$/, '');
    return `http://${host}:${DEV_API_PORT}`;
  }

  return `http://localhost:${DEV_API_PORT}`;
}
