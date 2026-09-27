import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession, restoreSession, signIn, signOut, subscribe, useSession } from './session-store';
import type { User } from '../api/types';

const user: User = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@taskflow.test',
  displayName: 'Owner',
  role: 'member',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const sessionBody = (accessToken: string, refreshToken: string) => ({
  data: { accessToken, refreshToken, user },
});

describe('session store', () => {
  beforeEach(() => {
    // The store is module-level, and its in-flight promise is memoised, so a
    // restore started by one test would otherwise be reused by the next.
    signOut();
  });

  it('starts in the restoring state, never anonymous', async () => {
    // The initial state matters: a store that began as 'anonymous' would bounce
    // a signed-in user to /login before the first refresh had a chance to run.
    //
    // Asserted against a fresh module instance, because the suite's beforeEach
    // calls signOut() — which is exactly the 'anonymous' state being ruled out.
    vi.resetModules();
    const fresh = await import('./session-store');
    expect(fresh.getSession().status).toBe('restoring');
  });

  it('becomes authenticated when boot returns a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(sessionBody('access-1', 'refresh-1'))),
    );

    await restoreSession();

    expect(getSession()).toEqual({ status: 'authenticated', user });
  });

  it('persists the rotated tokens from the boot refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(sessionBody('access-rotated', 'refresh-rotated'))),
    );

    await restoreSession();

    expect(window.localStorage.getItem('taskflow.accessToken')).toBe('access-rotated');
    expect(window.localStorage.getItem('taskflow.refreshToken')).toBe('refresh-rotated');
  });

  it('becomes anonymous and clears tokens when the refresh is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'unauthenticated', message: 'nope' } }, 401)),
    );
    window.localStorage.setItem('taskflow.refreshToken', 'stale');

    await restoreSession();

    expect(getSession().status).toBe('anonymous');
    expect(window.localStorage.getItem('taskflow.refreshToken')).toBeNull();
  });

  it('becomes anonymous rather than throwing when the API is unreachable', async () => {
    // A server that is down at boot must land on the login page. Throwing here
    // would leave a blank screen with no way forward.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(restoreSession()).resolves.toBeUndefined();
    expect(getSession().status).toBe('anonymous');
  });

  it('refreshes once even when called repeatedly', async () => {
    // React 19 double-invokes effects in development. Two boot refreshes would
    // rotate the token twice, and the second presents an already-used token —
    // which the server treats as a replay and answers by revoking the family.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionBody('access', 'refresh')));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([restoreSession(), restoreSession()]);
    await restoreSession();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows a new restore after signing out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionBody('access', 'refresh')));
    vi.stubGlobal('fetch', fetchMock);

    await restoreSession();
    signOut();
    await restoreSession();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('notifies subscribers on every state change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    signIn(user);
    expect(listener).toHaveBeenCalledTimes(1);

    signOut();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    signIn(user);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('exposes the session to React through useSession', () => {
    // The hook is a thin wrapper over getSession/subscribe; asserting it exists
    // keeps the public surface honest without mounting a component.
    expect(typeof useSession).toBe('function');
  });
});
