import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectApi, type ProjectQuery } from '../api/endpoints';
import { queryKeys } from '../api/query-keys';
import type { ProjectMemberRole } from '../api/types';

/**
 * Server state only.
 *
 * These hooks exist so no component ever calls `useEffect` + `useState` to fetch
 * anything. That pattern is where the bugs live: it re-fetches on every render
 * without a dependency array, cannot dedupe two components asking for the same
 * project, and leaves the previous page's data on screen while the next loads
 * with no way to say so. TanStack Query handles all three, and `placeholderData`
 * gives the "keep showing the old list while the new one loads" behaviour
 * without a flag.
 */

export const useProjects = (query: ProjectQuery = {}) =>
  useQuery({
    queryKey: queryKeys.projects.list({ status: query.status ?? 'active', search: query.search ?? '' }),
    queryFn: ({ signal }) => projectApi.list(query, signal).then((page) => page.data),
  });

export const useProject = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? 'none'),
    queryFn: ({ signal }) => projectApi.get(projectId as string, signal).then((result) => result.data),
    enabled: Boolean(projectId),
  });

export const useBoard = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.projects.board(projectId ?? 'none'),
    queryFn: ({ signal }) => projectApi.board(projectId as string, signal).then((result) => result.data),
    enabled: Boolean(projectId),
  });

export const useMembers = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.projects.members(projectId ?? 'none'),
    queryFn: ({ signal }) => projectApi.members(projectId as string, signal).then((page) => page.data),
    enabled: Boolean(projectId),
  });

export const useActivity = (projectId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.projects.activity(projectId ?? 'none'),
    queryFn: ({ signal }) => projectApi.activity(projectId as string, signal).then((page) => page.data),
    enabled: Boolean(projectId),
  });

/**
 * Invalidates a project and everything nested under it.
 *
 * One call rather than four: a new task changes the task list, the board, the
 * project counts and the activity log, and the component that added it does not
 * know which of those are on screen. `projects.detail` covers all of them because
 * the keys are hierarchical.
 */
export const useInvalidateProject = (projectId: string | undefined) => {
  const client = useQueryClient();
  return () => {
    if (!projectId) return;
    void client.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  };
};

export const useCreateProject = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: projectApi.create,
    // The list is refetched rather than patched in. A new project changes the
    // list's total and the counts on every card, and the server is the only
    // place those are computed correctly.
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.projects.all }),
  });
};

export const useUpdateProject = (projectId: string | undefined) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; description?: string; status?: 'active' | 'archived' }) =>
      projectApi.update(projectId as string, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId ?? 'none') });
      void client.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
};

/**
 * Archiving is its own mutation rather than a call to `useUpdateProject` with a
 * literal status, so the caller cannot archive by accident and the intent reads
 * at the call site.
 */
export const useArchiveProject = (projectId: string | undefined) => {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: () => projectApi.update(projectId as string, { status: 'archived' }),
    onSuccess: invalidate,
  });
};

export const useAddMember = (projectId: string | undefined) => {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: (body: { email: string; role: Exclude<ProjectMemberRole, 'owner'> }) =>
      projectApi.addMember(projectId as string, body),
    onSuccess: invalidate,
  });
};

export const useChangeMemberRole = (projectId: string | undefined) => {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: (input: { userId: string; role: Exclude<ProjectMemberRole, 'owner'> }) =>
      projectApi.changeMemberRole(projectId as string, input.userId, input.role),
    onSuccess: invalidate,
  });
};

export const useRemoveMember = (projectId: string | undefined) => {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: (userId: string) => projectApi.removeMember(projectId as string, userId),
    onSuccess: invalidate,
  });
};
