import { api, type CallOptions } from './client';

/** GET /health: ok while the backend is up. Use it to check that the app can reach the API. */
export function checkHealth(options?: CallOptions) {
  return api.get<{ status: 'ok' }>('/health', options);
}
