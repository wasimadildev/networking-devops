import { ApiError, toApiError } from './errors';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './token-store';
import type { ApiErrorBody, PageInfo } from './types';

/**
 * The only module that knows where the API lives.
 *
 * `API_BASE` is empty on purpose. In production the SPA is served by Nginx on
 * the same origin as the API, and Nginx proxies /api to the app tier, so
 * same-origin requests are correct and no build-time host is needed. In
 * development Vite proxies /api to the backend, which also makes the browser
 * see a single origin. The consequence is that CORS is never exercised locally —
 * see the CORS tests in the backend suite, which cover it deliberately.
 */
const API_BASE = '';

const REFRESH_PATH = '/api/v1/auth/refresh';

/**
 * A page with nothing in it, for the 204 branch of `readPage`.
 *
 * Shaped to the server's `Page<T>`, which carries only `hasNextPage` and
 * `nextCursor` — the page size and row count are deliberately not sent, because
 * a cursor cannot report a total without counting the whole table.
 */
const EMPTY_PAGE: PageInfo = { hasNextPage: false, nextCursor: null };

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Query parameters. `undefined` and `null` values are dropped, not sent. */
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Skips the Authorization header and the 401 refresh dance. For login. */
  anonymous?: boolean;
}

/**
 * The single in-flight refresh.
 *
 * Without this, six components loading at once all receive a 401, all call
 * refresh with the same rotated token, and the first one to succeed rotates it —
 * leaving the other five to present a token the server now considers a replay.
 * That trips reuse detection and revokes the whole family, logging the user out
 * for a page that merely loaded in parallel. The bug is invisible in a demo and
 * constant in production.
 *
 * So refreshes are shared: the first caller starts the work, everyone else
 * awaits the same promise, and the rotated token is picked up from storage.
 */
let refreshInFlight: Promise<string | null> | null = null;

const performRefresh = async (): Promise<string | null> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_BASE}${REFRESH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // 401 here means the refresh token is dead: expired, revoked, or already
      // used. There is nothing to retry, so the session is over.
      clearTokens();
      return null;
    }

    const body = (await response.json()) as { data: { accessToken: string; refreshToken: string } };
    setTokens(body.data.accessToken, body.data.refreshToken);
    return body.data.accessToken;
  } catch {
    // A network failure is not a dead session. Tokens are left alone so a
    // dropped connection does not sign the user out; the original request
    // reports the failure and the user can retry.
    return null;
  }
};

export const refreshSession = (): Promise<string | null> => {
  if (refreshInFlight) return refreshInFlight;

  const pending = performRefresh().finally(() => {
    // Cleared in a finally so a rejected refresh does not wedge every later
    // request on the same dead promise.
    refreshInFlight = null;
  });
  refreshInFlight = pending;
  return pending;
};

/**
 * Called when the session is known to be unrecoverable.
 *
 * Registered by the session store rather than imported from it. The dependency
 * runs the other way (the store uses the API layer), so importing the store here
 * would close a cycle: client → session-store → endpoints → client. ESM can
 * survive some cycles, but a transport layer that re-executes a module's
 * top-level code is not something to rely on for a sign-out path.
 */
let onSessionEnded: (() => void) | null = null;

export const setSessionEndedHandler = (handler: (() => void) | null): void => {
  onSessionEnded = handler;
};

const notifySignedOut = (): void => {
  onSessionEnded?.();
};

const buildUrl = (path: string, query: RequestOptions['query']): string => {
  const url = `${API_BASE}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }

  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
};

const parseError = async (response: Response): Promise<ApiError> => {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.code) return new ApiError(response.status, body.error);
  } catch {
    // Fall through: a non-JSON error body means something between the client and
    // the API answered instead — a proxy, a load balancer, a captive portal.
  }
  return new ApiError(response.status, {
    code: 'unexpected_response',
    message: `Request failed with status ${response.status}`,
  });
};

/**
 * Issues one API request, refreshing at most once, and returns the raw Response.
 *
 * Every request in the app goes through here, so the refresh-once rule and the
 * error translation have exactly one implementation to be correct in.
 */
const sendRequest = async (path: string, options: RequestOptions): Promise<Response> => {
  const attempt = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  };

  let response: Response;
  try {
    response = await attempt(options.anonymous ? null : getAccessToken());
  } catch (error) {
    throw toApiError(error);
  }

  // One refresh, one retry. A second 401 after a successful refresh means the
  // token is not the problem, and retrying again would be exactly the refresh
  // loop this design exists to prevent.
  if (response.status === 401 && !options.anonymous) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      // The refresh token is spent, so the session is genuinely over. Telling
      // the store is what makes the router send the user to /login instead of
      // leaving them on a page whose every query now fails.
      notifySignedOut();
      throw new ApiError(401, { code: 'unauthenticated', message: 'Your session has expired' });
    }

    try {
      response = await attempt(refreshed);
    } catch (error) {
      throw toApiError(error);
    }

    if (response.status === 401) {
      // A 401 *after* a successful refresh means the access token was not the
      // problem. Retrying again is exactly the loop this design prevents.
      clearTokens();
      notifySignedOut();
      throw new ApiError(401, { code: 'unauthenticated', message: 'Your session has expired' });
    }
  }

  if (!response.ok) throw await parseError(response);
  return response;
};

/**
 * Parses a response that is either empty or `{ data: T }`.
 *
 * The 204 case is handled explicitly: calling `.json()` on an empty body throws
 * a SyntaxError, which is the most common reason a successful DELETE looks like
 * a failure in the console.
 */
const readData = async <T>(response: Response): Promise<{ data: T }> => {
  if (response.status === 204) return { data: undefined as T };
  if (response.headers.get('content-length') === '0') return { data: undefined as T };
  return (await response.json()) as { data: T };
};

/**
 * Parses a paginated response: `{ data: T[], pageInfo }`.
 *
 * This exists as a separate reader rather than reusing `readData` because
 * `pageInfo` is what tells a list view whether a "next" control should render.
 * A helper that returned only `data` would type-check while silently dropping
 * that, and the pagination would look like it worked until there was a second
 * page to fetch.
 */
const readPage = async <T>(response: Response): Promise<{ data: T[]; pageInfo: PageInfo }> => {
  if (response.status === 204) return { data: [], pageInfo: EMPTY_PAGE };
  const body = (await response.json()) as { data: T[]; pageInfo: PageInfo };
  return { data: body.data, pageInfo: body.pageInfo };
};

/** For endpoints returning a single resource, or a bare `{ data: T[] }` array. */
export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<{ data: T }> =>
  readData<T>(await sendRequest(path, options));

/** For endpoints returning a paginated collection. */
export const apiList = async <T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T[]; pageInfo: PageInfo }> =>
  readPage<T>(await sendRequest(path, options));

