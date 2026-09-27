import { queryMany, queryOne, type Queryable } from '../../db/pool.js';
import { requireProjectAccess } from '../../shared/authorization.js';
import type { PaginationQuery } from '../../shared/pagination.js';
import { decodeCursor } from '../../shared/pagination.js';
import { BadRequestError } from '../../shared/errors.js';

export interface ActivityEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface ActivityRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface LogActivityInput {
  actorId: string | null;
  projectId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  metadata: Record<string, unknown>;
}

/**
 * Written inside the caller's transaction.
 *
 * That is the whole design: if the task insert rolls back, its audit row rolls
 * back with it, so the trail can never claim something happened that did not.
 * An audit log that lies is worse than none.
 */
export const logActivity = async (input: LogActivityInput, client?: Queryable): Promise<void> => {
  await queryOne(
    `INSERT INTO activity_log (actor_id, project_id, entity_type, entity_id, action, metadata)
     VALUES ($1, $2, $3, $4, $5::activity_action, $6::jsonb)
     RETURNING id`,
    [input.actorId, input.projectId, input.entityType, input.entityId, input.action, JSON.stringify(input.metadata)],
    client,
  );
};

/**
 * Project timeline. Membership is re-resolved here rather than trusted from the
 * caller, so there is exactly one way into this data and it goes through the
 * same authorisation helper as everything else.
 */
export const listProjectActivity = async (
  userId: string,
  projectId: string,
  query: PaginationQuery,
): Promise<{ rows: ActivityEntry[]; limit: number }> => {
  await requireProjectAccess(userId, projectId, 'viewer');

  const limit = query.limit;
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw new BadRequestError('cursor is malformed');
  const params: unknown[] = [projectId];
  const conditions = ['a.project_id = $1'];

  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    conditions.push('(a.created_at, a.id::text) < ($2, $3)');
  }
  params.push(limit + 1);

  const rows = await queryMany<ActivityRow>(
    `SELECT a.id::text AS id, a.actor_id, u.display_name AS actor_name,
            a.action::text AS action, a.entity_type, a.entity_id,
            a.metadata, a.created_at
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${params.length}`,
    params,
  );

  return {
    rows: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    })),
    limit,
  };
};
