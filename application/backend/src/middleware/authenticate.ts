import type { RequestHandler } from 'express';
import { UnauthenticatedError } from '../shared/errors.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';
import type { AuthContext } from '../modules/auth/types.js';
import { findActiveUserById } from '../modules/users/user.repository.js';

/**
 * Rejects the request unless it carries a valid access token for a live account.
 *
 * The extra database read is deliberate. A stateless JWT check alone would keep
 * working for a user who was deactivated seconds ago, for the full 15-minute TTL
 * — and a deactivated account is exactly the case where "still valid" is
 * unacceptable. One primary-key lookup is cheap; the alternative is a revocation
 * list that grows forever and has to be consulted on every request anyway.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthenticatedError();
    }

    const claims = verifyAccessToken(header.slice('Bearer '.length).trim());
    const user = await findActiveUserById(claims.sub);

    if (!user) {
      throw new UnauthenticatedError('Account is no longer active');
    }

    req.auth = { userId: user.id, role: user.role, sessionId: claims.sub } satisfies AuthContext;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Gate for routes that need a verified account beyond mere authentication.
 * Kept separate from `authenticate` so the requirement is visible at the route
 * definition rather than implied by a role check buried in a service.
 */
export const requireRole =
  (...roles: AuthContext['role'][]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(new UnauthenticatedError());
    if (!roles.includes(req.auth.role)) {
      return next(new UnauthenticatedError('Insufficient privileges'));
    }
    return next();
  };
