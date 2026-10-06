import { getApiBaseUrl } from './config';

/** Requests that take longer than this fail with a 'timeout' error. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Response header with the server's request ID (see backend README: request logging). */
const REQUEST_ID_HEADER = 'X-Request-ID';

export type ApiErrorKind =
  | 'network' // couldn't reach the server: offline, wrong address, or server down
  | 'timeout' // server didn't answer within timeoutMs
  | 'http' // server answered with an error status (4xx or 5xx)
  | 'invalid-response' // server answered 2xx but the body wasn't JSON
  | 'aborted'; // the caller cancelled the request through its signal

export type ApiError = {
  kind: ApiErrorKind;
  /** Friendly text that's safe to show the user, e.g. as AsyncContent's error prop. */
  message: string;
  /** HTTP status code, for kind 'http'. */
  status?: number;
  /** Machine-readable error code from the server, if it sent one. */
  code?: string;
  /** The server's own error message, if any. For logs and screens that know what it means. */
  serverMessage?: string;
  /** The server's request ID. Include it in bug reports to find the matching server log line. */
  requestId?: string;
};

/** What every request resolves to. Requests never throw; check `ok` before using `data`. */
export type ApiResult<T> = { ok: true; data: T; status: number } | { ok: false; error: ApiError };

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON. */
  body?: unknown;
  /** Cancels the request, e.g. when the screen unmounts. */
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** Options for api.get / api.post, which set the method and body themselves. */
export type CallOptions = Omit<RequestOptions, 'method' | 'body'>;

const messages = {
  network: "Can't reach the server. Check your internet connection and try again.",
  timeout: 'The server is taking too long to respond. Please try again.',
  'invalid-response': 'The server sent an unexpected response. Please try again.',
  aborted: 'The request was cancelled.',
  notFound: "We couldn't find what you're looking for.",
  serverError: 'Something went wrong on our end. Please try again in a moment.',
  requestError: 'Something went wrong. Please try again.',
} as const;

function messageForStatus(status: number): string {
  if (status === 404) return messages.notFound;
  if (status >= 500) return messages.serverError;
  return messages.requestError;
}

/**
 * Pulls the error code and message out of an error response body. FastAPI's default body is
 * {"detail": "..."}; T032's standard format adds code/message. Update this if that format changes.
 */
function readServerError(body: unknown): Pick<ApiError, 'code' | 'serverMessage'> {
  if (typeof body !== 'object' || body === null) {
    return {};
  }
  const { code, message, detail } = body as Record<string, unknown>;
  const serverMessage = [message, detail].find((value) => typeof value === 'string');
  return {
    code: typeof code === 'string' ? code : undefined,
    serverMessage: serverMessage as string | undefined,
  };
}

/** Parses a response body; empty means null, and undefined means it wasn't JSON. */
function parseJson(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Calls the backend and resolves to { ok: true, data } or { ok: false, error }. Never throws for
 * network or server problems: an unreachable API gives a 'network' error with a friendly message.
 * `path` starts with a slash, e.g. "/products/123".
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const fail = (error: ApiError): ApiResult<T> => ({ ok: false, error });

  // One controller aborts the fetch on either the timeout or the caller's signal.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  }
  signal?.addEventListener('abort', abortFromCaller);

  // Why the connection failed, when fetch or reading the body throws.
  const connectionError = (): ApiResult<T> => {
    const kind = timedOut ? 'timeout' : signal?.aborted ? 'aborted' : 'network';
    return fail({ kind, message: messages[kind] });
  };

  try {
    let response: Response;
    let text: string;
    try {
      response = await fetch(`${getApiBaseUrl()}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      return connectionError();
    }

    const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined;
    const data = parseJson(text);

    if (!response.ok) {
      return fail({
        kind: 'http',
        message: messageForStatus(response.status),
        status: response.status,
        requestId,
        ...readServerError(data),
      });
    }
    if (data === undefined) {
      return fail({
        kind: 'invalid-response',
        message: messages['invalid-response'],
        status: response.status,
        requestId,
      });
    }
    return { ok: true, data: data as T, status: response.status };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Shorthands for request(). Example: const result = await api.get<Product>('/products/1'); */
export const api = {
  get: <T>(path: string, options?: CallOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: CallOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
};
