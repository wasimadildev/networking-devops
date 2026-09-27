import { queryMany, queryOne, type Queryable } from '../../db/pool.js';
import type { ListCommentsQuery } from './comment.schemas.js';

export interface CommentRecord {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CommentRow {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: Date;
  updated_at: Date;
}

const toComment = (row: CommentRow): CommentRecord => ({
  id: row.id,
  taskId: row.task_id,
  authorId: row.author_id,
  authorName: row.author_name,
  body: row.body,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COMMENT_COLUMNS = `
  c.id, c.task_id, c.author_id, u.display_name AS author_name,
  c.body, c.created_at, c.updated_at
`;

/**
 * Select list for a freshly written comment, aliasing the CTE rather than the
 * base table. Written out instead of produced by rewriting `c.` to `i.` with a
 * regex: a rewrite that misses the FROM clause yields SQL referencing a table
 * that is not there, and the failure only shows up at runtime.
 */
const INSERTED_COMMENT_COLUMNS = `
  i.id, i.task_id, i.author_id, u.display_name AS author_name,
  i.body, i.created_at, i.updated_at
`;

export const listComments = async (
  taskId: string,
  query: ListCommentsQuery,
  client?: Queryable,
): Promise<CommentRecord[]> => {
  // The sort direction is chosen from a two-value allowlist, never interpolated
  // from the request. `ORDER BY` cannot take a bound parameter, so an allowlist
  // is the only safe way to make it dynamic.
  const direction = query.order === 'desc' ? 'DESC' : 'ASC';

  const rows = await queryMany<CommentRow>(
    `SELECT ${COMMENT_COLUMNS}
       FROM comments c
       JOIN users u ON u.id = c.author_id
      WHERE c.task_id = $1
      ORDER BY c.created_at ${direction}, c.id ${direction}
      LIMIT $2`,
    [taskId, query.limit],
    client,
  );
  return rows.map(toComment);
};

export const findCommentById = async (id: string, client?: Queryable): Promise<CommentRecord | null> => {
  const row = await queryOne<CommentRow>(
    `SELECT ${COMMENT_COLUMNS} FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
    [id],
    client,
  );
  return row ? toComment(row) : null;
};

export const insertComment = async (
  input: { taskId: string; authorId: string; body: string },
  client?: Queryable,
): Promise<CommentRecord> => {
  const row = await queryOne<CommentRow>(
    `WITH inserted AS (
       INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3)
       RETURNING id, task_id, author_id, body, created_at, updated_at
     )
     SELECT ${INSERTED_COMMENT_COLUMNS}
       FROM inserted i JOIN users u ON u.id = i.author_id`,
    [input.taskId, input.authorId, input.body],
    client,
  );
  if (!row) throw new Error('comment insert returned no row');
  return toComment(row);
};

export const updateCommentBody = async (
  id: string,
  body: string,
  client?: Queryable,
): Promise<CommentRecord | null> => {
  const row = await queryOne<CommentRow>(
    `WITH updated AS (
       UPDATE comments SET body = $2 WHERE id = $1
       RETURNING id, task_id, author_id, body, created_at, updated_at
     )
     SELECT ${INSERTED_COMMENT_COLUMNS}
       FROM updated i JOIN users u ON u.id = i.author_id`,
    [id, body],
    client,
  );
  return row ? toComment(row) : null;
};

export const deleteComment = async (id: string, client?: Queryable): Promise<boolean> => {
  const row = await queryOne<{ id: string }>(`DELETE FROM comments WHERE id = $1 RETURNING id`, [id], client);
  return row !== null;
};
