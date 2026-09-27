import { useSyncExternalStore } from 'react';
import { setSessionEndedHandler } from '../api/client';
import { authApi } from '../api/endpoints';
import type { User } from '../api/types';

/**
 * The signed-in user, held outside React.
 *
 * Two reasons this is not `useState` in a provider:
 *
 * 1. The API client needs to know when the session ends — to stop retrying and
 *    redirect to login — and it is not a component. A context value cannot reach
 *    it without importing a React hook into the transport layer, which would make
 *    the API client unusable without a renderer.
 * 2. Boot is asynchronous. Restoring a session means awaiting a token refresh
 *    before the first render can choose between "show the app" and "show the
 *    login page". With `useEffect` + `setState` that flashes the login screen on
 *    every reload, and the usual fix is an `isLoading` flag threaded through every
 *    component. An external store read through `useSyncExternalStore` makes the
 *    three states — restoring, signed out, signed in — explicit, and makes it
 *    impossible to render them out of order.
 */
export type SessionStatus = 'restoring' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: User | null;
}

let state: SessionState = { status: 'restoring', user: null };

const listeners = new Set<() => void>();

const setSession = (next: SessionState): void => {
  state = next;
  for (const listener of listeners) listener();
};

export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getSession = (): SessionState => state;

/**
 * Runs once per page load.
 *
 * Memoised on a module-level promise rather than called from an effect. React 19
 * invokes effects twice in development, and every call rotates the refresh token,
 * so an unguarded second call would present an already-rotated token — which the
 * server correctly treats as a replay and answers by revoking the whole family.
 * A shared promise makes the duplicate call a no-op instead of a logout.
 */
let restoreInFlight: Promise<void> | null = null;

export const restoreSession = (): Promise<void> => {
  restoreInFlight ??= (async () => {
    try {
      const user = await authApi.restore();
      setSession(user ? { status: 'authenticated', user } : { status: 'anonymous', user: null });
    } catch {
      // An API that is unreachable at boot must land on the login page, not on an
      // error screen with nothing the user can do. The transport already logged
      // the cause with a request id.
      setSession({ status: 'anonymous', user: null });
    }
  })();
  return restoreInFlight;
};

export const signIn = (user: User): void => {
  restoreInFlight = null;
  setSession({ status: 'authenticated', user });
};

export const signOut = (): void => {
  restoreInFlight = null;
  setSession({ status: 'anonymous', user: null });
};

// The transport reports an unrecoverable 401 here. Registered at module scope so
// it is installed before any component can fire a request.
setSessionEndedHandler(signOut);

export const useSession = (): SessionState => useSyncExternalStore(subscribe, getSession, getSession);
