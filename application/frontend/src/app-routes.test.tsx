import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './app-routes';
import { signIn, signOut } from './auth/session-store';
import type { Project } from './api/types';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@taskflow.test',
  displayName: 'Owner',
  role: 'member' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
};

const project: Project = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Networking',
  slug: 'networking',
  description: 'Azure landing zone work',
  ownerId: user.id,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  viewerRole: 'owner',
  memberCount: 2,
  taskCount: 10,
  openTaskCount: 4,
};

/** A client per test: a shared one would leak cached data between tests. */
const renderApp = (route: string) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const mockProjectsResponse = (projects: Project[], hasNextPage = false) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: projects, pageInfo: { hasNextPage, nextCursor: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
};

describe('routing guard', () => {
  beforeEach(() => {
    signOut();
  });

  it('shows a starting state rather than the login form while restoring', async () => {
    // The distinguishing failure: a guard that redirects during the restore
    // bounces a signed-in user to /login on every page load, because at first
    // render "not signed in" and "not yet known" look identical.
    //
    // `restoring` is the store's value at module load and is never re-entered
    // afterwards, so this has to render against a freshly imported module —
    // resetting the registry gives both the store and the routes new instances,
    // and the guard then sees exactly what it sees on a real cold load.
    vi.resetModules();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => undefined));

    const { AppRoutes: FreshRoutes } = await import('./app-routes');
    const { getSession: freshSession } = await import('./auth/session-store');
    expect(freshSession().status).toBe('restoring');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/projects']}>
          <FreshRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Starting TaskFlow')).toBeInTheDocument();
    expect(screen.queryByText('Sign in to TaskFlow')).not.toBeInTheDocument();
  });

  it('redirects an anonymous visitor to the login form', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => undefined));

    renderApp('/projects');

    expect(await screen.findByRole('heading', { name: /sign in to taskflow/i })).toBeInTheDocument();
  });

  it('sends a signed-in user away from the login form', () => {
    signIn(user);
    mockProjectsResponse([project]);

    renderApp('/login');

    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /sign in to taskflow/i })).not.toBeInTheDocument();
  });

  it('shows a not-found page for an unknown route', () => {
    signIn(user);

    renderApp('/nowhere');

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('project list states', () => {
  beforeEach(() => {
    signIn(user);
  });

  it('shows a loading state first', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => undefined));

    renderApp('/projects');

    expect(screen.getByRole('status')).toHaveTextContent('Loading projects');
  });

  it('shows an empty state, not a blank page, when there are no projects', async () => {
    // The bug this guards: an empty list and a failed request both render
    // nothing, so a user with an unreachable API is told to create a project
    // that already exists.
    mockProjectsResponse([]);

    renderApp('/projects');

    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
  });

  it('renders the projects it receives', async () => {
    mockProjectsResponse([project]);

    renderApp('/projects');

    expect(await screen.findByRole('link', { name: 'Networking' })).toBeInTheDocument();
    expect(screen.getByText('Azure landing zone work')).toBeInTheDocument();
  });

  it('shows an error state with a retry when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'internal_error', message: 'Something broke', requestId: 'req-9' } }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    renderApp('/projects');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something broke');
    // The correlation id is the one internal detail a user may see: it makes a
    // report matchable to a log line.
    expect(screen.getByText('req-9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('exposes the status filter as a pressed toggle, not a bare select', async () => {
    mockProjectsResponse([project]);
    const user_ = userEvent.setup();

    renderApp('/projects');
    await screen.findByRole('link', { name: 'Networking' });

    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Archived' })).toHaveAttribute('aria-pressed', 'false');

    await user_.click(screen.getByRole('button', { name: 'Archived' }));

    expect(await screen.findByRole('button', { name: 'Archived' })).toHaveAttribute('aria-pressed', 'true');
  });
});
