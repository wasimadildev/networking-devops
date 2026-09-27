import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { requireProjectAccess, roleAtLeast } from '../../shared/authorization.js';
import { logActivity } from '../activity/activity.repository.js';
import { findTaskById } from '../tasks/task.repository.js';
import {
  deleteComment,
  findCommentById,
  insertComment,
  listComments,
  updateCommentBody,
  type CommentRecord,
} from './comment.repository.js';
import type { CreateCommentBody, ListCommentsQuery, UpdateCommentBody } from './comment.schemas.js';

/**
 * Comments inherit the authorisation boundary of the task's project. There is no
 * separate permission model, which means one rule to reason about instead of
 * two that can drift apart.
 */
const resolveProjectForTask = async (taskId: string): Promise<string> => {
  const task = await findTaskById(taskId);
  if (!task) throw new NotFoundError('Task');
  return task.projectId;
};

export const getTaskComments = async (
  userId: string,
  taskId: string,
  query: ListCommentsQuery,
): Promise<CommentRecord[]> => {
  const projectId = await resolveProjectForTask(taskId);
  await requireProjectAccess(userId, projectId, 'viewer');
  return listComments(taskId, query);
};

export const createComment = async (
  userId: string,
  taskId: string,
  body: CreateCommentBody,
): Promise<CommentRecord> => {
  const projectId = await resolveProjectForTask(taskId);
  // Any member may comment, including a viewer. Reading and commenting are
  // different acts; a read-only project that cannot record a question is a
  // project nobody uses.
  await requireProjectAccess(userId, projectId, 'viewer');

  const comment = await insertComment({ taskId, authorId: userId, body: body.body });

  await logActivity({
    actorId: userId,
    projectId,
    entityType: 'comment',
    entityId: comment.id,
    action: 'comment.created',
    metadata: { taskId },
  });

  return comment;
};

/**
 * Only the author may edit their own comment, regardless of project role. An
 * editor who can rewrite another person's words is a governance problem, not a
 * feature — so the check is identity, not permission level.
 */
export const updateComment = async (
  userId: string,
  commentId: string,
  body: UpdateCommentBody,
): Promise<CommentRecord> => {
  const comment = await findCommentById(commentId);
  if (!comment) throw new NotFoundError('Comment');

  const projectId = await resolveProjectForTask(comment.taskId);
  await requireProjectAccess(userId, projectId, 'viewer');

  // Identity, not role. An editor who can rewrite another person's words is a
  // governance problem, so even a project owner cannot edit someone else's
  // comment — they can delete it, which is the auditable alternative.
  if (comment.authorId !== userId) {
    throw new ForbiddenError('You can only edit your own comments');
  }

  const updated = await updateCommentBody(commentId, body.body);
  if (!updated) throw new NotFoundError('Comment');
  return updated;
};

export const removeComment = async (userId: string, commentId: string): Promise<{ deleted: true }> => {
  const comment = await findCommentById(commentId);
  if (!comment) throw new NotFoundError('Comment');

  const projectId = await resolveProjectForTask(comment.taskId);
  const access = await requireProjectAccess(userId, projectId, 'viewer');

  // The author may always delete. A moderator (editor or above) may delete
  // anyone's. That is the same shape as a code review or a ticket system, and it
  // gives projects a way to clean up abuse without removing write access.
  const isAuthor = comment.authorId === userId;
  if (!isAuthor && !roleAtLeast(access.role, 'editor')) {
    throw new ForbiddenError('You can only delete your own comments');
  }

  const deleted = await deleteComment(commentId);
  if (!deleted) throw new NotFoundError('Comment');

  await logActivity({
    actorId: userId,
    projectId,
    entityType: 'comment',
    entityId: commentId,
    action: 'comment.deleted',
    metadata: { taskId: comment.taskId, wasAuthor: isAuthor },
  });

  return { deleted: true as const };
};
