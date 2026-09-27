import { queryMany, queryOne, type Queryable } from '../../db/pool.js';
import type { TaskPriority, TaskStatus } from '../auth/types.js';
import { decodeCursor } from '../../shared/pagination.js';
import { BadRequestError } from '../../shared/errors.js';
import type { ListTasksQuery } from './task.schemas.js';

export interface TaskRecord {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  createdBy: string;
  createdByName: string;
  dueAt: Date | null;
  position: number;
  completedAt: Date | null;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  assignee_name: string | null;
  created_by: string;
  created_by_name: string;
  due_at: Date | null;
  position: number;
  completed_at: Date | null;
  comment_count: string | number;
  created_at: Date;
  updated_at: Date;
}

const TASK_SELECT = `
  t.id, t.project_id, t.title, t.description, t.status, t.priority,
  t.assignee_id, assignee.display_name AS assignee_name,
  t.created_by, author.display_name AS created_by_name,
  t.due_at, t.position, t.completed_at, t.created_at, t.updated_at,
  (SELECT count(*) FROM comments c WHERE c.task_id = t.id) AS comment_count
`;

const TASK_JOINS = `
  FROM tasks t
  LEFT JOIN users assignee ON assignee.id = t.assignee_id
  JOIN users author ON author.id = t.created_by
`;

const toTask = (row: TaskRow): TaskRecord => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  assigneeId: row.assignee_id,
  assigneeName: row.assignee_name,
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  dueAt: row.due_at,
  position: row.position,
  completedAt: row.completed_at,
  commentCount: Number(row.comment_count),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const findTaskById = async (taskId: string, client?: Queryable): Promise<TaskRecord | null> => {
  const row = await queryOne<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_JOINS} WHERE t.id = $1`,
    [taskId],
    client,
  );
  return row ? toTask(row) : null;
};

/**
 * Board and list query.
 *
 * Filters accumulate as bound parameters in a fixed order. The only strings that
 * ever reach the SQL text are the ones written in this file — the filter values
 * are all `$n` — so adding a filter cannot open an injection even by accident.
 */
export const listTasks = async (
  projectId: string,
  query: ListTasksQuery,
  client?: Queryable,
): Promise<{ rows: TaskRecord[]; limit: number }> => {
  const limit = query.limit;
  const params: unknown[] = [projectId];
  const conditions = ['t.project_id = $1'];

  /**
   * Appends a bound parameter and returns its placeholder. Every filter value
   * in this function travels this path, so none of them can reach the SQL text.
   */
  const nextParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (query.status) conditions.push(`t.status = ${nextParam(query.status)}`);
  if (query.priority) conditions.push(`t.priority = ${nextParam(query.priority)}`);
  if (query.assigneeId) conditions.push(`t.assignee_id = ${nextParam(query.assigneeId)}`);

  // `assignedToMe` is resolved by the service into a real user id, so this
  // boolean never reaches SQL. Keeping the "who" and the "filter" as separate
  // concerns is what stops a client from asking for someone else's tasks.
  if (query.assignedToMe) conditions.push('t.assignee_id IS NOT NULL');

  if (query.overdue) {
    conditions.push('t.due_at < now()');
    conditions.push("t.status <> 'done'");
  }
  if (query.search) {
    const placeholder = nextParam(`%${query.search}%`);
    conditions.push(`(t.title ILIKE ${placeholder} OR t.description ILIKE ${placeholder})`);
  }

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw new BadRequestError('cursor is malformed');
  if (cursor) {
    const createdAtParam = nextParam(cursor.createdAt);
    const idParam = nextParam(cursor.id);
    // Tuple keyset comparison. An offset would drift as rows are inserted while
    // the client pages; this stays on the same row set.
    conditions.push(`(t.created_at, t.id) < (${createdAtParam}, ${idParam})`);
  }

  params.push(limit + 1);

  const rows = await queryMany<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_JOINS}
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${params.length}`,
    params,
    client,
  );

  return { rows: rows.map(toTask), limit };
};

/**
 * Board order is by position, not creation time — that is the difference between
 * a board and a feed. Ordering by the sparse `position` key means a single
 * UPDATE moves one card.
 */
export const listTasksForBoard = async (
  projectId: string,
  client?: Queryable,
): Promise<TaskRecord[]> => {
  const rows = await queryMany<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_JOINS}
      WHERE t.project_id = $1
      ORDER BY t.position ASC, t.created_at ASC`,
    [projectId],
    client,
  );
  return rows.map(toTask);
};

/**
 * The insert is written out in full rather than reusing TASK_SELECT through a
 * table-alias rewrite. An earlier version rewrote `t.` to `i.` with a regex,
 * which silently missed the bare `FROM tasks t` alias and produced SQL
 * referencing a table that was never in the FROM clause.
 *
 * All task columns come from the CTE's own RETURNING clause rather than by
 * joining `tasks` again. Every part of a data-modifying CTE sees the same
 * snapshot, so a join back to the table would not see the row the CTE just
 * inserted and the query would return nothing. Joining `users` is fine — those
 * rows already existed when the statement began.
 */
export const insertTask = async (
  input: {
    projectId: string;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeId: string | null;
    createdBy: string;
    dueAt: Date | null;
  },
  client?: Queryable,
): Promise<TaskRecord> => {
  const row = await queryOne<TaskRow>(
    `WITH inserted AS (
       INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, created_by, due_at, position)
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         COALESCE((SELECT max(position) + 1000 FROM tasks WHERE project_id = $1), 0)
       )
       RETURNING id, project_id, title, description, status, priority, assignee_id,
                 created_by, due_at, position, completed_at, created_at, updated_at
     )
     SELECT i.id, i.project_id, i.title, i.description, i.status, i.priority,
            i.assignee_id, assignee.display_name AS assignee_name,
            i.created_by, author.display_name AS created_by_name,
            i.due_at, i.position, i.completed_at, i.created_at, i.updated_at,
            (SELECT count(*) FROM comments c WHERE c.task_id = i.id) AS comment_count
       FROM inserted i
       LEFT JOIN users assignee ON assignee.id = i.assignee_id
       JOIN users author ON author.id = i.created_by`,
    [
      input.projectId,
      input.title,
      input.description,
      input.status,
      input.priority,
      input.assigneeId,
      input.createdBy,
      input.dueAt,
    ],
    client,
  );
  if (!row) throw new Error('task insert returned no row');
  return toTask(row);
};

/**
 * SET clause assembled from a fixed key set. Same reasoning as the project
 * update: the keys are literals in this file, the values are always parameters.
 */
export const updateTaskFields = async (
  taskId: string,
  fields: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeId?: string | null;
    dueAt?: Date | null;
    position?: number;
  },
  client?: Queryable,
): Promise<TaskRecord | null> => {
  const assignments: string[] = [];
  const params: unknown[] = [taskId];

  const add = (column: string, value: unknown) => {
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  };

  if (fields.title !== undefined) add('title', fields.title);
  if (fields.description !== undefined) add('description', fields.description);
  if (fields.status !== undefined) add('status', fields.status);
  if (fields.priority !== undefined) add('priority', fields.priority);
  if (fields.assigneeId !== undefined) add('assignee_id', fields.assigneeId);
  if (fields.dueAt !== undefined) add('due_at', fields.dueAt);
  if (fields.position !== undefined) add('position', fields.position);

  if (assignments.length === 0) return findTaskById(taskId, client);

  // Same snapshot rule as insertTask: the updated row comes from RETURNING, not
  // from a second read of `tasks` inside the same statement.
  const row = await queryOne<TaskRow>(
    `WITH updated AS (
       UPDATE tasks SET ${assignments.join(', ')} WHERE id = $1
       RETURNING id, project_id, title, description, status, priority, assignee_id,
                 created_by, due_at, position, completed_at, created_at, updated_at
     )
     SELECT u.id, u.project_id, u.title, u.description, u.status, u.priority,
            u.assignee_id, assignee.display_name AS assignee_name,
            u.created_by, author.display_name AS created_by_name,
            u.due_at, u.position, u.completed_at, u.created_at, u.updated_at,
            (SELECT count(*) FROM comments c WHERE c.task_id = u.id) AS comment_count
       FROM updated u
       LEFT JOIN users assignee ON assignee.id = u.assignee_id
       JOIN users author ON author.id = u.created_by`,
    params,
    client,
  );
  return row ? toTask(row) : null;
};

export const deleteTask = async (taskId: string, client?: Queryable): Promise<boolean> => {
  const row = await queryOne<{ id: string }>(
    `DELETE FROM tasks WHERE id = $1 RETURNING id`,
    [taskId],
    client,
  );
  return row !== null;
};

export const findPreviousAssignee = async (
  taskId: string,
  client?: Queryable,
): Promise<{ project_id: string; assignee_id: string | null; status: TaskStatus } | null> =>
  queryOne<{ project_id: string; assignee_id: string | null; status: TaskStatus }>(
    `SELECT project_id, assignee_id, status FROM tasks WHERE id = $1`,
    [taskId],
    client,
  );

export const isMemberOfProject = async (
  projectId: string,
  userId: string,
  client?: Queryable,
): Promise<boolean> => {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2) AS exists`,
    [projectId, userId],
    client,
  );
  return row?.exists ?? false;
};

export const countTasks = async (projectId: string, client?: Queryable): Promise<number> => {
  const row = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM tasks WHERE project_id = $1`,
    [projectId],
    client,
  );
  return Number(row?.count ?? 0);
};
