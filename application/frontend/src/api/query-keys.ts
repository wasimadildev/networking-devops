/**
 * Every TanStack Query key, in one place.
 *
 * Keys are the cache's primary key, so a typo in a key is a silent bug: the
 * query succeeds, writes to a cache nothing reads, and the UI shows a spinner
 * forever. Collecting them means a key can be imported rather than retyped, and
 * invalidation can be expressed as "everything under projects" instead of a
 * hand-copied string.
 *
 * The shape is hierarchical so a mutation can invalidate a whole branch:
 * `['projects']` covers the list and every project detail beneath it.
 */
export const queryKeys = {
  session: ['session'] as const,

  projects: {
    all: ['projects'] as const,
    list: (query: { status?: string; search?: string }) => ['projects', 'list', query] as const,
    detail: (projectId: string) => ['projects', 'detail', projectId] as const,
    board: (projectId: string) => ['projects', 'detail', projectId, 'board'] as const,
    tasks: (projectId: string, query: Record<string, unknown>) =>
      ['projects', 'detail', projectId, 'tasks', query] as const,
    members: (projectId: string) => ['projects', 'detail', projectId, 'members'] as const,
    activity: (projectId: string) => ['projects', 'detail', projectId, 'activity'] as const,
  },

  task: {
    detail: (taskId: string) => ['tasks', 'detail', taskId] as const,
    comments: (taskId: string) => ['tasks', 'detail', taskId, 'comments'] as const,
  },

  me: ['users', 'me'] as const,
  userSearch: (term: string) => ['users', 'search', term] as const,
} as const;
