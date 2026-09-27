import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commentApi, taskApi, type TaskQuery } from '../api/endpoints';
import { queryKeys } from '../api/query-keys';
import type { TaskPriority, TaskStatus } from '../api/types';

/** Tasks for a project, with the server's own filters. */
export const useTasks = (projectId: string | undefined, query: TaskQuery = {}) =>
  useQuery({
    queryKey: queryKeys.projects.tasks(projectId ?? 'none', { ...query }),
    queryFn: ({ signal }) => taskApi.list(projectId as string, query, signal).then((page) => page.data),
    enabled: Boolean(projectId),
  });

export const useTask = (taskId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.task.detail(taskId ?? 'none'),
    queryFn: ({ signal }) => taskApi.get(taskId as string, signal).then((result) => result.data),
    enabled: Boolean(taskId),
  });

export const useComments = (taskId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.task.comments(taskId ?? 'none'),
    queryFn: ({ signal }) => commentApi.list(taskId as string, signal).then((page) => page.data),
    enabled: Boolean(taskId),
  });

/**
 * A task write touches four caches: the board, the task list, the project's
 * counts, and the activity log. Invalidation is centralised here so no caller has
 * to know that list, and so a new mutation cannot forget one of them.
 */
const useInvalidateTaskWrites = (projectId: string | undefined) => {
  const client = useQueryClient();
  return () => {
    if (!projectId) return;
    void client.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  };
};

export const useCreateTask = (projectId: string | undefined) => {
  const invalidate = useInvalidateTaskWrites(projectId);
  return useMutation({
    mutationFn: (body: {
      title: string;
      description?: string;
      /** Omitted means the server's default of 'todo'. */
      status?: TaskStatus;
      priority?: TaskPriority;
      assigneeId?: string | null;
      dueAt?: string | null;
    }) => taskApi.create(projectId as string, body),
    onSuccess: invalidate,
  });
};

export const useUpdateTask = (projectId: string | undefined) => {
  const client = useQueryClient();
  const invalidate = useInvalidateTaskWrites(projectId);
  return useMutation({
    mutationFn: (input: {
      taskId: string;
      body: Partial<{
        title: string;
        description: string;
        status: TaskStatus;
        priority: TaskPriority;
        assigneeId: string | null;
        dueAt: string | null;
      }>;
    }) => taskApi.update(input.taskId, input.body),
    onSuccess: (_result, input) => {
      invalidate();
      // The task detail drawer holds its own copy, which the board invalidation
      // does not reach.
      void client.invalidateQueries({ queryKey: queryKeys.task.detail(input.taskId) });
    },
  });
};

export const useMoveTask = (projectId: string | undefined) => {
  const invalidate = useInvalidateTaskWrites(projectId);
  return useMutation({
    mutationFn: (input: { taskId: string; status: TaskStatus; position: number }) =>
      taskApi.move(input.taskId, { status: input.status, position: input.position }),
    onSuccess: invalidate,
  });
};

export const useDeleteTask = (projectId: string | undefined) => {
  const invalidate = useInvalidateTaskWrites(projectId);
  return useMutation({
    mutationFn: (taskId: string) => taskApi.remove(taskId),
    onSuccess: invalidate,
  });
};

export const useCreateComment = (projectId: string | undefined) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string; body: string }) => commentApi.create(input.taskId, { body: input.body }),
    onSuccess: (_result, input) => {
      // Comments change a task's commentCount, which the board renders.
      void client.invalidateQueries({ queryKey: queryKeys.task.comments(input.taskId) });
      void client.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId ?? 'none') });
    },
  });
};

export const useUpdateComment = (taskId: string | undefined) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { commentId: string; body: string }) => commentApi.update(input.commentId, { body: input.body }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.task.comments(taskId ?? 'none') }),
  });
};

export const useDeleteComment = (taskId: string | undefined) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => commentApi.remove(commentId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.task.comments(taskId ?? 'none') }),
  });
};
