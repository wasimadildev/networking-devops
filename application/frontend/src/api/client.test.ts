import { describe, expect, it, vi } from 'vitest';
import { apiList, apiRequest } from './client';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

const fetchMock = () => {
  const mock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', mock);
  return mock;
};

describe('apiRequest', () => {
  it('returns the data envelope', async () => {
    fetchMock().mockResolvedValue(jsonResponse({ data: { id: '1', name: 'TaskFlow' } }));

    await expect(apiRequest<{ id: string }>('/api/v1/projects/1')).resolves.toEqual({
      data: { id: '1', name: 'TaskFlow' },
    });
  });

  it('returns undefined data for a 204 rather than throwing on json()', async () => {
    // Calling .json() on an empty body throws a SyntaxError, which is the usual
    // reason a successful DELETE appears to fail in the console.
    fetchMock().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiRequest<void>('/api/v1/tasks/1', { method: 'DELETE' })).resolves.toEqual({
      data: undefined,
    });
  });

  it('returns undefined for a 200 with a zero-length body', async () => {
    fetchMock().mockResolvedValue(
      new Response(null, { status: 200, headers: { 'Content-Length': '0' } }),
    );

    await expect(apiRequest<void>('/api/v1/thing')).resolves.toEqual({ data: undefined });
  });

  it('throws an ApiError carrying the server code and request id', async () => {
    fetchMock().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'not_found',
            message: 'Task not found',
            requestId: 'abc-123',
          },
        },
        { status: 404 },
      ),
    );

    const error = await apiRequest('/api/v1/tasks/missing').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Task not found', requestId: 'abc-123' });
  });

  it('turns a fetch TypeError into a network error', async () => {
    fetchMock().mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await apiRequest('/api/v1/projects').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 0, code: 'network_error' });
  });
});

describe('apiList', () => {
  it('parses both data and pageInfo', async () => {
    // Regression test. This helper used to cast the raw Response to
    // `{ data, pageInfo }` and return it without parsing, so every list call
    // handed components a Response object: `data.length` was undefined and the
    // list rendered empty while the network tab showed a success.
    fetchMock().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'a' }, { id: 'b' }],
        pageInfo: { hasNextPage: true, nextCursor: 'next-token' },
      }),
    );

    const page = await apiList<{ id: string }>('/api/v1/projects');

    expect(page.data).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(page.pageInfo).toEqual({ hasNextPage: true, nextCursor: 'next-token' });
  });

  it('reports the last page as having no next cursor', async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ data: [{ id: 'a' }], pageInfo: { hasNextPage: false, nextCursor: null } }),
    );

    const page = await apiList<{ id: string }>('/api/v1/projects');

    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.pageInfo.nextCursor).toBeNull();
  });

  it('serialises query parameters and drops undefined ones', async () => {
    const mock = fetchMock();
    mock.mockResolvedValue(jsonResponse({ data: [], pageInfo: { hasNextPage: false, nextCursor: null } }));

    await apiList('/api/v1/projects', { query: { status: 'active', search: undefined, limit: 20 } });

    const url = mock.mock.calls[0][0] as string;
    expect(url).toContain('status=active');
    expect(url).toContain('limit=20');
    expect(url).not.toContain('search');
  });

  it('attaches the access token when one is stored', async () => {
    const mock = fetchMock();
    mock.mockResolvedValue(jsonResponse({ data: [], pageInfo: { hasNextPage: false, nextCursor: null } }));

    window.localStorage.setItem('taskflow.accessToken', 'stored-access');
    await apiList('/api/v1/projects');

    const headers = (mock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer stored-access');
  });

  it('omits the Authorization header for an anonymous request', async () => {
    // Login must not send a stale token: the server would reject a refresh
    // against it rather than treating the request as a fresh sign-in.
    const mock = fetchMock();
    mock.mockResolvedValue(jsonResponse({ data: { accessToken: 'a' } }));

    window.localStorage.setItem('taskflow.accessToken', 'stale');
    await apiRequest('/api/v1/auth/login', { method: 'POST', anonymous: true });

    const headers = (mock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});
