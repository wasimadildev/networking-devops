import { queryMany, queryOne } from '../../db/pool.js';
import type { PublicUser, UserRole } from '../auth/types.js';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

/**
 * The one place column aliases are translated to the camelCase shape the API
 * exposes. Every module maps its own rows; a shared row mapper per entity would
 * be a hidden dependency between modules that share no logic.
 *
 * `password_hash` is deliberately absent from UserRow. It has no reason to leave
 * the database, and a type that omits it is a type that cannot leak it.
 */
const USER_COLUMNS = 'id, email, display_name, role, is_active, created_at, last_login_at';

const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  role: row.role,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
});

export const findActiveUserById = async (id: string): Promise<(PublicUser & { sessionId: string }) | null> => {
  const row = await queryOne<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND is_active = true`,
    [id],
  );
  return row ? { ...toPublicUser(row), sessionId: row.id } : null;
};

export const findUserById = async (id: string): Promise<PublicUser | null> => {
  const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return row ? toPublicUser(row) : null;
};

/**
 * Exact-email lookup, used only by the add-member action.
 *
 * Deliberately not a search: no ILIKE, no prefix matching, so it answers exactly
 * one question about exactly one address. `is_active` is checked so a
 * deactivated account cannot be pulled back into a project. Callers must be
 * project owners — see addMemberBodySchema for why the id-based body was
 * replaced.
 */
export const findActiveUserByEmail = async (email: string): Promise<PublicUser | null> => {
  const row = await queryOne<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 AND is_active = true`,
    [email],
  );
  return row ? toPublicUser(row) : null;
};

/**
 * User search for the "add a member" picker.
 *
 * Scoped to accounts the caller already shares a project with. An unscoped
 * version returned every active user's name and email to anyone with a valid
 * token, which is a full account directory: it hands out the exact data the
 * login endpoint goes to some trouble to withhold, since login answers
 * identically for a wrong password and an account that does not exist. Here the
 * search can only find people the caller already has a legitimate relationship
 * with, which is the only reason the app needs the endpoint at all.
 *
 * The term stays a bound parameter; `%` and `_` from the caller are matched as
 * the wildcards they are, which is correct for a substring search.
 */
export const searchUsers = async (
  requesterId: string,
  term: string,
  limit: number,
): Promise<PublicUser[]> => {
  const rows = await queryMany<UserRow>(
    `SELECT DISTINCT ${USER_COLUMNS.split(', ')
      .map((column) => `u.${column}`)
      .join(', ')}
       FROM users u
       JOIN project_members mine ON mine.user_id = u.id
      WHERE u.is_active = true
        AND EXISTS (
          SELECT 1
            FROM project_members theirs
           WHERE theirs.project_id = mine.project_id
             AND theirs.user_id = $1
        )
        AND ($2::text IS NULL OR u.display_name ILIKE $3 OR u.email ILIKE $3)
      ORDER BY u.display_name ASC
      LIMIT $4`,
    [requesterId, term, `%${term}%`, limit],
  );
  return rows.map(toPublicUser);
};

export const updateLastLogin = async (id: string): Promise<void> => {
  await queryOne(`UPDATE users SET last_login_at = now() WHERE id = $1 RETURNING id`, [id]);
};
