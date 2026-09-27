/**
 * Shared test fixtures.
 *
 * Two rules make this suite trustworthy:
 *
 *  1. Every test starts from an empty database. `truncateAll` runs before each
 *     one so a test cannot pass because of data a previous test left behind —
 *     that failure mode is worse than a red test, because it is intermittent.
 *  2. No test runs in a transaction that is rolled back. The suite exercises
 *     `withTransaction` and the database triggers, and a rollback would hide
 *     exactly the bugs most worth catching (a statement ordering mistake, a
 *     trigger that only fires on commit). Truncating is slower and honest.
 */
import { query, queryOne, closePool } from '../src/db/pool.js';
import { hashRefreshToken } from '../src/modules/auth/token.service.js';
import { randomUUID } from 'node:crypto';

export const TABLES = [
  'activity_log',
  'comments',
  'tasks',
  'project_members',
  'projects',
  'refresh_tokens',
  'users',
] as const;

export const truncateAll = async (): Promise<void> => {
  // RESTART IDENTITY so activity_log ids are predictable per test. CASCADE covers
  // the foreign keys, but listing the tables keeps the order explicit.
  await query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
};

export const closeDatabase = async (): Promise<void> => {
  await closePool();
};

/** Unique per call, so parallel-safe even though the pool is single-fork. */
export const uniqueEmail = (label = 'user'): string => `${label}-${randomUUID()}@taskflow.test`;

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Inserts a user directly rather than going through the auth service: fixtures
 * should not depend on the code under test, or a bug in registration silently
 * becomes a bug in every test that needs a user.
 */
export const createUser = async (
  overrides: Partial<{ email: string; displayName: string; passwordHash: string; role: string; lastLoginAt: Date }> = {},
): Promise<TestUser> => {
  const email = overrides.email ?? uniqueEmail();
  const row = await queryOne<{ id: string; email: string; display_name: string }>(
    `INSERT INTO users (email, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, display_name`,
    [
      email,
      overrides.displayName ?? 'Test User',
      overrides.passwordHash ?? '$2b$04$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV',
      overrides.role ?? 'member',
    ],
  );
  if (!row) throw new Error('createUser inserted no row');
  return { id: row.id, email: row.email, displayName: row.display_name };
};

export const createProject = async (ownerId: string, name = 'Test Project'): Promise<{ id: string; ownerId: string; name: string }> => {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}`;
  const row = await queryOne<{ id: string; name: string; owner_id: string }>(
    `INSERT INTO projects (name, slug, owner_id) VALUES ($1, $2, $3)
     RETURNING id, name, owner_id`,
    [name, slug, ownerId],
  );
  if (!row) throw new Error('createProject inserted no row');

  await query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [row.id, ownerId],
  );

  return { id: row.id, ownerId: row.owner_id, name: row.name };
};

export const addMember = async (
  projectId: string,
  userId: string,
  role: 'viewer' | 'editor' | 'owner',
): Promise<void> => {
  await query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)`, [
    projectId,
    userId,
    role,
  ]);
};

export const createTask = async (
  projectId: string,
  createdBy: string,
  overrides: Partial<{ title: string; status: string; priority: string; position: number; assigneeId: string | null; dueAt: Date | null }> = {},
): Promise<{ id: string; projectId: string; status: string; position: number; completedAt: Date | null }> => {
  const row = await queryOne<{ id: string; project_id: string; status: string; position: number; completed_at: Date | null }>(
    `INSERT INTO tasks (project_id, title, status, priority, created_by, position, due_at, assignee_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, project_id, status, position, completed_at`,
    [
      projectId,
      overrides.title ?? 'Test task',
      overrides.status ?? 'todo',
      overrides.priority ?? 'medium',
      createdBy,
      overrides.position ?? 0,
      overrides.dueAt ?? null,
      overrides.assigneeId ?? null,
    ],
  );
  if (!row) throw new Error('createTask inserted no row');
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    position: row.position,
    completedAt: row.completed_at,
  };
};

export const createRefreshToken = async (
  userId: string,
  token: string,
  familyId: string,
  expiresAt: Date,
  revokedAt: Date | null = null,
): Promise<void> => {
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashRefreshToken(token), familyId, expiresAt, revokedAt],
  );
};
