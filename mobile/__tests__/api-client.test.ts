import Constants from 'expo-constants';

import { DEFAULT_TIMEOUT_MS, api, checkHealth, getApiBaseUrl } from '@/api';

// T015 acceptance: when the API is unreachable, the client returns a friendly error instead of
// crashing the app.

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));

/** Pretend the app is (or isn't) running from an Expo dev server at this address. */
function setDevServer(hostUri?: string) {
  (Constants as { expoConfig: unknown }).expoConfig = hostUri ? { hostUri } : null;
}

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const originalFetch = globalThis.fetch;

/** The next fetch gets this response. Header names are lowercase. */
function respondWith(status: number, body = '', headers: Record<string, string> = {}) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Response);
}

/** The next fetch never answers; it rejects once its signal aborts, like the real fetch. */
function hangUntilAborted() {
  fetchMock.mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init.signal!;
        if (signal.aborted) reject(new Error('Aborted'));
        signal.addEventListener('abort', () => reject(new Error('Aborted')));
      }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  delete process.env.EXPO_PUBLIC_API_URL;
  setDevServer(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('when the API is unreachable', () => {
  it('returns a friendly network error instead of throwing', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(checkHealth()).resolves.toEqual({
      ok: false,
      error: {
        kind: 'network',
        message: "Can't reach the server. Check your internet connection and try again.",
      },
    });
  });

  it('returns a timeout error when the server does not answer in time', async () => {
    jest.useFakeTimers();
    hangUntilAborted();

    const pending = checkHealth();
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({
      ok: false,
      error: {
        kind: 'timeout',
        message: 'The server is taking too long to respond. Please try again.',
      },
    });
  });

  it('uses a custom timeout', async () => {
    jest.useFakeTimers();
    hangUntilAborted();

    const pending = api.get('/health', { timeoutMs: 500 });
    jest.advanceTimersByTime(500);

    expect(await pending).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });
});

describe('cancelling', () => {
  it('returns an aborted error when the caller cancels', async () => {
    const controller = new AbortController();
    hangUntilAborted();

    const pending = api.get('/health', { signal: controller.signal });
    controller.abort();

    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } });
  });

  it('returns an aborted error when the signal was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    hangUntilAborted();

    expect(await api.get('/health', { signal: controller.signal })).toMatchObject({
      ok: false,
      error: { kind: 'aborted' },
    });
  });
});

describe('responses', () => {
  it('returns the parsed JSON on success', async () => {
    respondWith(200, '{"status":"ok"}');

    await expect(checkHealth()).resolves.toEqual({ ok: true, data: { status: 'ok' }, status: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/health',
      expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' } }),
    );
  });

  it('sends the body as JSON on post', async () => {
    respondWith(200, '{"name":"Chips"}');

    await api.post('/products/validate', { name: 'Chips' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/products/validate',
      expect.objectContaining({
        method: 'POST',
        body: '{"name":"Chips"}',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      }),
    );
  });

  it('returns null data for an empty success body', async () => {
    respondWith(204);

    await expect(api.post('/anything')).resolves.toEqual({ ok: true, data: null, status: 204 });
  });

  it('returns a friendly http error with the server details', async () => {
    respondWith(404, '{"detail":"Product not found"}', { 'x-request-id': 'req-123' });

    await expect(api.get('/products/999')).resolves.toEqual({
      ok: false,
      error: {
        kind: 'http',
        status: 404,
        message: "We couldn't find what you're looking for.",
        serverMessage: 'Product not found',
        requestId: 'req-123',
      },
    });
  });

  it('reads the code and message from the standard error format', async () => {
    respondWith(400, '{"code":"invalid_barcode","message":"Barcode check digit is wrong."}');

    expect(await api.get('/products/barcode/123')).toMatchObject({
      ok: false,
      error: {
        kind: 'http',
        status: 400,
        message: 'Something went wrong. Please try again.',
        code: 'invalid_barcode',
        serverMessage: 'Barcode check digit is wrong.',
      },
    });
  });

  it('shows a generic message for server errors, even with a non-JSON body', async () => {
    respondWith(500, 'Internal Server Error');

    await expect(api.get('/health')).resolves.toEqual({
      ok: false,
      error: {
        kind: 'http',
        status: 500,
        message: 'Something went wrong on our end. Please try again in a moment.',
      },
    });
  });

  it('returns an invalid-response error when a success body is not JSON', async () => {
    respondWith(200, '<html>Captive portal</html>');

    expect(await api.get('/health')).toMatchObject({
      ok: false,
      error: { kind: 'invalid-response', status: 200 },
    });
  });
});

describe('getApiBaseUrl', () => {
  it('defaults to localhost:8000', () => {
    expect(getApiBaseUrl()).toBe('http://localhost:8000');
  });

  it('uses port 8000 on the computer running the Expo dev server', () => {
    setDevServer('192.168.1.20:8081');

    expect(getApiBaseUrl()).toBe('http://192.168.1.20:8000');
  });

  it('prefers EXPO_PUBLIC_API_URL and drops a trailing slash', () => {
    setDevServer('192.168.1.20:8081');
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com/';

    expect(getApiBaseUrl()).toBe('https://api.example.com');
  });
});
