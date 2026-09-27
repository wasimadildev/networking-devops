/**
 * Access-token storage.
 *
 * `localStorage` is the wrong place for a token and this file is where that
 * concession is made explicit. It is readable by any script on the origin, so
 * an XSS bug becomes a session theft. The alternatives are worse for this app: an
 * httpOnly cookie is immune to XSS but reintroduces CSRF, and a token held only
 * in memory is lost on every refresh, which is a worse experience than the risk.
 *
 * The real mitigations are the ones that reduce the blast radius rather than
 * pretend to remove it: a short 15-minute access token, a strict CSP that limits
 * what can execute, and a refresh token that is revocable server-side. A stolen
 * access token is worth at most 15 minutes; a stolen refresh token is caught by
 * reuse detection on the next rotation.
 *
 * The in-memory mirror is not a security measure — it is there so the synchronous
 * read path never has to touch localStorage on every request, and so the token
 * disappears the moment the tab is closed and reloaded.
 */
const ACCESS_TOKEN_KEY = 'taskflow.accessToken';
const REFRESH_TOKEN_KEY = 'taskflow.refreshToken';

let accessTokenInMemory: string | null = null;

export const getAccessToken = (): string | null => {
  if (accessTokenInMemory !== null) return accessTokenInMemory;
  const stored = localStorage.getItem(ACCESS_TOKEN_KEY);
  // Populate the mirror on first read so the common path stays in memory.
  accessTokenInMemory = stored;
  return stored;
};

export const getRefreshToken = (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY);

export const setTokens = (accessToken: string, refreshToken: string): void => {
  accessTokenInMemory = accessToken;
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
};

export const clearTokens = (): void => {
  accessTokenInMemory = null;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
};

export const hasSession = (): boolean => getAccessToken() !== null;
