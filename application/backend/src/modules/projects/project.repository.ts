import { queryMany, queryOne, type Queryable } from '../../db/pool.js';
import type { ProjectMemberRole, ProjectStatus } from '../auth/types.js';
import { decodeCursor, type PaginationQuery } from '../../shared/pagination.js';
import { BadRequestError } from '../../shared/errors.js';
import type { ListProjectsQuery } from './project.schemas.js';

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  ownerId: string;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectListItem extends ProjectRecord {
  /** The caller's role in this project. Null means "not a member". */
  viewerRole: ProjectMemberRole | null;
  taskCount: number;
  openTaskCount: number;
}

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string;
  status: ProjectStatus;
  created_at: Date;
  updated_at: Date;
  viewer_role: ProjectMemberRole | null;
  task_count: string | number;
  open_task_count: string | number;
}

const PROJECT_COLUMNS = `
  p.id, p.name, p.slug, p.description, p.owner_id, p.status, p.created_at, p.updated_at
`;

/**
 * A RETURNING clause has no table alias, so the columns are listed again without
 * the `p.` prefix. Written out rather than derived by stripping it, so the two
 * lists can be read independently and a change to one is a visible decision
 * rather than a silent regex side effect.
 */
const PROJECT_RETURNING = 'id, name, slug, description, owner_id, status, created_at, updated_at';

const toProject = (row: ProjectRow): ProjectRecord => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  description: row.description,
  ownerId: row.owner_id,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Counts are fetched in the same query as the rows rather than in a second
 * round trip per project. The correlated subquery rides the projects index, so
 * it costs a lookup per row instead of a whole extra query per page.
 */
const withViewerContext = `
  ${PROJECT_COLUMNS},
  m.role AS viewer_role,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status <> 'done') AS open_task_count
`;

/**
 * Lists only projects the caller belongs to.
 *
 * The membership join is not an optimisation, it is the access control: there is
 * no code path that can produce a project list the caller is not a member of,
 * because the join is what defines the row set.
 */
export const listProjectsForUser = async (
  userId: string,
  query: ListProjectsQuery,
  client?: Queryable,
): Promise<{ rows: ProjectListItem[]; limit: number }> => {
  const limit = query.limit;
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw new BadRequestError('cursor is malformed');

  const params: unknown[] = [userId, query.status, limit + 1];
  const conditions = ['m.user_id = $1', 'p.status = $2'];

  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    // Keyset comparison. The row set is ordered by (created_at, id), and the
    // tuple comparison keeps the ordering stable even when two rows share a
    // timestamp — which an offset would silently mangle.
    conditions.push('(p.created_at, p.id) < ($3, $4)');
  }

  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
  }

  const rows = await queryMany<ProjectRow>(
    `SELECT ${withViewerContext}
       FROM projects p
       JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $${params.indexOf(limit + 1) + 1}`,
    params,
    client,
  );

  return {
    rows: rows.map((row) => ({
      ...toProject(row),
      viewerRole: row.viewer_role,
      taskCount: Number(row.task_count),
      openTaskCount: Number(row.open_task_count),
    })),
    limit,
  };
};

/**
 * Single-project read that carries the caller's role and the counts in one
 * round trip. The service needs all three, and fetching them separately would
 * mean three queries and a window where the numbers disagree with the project.
 */
export type ProjectWithViewerContext = ProjectRecord & {
  /** null when the caller is not a member; the service turns that into a 404. */
  viewerRole: ProjectMemberRole | null;
  memberCount: number;
  taskCount: number;
  openTaskCount: number;
};

export const findProjectWithViewerContext = async (
  projectId: string,
  viewerId: string,
  client?: Queryable,
): Promise<ProjectWithViewerContext | null> => {
  const row = await queryOne<ProjectRow & { member_count: string | number }>(
    `SELECT ${withViewerContext},
            (SELECT count(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count
       FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $2
      WHERE p.id = $1`,
    [projectId, viewerId],
    client,
  );

  if (!row) return null;

  return {
    ...toProject(row),
    viewerRole: row.viewer_role,
    memberCount: Number(row.member_count),
    taskCount: Number(row.task_count),
    openTaskCount: Number(row.open_task_count),
  };
};

export const findProjectById = async (
  projectId: string,
  client?: Queryable,
): Promise<ProjectRecord | null> => {
  const row = await queryOne<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.id = $1`,
    [projectId],
    client,
  );
  return row ? toProject(row) : null;
};

export const insertProject = async (
  input: { name: string; slug: string; description: string | null; ownerId: string },
  client?: Queryable,
): Promise<ProjectRecord> => {
  const row = await queryOne<ProjectRow>(
    `INSERT INTO projects (name, slug, description, owner_id)
     VALUES ($1, $2, $3, $4)
     RETURNING ${PROJECT_RETURNING}`,
    [input.name, input.slug, input.description, input.ownerId],
    client,
  );
  if (!row) throw new Error('project insert returned no row');
  return toProject(row);
};

export const updateProjectFields = async (
  projectId: string,
  fields: { name?: string; description?: string | null; status?: ProjectStatus },
  client?: Queryable,
): Promise<ProjectRecord | null> => {
  // The SET clause is built from a fixed key list. The values are always bound
  // parameters, and the keys can only come from this literal, so no caller
  // controlled text ever reaches the SQL string.
  const assignments: string[] = [];
  const params: unknown[] = [projectId];

  if (fields.name !== undefined) {
    params.push(fields.name);
    assignments.push(`name = $${params.length}`);
  }
  if (fields.description !== undefined) {
    params.push(fields.description);
    assignments.push(`description = $${params.length}`);
  }
  if (fields.status !== undefined) {
    params.push(fields.status);
    assignments.push(`status = $${params.length}`);
  }

  if (assignments.length === 0) return findProjectById(projectId, client);

  const row = await queryOne<ProjectRow>(
    `UPDATE projects SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${PROJECT_RETURNING}`,
    params,
    client,
  );
  return row ? toProject(row) : null;
};

export const findProjectBySlug = async (slug: string): Promise<ProjectRecord | null> => {
  const row = await queryOne<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.slug = $1`,
    [slug],
  );
  return row ? toProject(row) : null;
};

export type { PaginationQuery };
