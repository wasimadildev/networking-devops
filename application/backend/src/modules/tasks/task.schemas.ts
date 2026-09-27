import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/pagination.js';

export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const taskIdParamSchema = z.object({ taskId: z.uuid('taskId must be a uuid') });
export const projectTaskParamSchema = z.object({ projectId: z.uuid('projectId must be a uuid') });

export const createTaskBodySchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
    description: z.string().trim().max(4000, 'Description is too long').nullish(),
    status: taskStatusSchema.default('todo'),
    priority: taskPrioritySchema.default('medium'),
    assigneeId: z.uuid('assigneeId must be a uuid').nullish(),
    dueAt: z.iso.datetime({ offset: true }).nullish(),
  })
  .strict();

/**
 * Every field optional, because a PATCH that changes one column should not have
 * to resend the rest. The service distinguishes "absent" from "null" using the
 * key's presence, not its value — otherwise clearing a description would be
 * indistinguishable from not touching it.
 */
export const updateTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).nullish(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeId: z.uuid().nullish(),
    dueAt: z.iso.datetime({ offset: true }).nullish(),
    position: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const moveTaskBodySchema = z
  .object({
    status: taskStatusSchema,
    position: z.number().int().min(0).max(1_000_000),
  })
  .strict();

export const listTasksQuerySchema = z
  .object({
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeId: z.uuid().optional(),
    /** `me` is resolved server-side, so the client cannot read someone else's tasks by lying. */
    assignedToMe: z.coerce.boolean().optional(),
    /** Set when a task's due_at is in the past and it is not done. */
    overdue: z.coerce.boolean().optional(),
    search: z.string().trim().max(200).optional(),
    limit: paginationQuerySchema.shape.limit,
    cursor: paginationQuerySchema.shape.cursor,
  })
  .strict();

export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskBodySchema>;
export type MoveTaskBody = z.infer<typeof moveTaskBodySchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
