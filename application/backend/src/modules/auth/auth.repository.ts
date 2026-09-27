import { createHash } from 'node:crypto';
import { queryMany, queryOne, type Queryable } from '../../db/pool.js';
import { hashRefreshToken } from './token.service.js';
import type { UserRole } from './types.js';

interface CredentialRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
}

export const findCredentialsByEmail = async (
  email: string,
  client?: Queryable,
): Promise<CredentialRow | null> =>
  queryOne<CredentialRow>(
    `SELECT id, email, password_hash, display_name, role, is_active
       FROM users
      WHERE email = $1`,
    [email],
    client,
  );

export const findCredentialsById = async (
  id: string,
  client?: Queryable,
): Promise<CredentialRow | null> =>
  queryOne<CredentialRow>(
    `SELECT id, email, password_hash, display_name, role, is_active
       FROM users
      WHERE id = $1`,
    [id],
    client,
  );

export const insertUser = async (
  input: { email: string; passwordHash: string; displayName: string },
  client?: Queryable,
): Promise<{ id: string; email: string; displayName: string; role: UserRole }> => {
  const row = await queryOne<{ id: string; email: string; display_name: string; role: UserRole }>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, display_name, role`,
    [input.email, input.passwordHash, input.displayName],
    client,
  );
  if (!row) throw new Error('user insert returned no row');
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
};

export const updatePasswordHash = async (userId: string, passwordHash: string): Promise<void> => {
  await queryOne(`UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id`, [userId, passwordHash]);
};

export const updateDisplayName = async (
  userId: string,
  displayName: string,
): Promise<{ id: string; displayName: string } | null> => {
  const row = await queryOne<{ id: string; display_name: string }>(
    `UPDATE users SET display_name = $2 WHERE id = $1 RETURNING id, display_name`,
    [userId, displayName],
  );
  return row ? { id: row.id, displayName: row.display_name } : null;
};

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export const insertRefreshToken = async (
  input: {
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  },
  client?: Queryable,
): Promise<void> => {
  await queryOne(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [input.userId, input.tokenHash, input.familyId, input.expiresAt, input.userAgent, input.ipAddress],
    client,
  );
};

export const findRefreshTokenByHash = async (
  tokenHash: string,
  client?: Queryable,
): Promise<RefreshTokenRow | null> =>
  queryOne<RefreshTokenRow>(
    `SELECT id, user_id, token_hash, family_id, expires_at, revoked_at
       FROM refresh_tokens
      WHERE token_hash = $1`,
    [tokenHash],
    client,
  );

export const revokeRefreshToken = async (id: string): Promise<void> => {
  await queryOne(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
    [id],
  );
};

/**
 * Reuse detection. Revoking the whole family, not just the presented token, is
 * what turns a stolen-token replay into a forced re-login: the thief and the
 * victim are both cut off, and the legitimate user notices.
 */
export const revokeTokenFamily = async (familyId: string): Promise<number> => {
  const rows = await queryMany<{ id: string }>(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE family_id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [familyId],
  );
  return rows.length;
};

export const revokeAllForUser = async (userId: string): Promise<number> => {
  const rows = await queryMany<{ id: string }>(
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [userId],
  );
  return rows.length;
};

/**
 * Deletes rows that can no longer authorise anything. Retention is deliberate:
 * revoked rows are kept for a window so replay stays detectable, then swept.
 */
export const pruneExpiredTokens = async (client?: Queryable): Promise<number> => {
  const rows = await queryMany<{ id: string }>(
    `DELETE FROM refresh_tokens
      WHERE expires_at < now() - interval '7 days'
      RETURNING id`,
    [],
    client,
  );
  return rows.length;
};

/**
 * Exposed for tests and for the reuse-detection path, which needs to compare a
 * stored digest against a presented token without a second query.
 */
export const digestOf = hashRefreshToken;

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
