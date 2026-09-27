import { z } from 'zod';

export const commentIdParamSchema = z.object({ commentId: z.uuid('commentId must be a uuid') });
export const taskCommentParamSchema = z.object({ taskId: z.uuid('taskId must be a uuid') });

export const createCommentBodySchema = z
  .object({
    body: z.string().trim().min(1, 'Comment cannot be empty').max(4000, 'Comment is too long'),
  })
  .strict();

export const updateCommentBodySchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
  })
  .strict();

export const listCommentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Oldest first: a comment thread is read top to bottom, not newest first. */
  order: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateCommentBody = z.infer<typeof createCommentBodySchema>;
export type UpdateCommentBody = z.infer<typeof updateCommentBodySchema>;
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;
