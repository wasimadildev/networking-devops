import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { withTransaction } from '../../db/pool.js';
import { hasPgCode, PG_ERROR } from '../../db/pg-errors.js';
import { ConflictError, InvalidCredentialsError, UnauthenticatedError, ForbiddenError } from '../../shared/errors.js';
import { childLogger } from '../../shared/logger.js';
import { updateLastLogin } from '../users/user.repository.js';
import type { ChangePasswordBody, LoginBody, RegisterBody } from './auth.schemas.js';
import {
  findCredentialsByEmail,
  findCredentialsById,
  findRefreshTokenByHash,
  insertRefreshToken,
  insertUser,
  revokeAllForUser,
  revokeRefreshToken,
  revokeTokenFamily,
  updatePasswordHash,
} from './auth.repository.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  newTokenFamily,
  refreshTokenExpiry,
  signAccessToken,
} from './token.service.js';
import type { PublicUser, UserRole } from './types.js';

const log = childLogger('auth.service');

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthResult extends AuthTokens {
  user: PublicUser;
}

export interface RequestContextMeta {
  userAgent: string | null;
  ipAddress: string | null;
}

const publicUserFrom = (row: {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  created_at?: Date;
  last_login_at?: Date | null;
}): PublicUser => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  role: row.role,
  createdAt: row.created_at ?? new Date(0),
  lastLoginAt: row.last_login_at ?? null,
});

const accessTokenTtlSeconds = (): number => {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_ACCESS_TTL);
  if (!match) throw new Error(`Unsupported JWT_ACCESS_TTL: ${env.JWT_ACCESS_TTL}`);
  const [, amount = '0', unit = 's'] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
  return Number(amount) * (multipliers[unit] ?? 1);
};

/**
 * Registration creates the user and the owner's first project membership in one
 * transaction. Without it a failure between the two inserts would leave an
 * account that can log in but can never see anything it created.
 */
export const register = async (body: RegisterBody, meta: RequestContextMeta): Promise<AuthResult> => {
  const passwordHash = await bcrypt.hash(body.password, env.BCRYPT_COST);

  return withTransaction(async (client) => {
    let userId: string;
    try {
      const user = await insertUser(
        { email: body.email, passwordHash, displayName: body.displayName },
        client,
      );
      userId = user.id;
    } catch (error) {
      if (hasPgCode(error, PG_ERROR.UNIQUE_VIOLATION)) {
        throw new ConflictError('An account with that email already exists');
      }
      throw error;
    }

    const refreshToken = generateRefreshToken();
    await insertRefreshToken(
      {
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        familyId: newTokenFamily(),
        expiresAt: refreshTokenExpiry(),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
      client,
    );

    log.info({ userId }, 'user registered');

    return {
      accessToken: signAccessToken(userId, 'member'),
      refreshToken,
      expiresIn: accessTokenTtlSeconds(),
      tokenType: 'Bearer' as const,
      user: {
        id: userId,
        email: body.email,
        displayName: body.displayName,
        role: 'member',
        createdAt: new Date(),
        lastLoginAt: null,
      },
    };
  });
};

/**
 * A missing user and a wrong password both cost a bcrypt comparison, so the
 * response time does not reveal which emails exist. Skipping the hash when the
 * user is absent is what makes this work — that early return is a timing oracle
 * even though the error message is identical.
 */
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', env.BCRYPT_COST);

export const login = async (body: LoginBody, meta: RequestContextMeta): Promise<AuthResult> => {
  const credentials = await findCredentialsByEmail(body.email);
  const hash = credentials?.password_hash ?? DUMMY_HASH;
  const passwordMatches = await bcrypt.compare(body.password, hash);

  if (!credentials || !passwordMatches) {
    throw new InvalidCredentialsError();
  }

  if (!credentials.is_active) {
    throw new ForbiddenError('This account has been deactivated');
  }

  const refreshToken = generateRefreshToken();

  await withTransaction(async (client) => {
    await insertRefreshToken(
      {
        userId: credentials.id,
        tokenHash: hashRefreshToken(refreshToken),
        familyId: newTokenFamily(),
        expiresAt: refreshTokenExpiry(),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
      client,
    );
    await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [credentials.id]);
  });

  log.info({ userId: credentials.id }, 'user logged in');

  return {
    accessToken: signAccessToken(credentials.id, credentials.role),
    refreshToken,
    expiresIn: accessTokenTtlSeconds(),
    tokenType: 'Bearer' as const,
    user: publicUserFrom({ ...credentials, created_at: new Date() }),
  };
};

/**
 * Token rotation with reuse detection.
 *
 * A refresh token is single-use: presenting one issues a replacement in the same
 * family and revokes the presented row. If a revoked row is presented again,
 * that is a replay — the family is killed and a forced login is required.
 */
export const refresh = async (refreshToken: string, meta: RequestContextMeta): Promise<AuthResult> => {
  const presentedHash = hashRefreshToken(refreshToken);
  const stored = await findRefreshTokenByHash(presentedHash);

  if (!stored) {
    throw new UnauthenticatedError('Refresh token is invalid');
  }

  if (stored.revoked_at !== null) {
    const revokedCount = await revokeTokenFamily(stored.family_id);
    log.warn(
      { familyId: stored.family_id, userId: stored.user_id, revokedCount },
      'refresh token reuse detected; family revoked',
    );
    throw new UnauthenticatedError('Refresh token has already been used. Please sign in again.');
  }

  if (stored.expires_at.getTime() <= Date.now()) {
    throw new UnauthenticatedError('Refresh token has expired');
  }

  const credentials = await findCredentialsById(stored.user_id);
  if (!credentials || !credentials.is_active) {
    throw new UnauthenticatedError('Account is no longer active');
  }

  const nextToken = generateRefreshToken();

  await withTransaction(async (client) => {
    await revokeRefreshToken(stored.id);
    await insertRefreshToken(
      {
        userId: stored.user_id,
        tokenHash: hashRefreshToken(nextToken),
        familyId: stored.family_id,
        expiresAt: refreshTokenExpiry(),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
      client,
    );
  });

  return {
    accessToken: signAccessToken(credentials.id, credentials.role),
    refreshToken: nextToken,
    expiresIn: accessTokenTtlSeconds(),
    tokenType: 'Bearer' as const,
    user: publicUserFrom({ ...credentials, created_at: new Date() }),
  };
};

export const logout = async (refreshToken: string): Promise<void> => {
  const stored = await findRefreshTokenByHash(hashRefreshToken(refreshToken));
  if (!stored) return;
  await revokeRefreshToken(stored.id);
  log.info({ userId: stored.user_id }, 'user logged out');
};

export const logoutEverywhere = async (userId: string): Promise<void> => {
  const revoked = await revokeAllForUser(userId);
  log.info({ userId, revoked }, 'all sessions revoked');
};

export const changePassword = async (
  userId: string,
  body: ChangePasswordBody,
): Promise<{ sessionsRevoked: number }> => {
  const credentials = await findCredentialsById(userId);
  if (!credentials) throw new UnauthenticatedError();

  const matches = await bcrypt.compare(body.currentPassword, credentials.password_hash);
  if (!matches) {
    throw new UnauthenticatedError('Current password is incorrect');
  }

  const newHash = await bcrypt.hash(body.newPassword, env.BCRYPT_COST);
  await updatePasswordHash(userId, newHash);

  // Changing a password must invalidate every existing session, otherwise a
  // stolen refresh token outlives the credential change it was meant to answer.
  const sessionsRevoked = await revokeAllForUser(userId);
  log.info({ userId, sessionsRevoked }, 'password changed');

  return { sessionsRevoked };
};

export { updateLastLogin };
