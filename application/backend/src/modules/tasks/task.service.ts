import { BadRequestError, NotFoundError, UnprocessableError } from '../../shared/errors.js';
import { buildPage, type Page } from '../../shared/pagination.js';
import { requireProjectAccess } from '../../shared/authorization.js';
import { childLogger } from '../../shared/logger.js';
import { logActivity } from '../activity/activity.repository.js';
import { findUserById } from '../users/user.repository.js';
import {
  deleteTask,
  findTaskById,
  insertTask,
  isMemberOfProject,
  listTasks,
  listTasksForBoard,
  updateTaskFields,
  type TaskRecord,
} from './task.repository.js';
import type { CreateTaskBody, ListTasksQuery, MoveTaskBody, UpdateTaskBody } from './task.schemas.js';

const log = childLogger('tasks.service');

/**
 * Loads a task and proves the caller may see it, in that order.
 *
 * The task is fetched first because the project id lives on the task, and that
 * is what authorisation is checked against. Returning 404 for a task in a
 * project the caller cannot read is deliberate: a 403 would confirm the task id
 * is real, which is exactly the enumeration this app is supposed to prevent.
 */
const loadAuthorisedTask = async (
  userId: string,
  taskId: string,
  minRole: 'viewer' | 'editor' = 'viewer',
): Promise<TaskRecord> => {
  const task = await findTaskById(taskId);
  if (!task) throw new NotFoundError('Task');

  await requireProjectAccess(userId, task.projectId, minRole);
  return task;
};

export const listProjectTasks = async (
  userId: string,
  projectId: string,
  query: ListTasksQuery,
): Promise<Page<TaskRecord>> => {
  await requireProjectAccess(userId, projectId, 'viewer');

  const effective: ListTasksQuery = {
    ...query,
    // `assignedToMe` is replaced with the caller's own id here rather than in the
    // repository. The client never supplies the id, so there is no way to read
    // another user's assigned tasks.
    assigneeId: query.assignedToMe ? userId : query.assigneeId,
  };

  const { rows, limit } = await listTasks(projectId, effective);
  return buildPage(rows, limit);
};

export const getTask = async (userId: string, taskId: string): Promise<TaskRecord> =>
  loadAuthorisedTask(userId, taskId, 'viewer');

export interface TaskBoard {
  todo: TaskRecord[];
  in_progress: TaskRecord[];
  done: TaskRecord[];
}

export const getProjectBoard = async (userId: string, projectId: string): Promise<TaskBoard> => {
  await requireProjectAccess(userId, projectId, 'viewer');
  const tasks = await listTasksForBoard(projectId);

  return {
    todo: tasks.filter((task) => task.status === 'todo'),
    in_progress: tasks.filter((task) => task.status === 'in_progress'),
    done: tasks.filter((task) => task.status === 'done'),
  };
};

/**
 * An assignee who is not a member of the project would see the task name and
 * nothing else — a broken promise. Membership is verified before assignment
 * rather than at read time, so the bad state is never created.
 */
const assertAssigneeIsMember = async (projectId: string, assigneeId: string | null): Promise<void> => {
  if (assigneeId === null) return;
  if (await isMemberOfProject(projectId, assigneeId)) return;

  const user = await findUserById(assigneeId);
  throw new UnprocessableError(
    user ? `${user.displayName} is not a member of this project` : 'Assignee not found',
  );
};

export const createTask = async (
  userId: string,
  projectId: string,
  body: CreateTaskBody,
): Promise<TaskRecord> => {
  await requireProjectAccess(userId, projectId, 'editor');
  await assertAssigneeIsMember(projectId, body.assigneeId ?? null);

  const dueAt = body.dueAt ? new Date(body.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    throw new BadRequestError('dueAt is not a valid date');
  }

  const task = await insertTask({
    projectId,
    title: body.title,
    description: body.description ?? null,
    status: body.status,
    priority: body.priority,
    assigneeId: body.assigneeId ?? null,
    createdBy: userId,
    dueAt,
  });

  await logActivity({
    actorId: userId,
    projectId,
    entityType: 'task',
    entityId: task.id,
    action: 'task.created',
    metadata: { title: task.title, status: task.status, priority: task.priority },
  });

  log.info({ taskId: task.id, projectId }, 'task created');
  return task;
};

/**
 * PATCH semantics need care around null. "Field absent" and "field cleared" are
 * different instructions, and `Object.hasOwn` is what tells them apart. A plain
 * `!== undefined` check would make it impossible to remove an assignee or a due
 * date, which is a real and commonly-shipped bug.
 */
export const updateTask = async (
  userId: string,
  taskId: string,
  body: UpdateTaskBody,
): Promise<TaskRecord> => {
  const existing = await loadAuthorisedTask(userId, taskId, 'editor');

  if (Object.hasOwn(body, 'assigneeId')) {
    await assertAssigneeIsMember(existing.projectId, body.assigneeId ?? null);
  }

  const fields: Parameters<typeof updateTaskFields>[1] = {};
  if (Object.hasOwn(body, 'title')) fields.title = body.title;
  if (Object.hasOwn(body, 'description')) fields.description = body.description ?? null;
  if (Object.hasOwn(body, 'status')) fields.status = body.status;
  if (Object.hasOwn(body, 'priority')) fields.priority = body.priority;
  if (Object.hasOwn(body, 'assigneeId')) fields.assigneeId = body.assigneeId ?? null;
  if (Object.hasOwn(body, 'dueAt')) fields.dueAt = body.dueAt ? new Date(body.dueAt) : null;
  if (Object.hasOwn(body, 'position')) fields.position = body.position;

  const updated = await updateTaskFields(taskId, fields);
  if (!updated) throw new NotFoundError('Task');

  // Separate activity rows for status and assignment, because "moved the card"
  // and "assigned it to Grace" are different facts in a project timeline.
  if (fields.status !== undefined && fields.status !== existing.status) {
    await logActivity({
      actorId: userId,
      projectId: existing.projectId,
      entityType: 'task',
      entityId: taskId,
      action: 'task.status_changed',
      metadata: { from: existing.status, to: fields.status },
    });
  }
  if (Object.hasOwn(fields, 'assigneeId') && fields.assigneeId !== existing.assigneeId) {
    await logActivity({
      actorId: userId,
      projectId: existing.projectId,
      entityType: 'task',
      entityId: taskId,
      action: 'task.assigned',
      metadata: { from: existing.assigneeId, to: fields.assigneeId },
    });
  }
  if (fields.status === undefined && fields.assigneeId === undefined) {
    await logActivity({
      actorId: userId,
      projectId: existing.projectId,
      entityType: 'task',
      entityId: taskId,
      action: 'task.updated',
      metadata: { fields: Object.keys(fields) },
    });
  }

  return updated;
};

/** Drag-and-drop: status and board position change together, in one write. */
export const moveTask = async (
  userId: string,
  taskId: string,
  body: MoveTaskBody,
): Promise<TaskRecord> => {
  const existing = await loadAuthorisedTask(userId, taskId, 'editor');

  const updated = await updateTaskFields(taskId, {
    status: body.status,
    position: body.position,
  });
  if (!updated) throw new NotFoundError('Task');

  if (body.status !== existing.status) {
    await logActivity({
      actorId: userId,
      projectId: existing.projectId,
      entityType: 'task',
      entityId: taskId,
      action: 'task.status_changed',
      metadata: { from: existing.status, to: body.status },
    });
  }

  return updated;
};

export const removeTask = async (userId: string, taskId: string): Promise<{ deleted: true }> => {
  const existing = await loadAuthorisedTask(userId, taskId, 'editor');

  const deleted = await deleteTask(taskId);
  if (!deleted) throw new NotFoundError('Task');

  await logActivity({
    actorId: userId,
    projectId: existing.projectId,
    entityType: 'task',
    entityId: taskId,
    action: 'task.deleted',
    metadata: { title: existing.title },
  });

  log.info({ taskId, projectId: existing.projectId }, 'task deleted');
  return { deleted: true as const };
};
