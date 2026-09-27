import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/app-env.js';
import { UnauthenticatedError } from '../../shared/errors.js';
import type { UserRole } from './types.js';

/**
 * Two token strategies with different threat models.
 *
 * Access token — a signed JWT. Stateless, so it can be verified without a
 * database round trip. The cost is that it cannot be revoked before it expires,
 * which is why the TTL is short (15 minutes).
 *
 * Refresh token — an opaque random string, stored as a SHA-256 digest. It is
 * long-lived, so it *must* be revocable, and it must not be readable from a
 * database dump.
 *
 * `family_id` groups every token descended from one login. Presenting a token
 * that was already rotated away means either a replay or a theft, and the whole
 * family is revoked to force a fresh login. That is the standard reuse-detection
 * scheme, and it is why the family column exists.
 */

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  typ: 'access';
}

export const signAccessToken = (userId: string, role: UserRole): string =>
  jwt.sign(
    { role, typ: 'access' satisfies AccessTokenClaims['typ'] },
    env.JWT_ACCESS_SECRET,
    {
      subject: userId,
      // jsonwebtoken types `expiresIn` as the `ms` package's StringValue union.
      // The value is already validated by the env schema's TTL format check, so
      // this assertion narrows a checked string rather than silencing an error.
      expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
      issuer: 'taskflow-api',
      audience: 'taskflow-web',
      algorithm: 'HS256',
    },
  );

export const verifyAccessToken = (token: string): AccessTokenClaims => {
  let payload: string | JwtPayload;

  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'taskflow-api',
      audience: 'taskflow-web',
      // Pinned: without this, `alg: none` and an RS/HS confusion attack are both
      // on the table. The verification algorithm is a decision, not a hint.
      algorithms: ['HS256'],
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthenticatedError('Access token has expired');
    }
    throw new UnauthenticatedError('Access token is invalid');
  }

  if (typeof payload !== 'object' || typeof payload.sub !== 'string') {
    throw new UnauthenticatedError('Access token is malformed');
  }

  // `typ` is checked because a refresh token presented as a bearer token must
  // not authenticate a request. Distinct secrets already prevent this, but the
  // claim makes the intent explicit and survives a future secret mistake.
  if ((payload as { typ?: unknown }).typ !== 'access') {
    throw new UnauthenticatedError('Access token is malformed');
  }

  const role = (payload as { role?: unknown }).role;
  if (role !== 'member' && role !== 'admin') {
    throw new UnauthenticatedError('Access token is malformed');
  }

  return { sub: payload.sub, role, typ: 'access' };
};

/** 32 random bytes, base64url. Opaque on purpose — it carries no claims. */
export const generateRefreshToken = (): string => randomBytes(32).toString('base64url');

/**
 * Only the digest is persisted, so a leaked table cannot be replayed against the
 * API. SHA-256 rather than bcrypt is correct here precisely because the input is
 * 256 bits of CSPRNG output: there is no dictionary to attack, and the lookup
 * has to be an indexed equality match.
 */
export const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const newTokenFamily = (): string => randomUUID();

export const ttlToMilliseconds = (ttl: string): number => {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Unsupported TTL format: ${ttl}`);

  const [, amount = '0', unit = 's'] = match;
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

  return Number(amount) * (multipliers[unit] ?? 1000);
};

export const refreshTokenExpiry = (): Date =>
  new Date(Date.now() + ttlToMilliseconds(env.JWT_REFRESH_TTL));
