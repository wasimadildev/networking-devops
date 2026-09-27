import { queryMany, queryOne, type Queryable } from '../../db/pool.js';
import type { ProjectMemberRole } from '../auth/types.js';
import type { Page } from '../../shared/pagination.js';
import type { PublicUser } from '../auth/types.js';
import type { ListMembersQuery } from './project.schemas.js';

export interface ProjectMember {
  userId: string;
  displayName: string;
  email: string;
  role: ProjectMemberRole;
  joinedAt: Date;
}

interface MemberRow {
  user_id: string;
  display_name: string;
  email: string;
  role: ProjectMemberRole;
  created_at: Date;
}

const toMember = (row: MemberRow): ProjectMember => ({
  userId: row.user_id,
  displayName: row.display_name,
  email: row.email,
  role: row.role,
  joinedAt: row.created_at,
});

/**
 * The membership lookup every authorised read and write starts with.
 *
 * Returning the role rather than a boolean is the point: a service that only
 * learns *whether* the caller is a member will re-query for the role, and one
 * that only learns the role will guess about existence. One call, both answers.
 */
export const findMembership = async (
  projectId: string,
  userId: string,
  client?: Queryable,
): Promise<ProjectMemberRole | null> => {
  const row = await queryOne<{ role: ProjectMemberRole }>(
    `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
    client,
  );
  return row?.role ?? null;
};

export const listMembers = async (
  projectId: string,
  query: ListMembersQuery,
  client?: Queryable,
): Promise<Page<ProjectMember>> => {
  const params: unknown[] = [projectId];
  const conditions = ['m.project_id = $1'];

  if (query.role) {
    params.push(query.role);
    conditions.push(`m.role = $${params.length}`);
  }

  params.push(query.limit);

  const rows = await queryMany<MemberRow>(
    `SELECT u.id AS user_id, u.display_name, u.email, m.role, m.created_at
       FROM project_members m
       JOIN users u ON u.id = m.user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.created_at ASC, u.display_name ASC
      LIMIT $${params.length}`,
    params,
    client,
  );

  return {
    data: rows.map(toMember),
    pageInfo: { hasNextPage: rows.length === query.limit, nextCursor: null },
  };
};

/**
 * Adds one membership. Deliberately a plain INSERT, not an upsert.
 *
 * This used to be `ON CONFLICT ... DO UPDATE SET role = EXCLUDED.role`, which
 * quietly made "add this person" mean "add them, or change their existing role"
 * — so adding a current editor as a viewer returned 201 and demoted them, and a
 * second add with a different role looked successful while reversing a decision
 * the owner thought they had already made. The service's `ConflictError` for a
 * duplicate was unreachable dead code, because an upsert never raises the unique
 * violation it was catching.
 *
 * No caller needs the upsert semantics: `createProject` inserts into an empty
 * table, and the owner-membership trigger only fires on DELETE or a role UPDATE.
 * Letting the unique violation propagate is what makes the 409 real.
 */
export const addMember = async (
  projectId: string,
  userId: string,
  role: ProjectMemberRole,
  client?: Queryable,
): Promise<ProjectMember | null> => {
  const row = await queryOne<MemberRow>(
    `INSERT INTO project_members (project_id, user_id, role)
     VALUES ($1, $2, $3)
     RETURNING user_id, (SELECT display_name FROM users WHERE id = $2) AS display_name,
               (SELECT email FROM users WHERE id = $2) AS email, role, created_at`,
    [projectId, userId, role],
    client,
  );
  return row ? toMember(row) : null;
};

export const updateMemberRole = async (
  projectId: string,
  userId: string,
  role: ProjectMemberRole,
  client?: Queryable,
): Promise<ProjectMember | null> => {
  const row = await queryOne<MemberRow>(
    `UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2
     RETURNING user_id, (SELECT display_name FROM users WHERE id = $2) AS display_name,
               (SELECT email FROM users WHERE id = $2) AS email, role, created_at`,
    [projectId, userId, role],
    client,
  );
  return row ? toMember(row) : null;
};

export const removeMember = async (
  projectId: string,
  userId: string,
  client?: Queryable,
): Promise<boolean> => {
  const row = await queryOne<{ user_id: string }>(
    `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING user_id`,
    [projectId, userId],
    client,
  );
  return row !== null;
};

export const countOwners = async (projectId: string, client?: Queryable): Promise<number> => {
  const row = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM project_members WHERE project_id = $1 AND role = 'owner'`,
    [projectId],
    client,
  );
  return Number(row?.count ?? 0);
};

export const membersAsUsers = (members: ProjectMember[]): PublicUser[] =>
  members.map((member) => ({
    id: member.userId,
    email: member.email,
    displayName: member.displayName,
    role: 'member',
    createdAt: member.joinedAt,
    lastLoginAt: null,
  }));
