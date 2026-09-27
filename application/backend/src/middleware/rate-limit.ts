import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import { env, isTest } from '../config/app-env.js';
import { childLogger } from '../shared/logger.js';

const log = childLogger('http.rate-limit');

/**
 * Rate limiting is keyed by authenticated user id when there is one, falling back
 * to the client IP. Keying purely on IP punishes a whole office behind one NAT
 * for one person's failed logins; keying purely on a user id lets an attacker
 * rotate accounts. Using the strongest available identity is the compromise.
 *
 * The IP fallback goes through `ipKeyGenerator`, which normalises an IPv6 address
 * to its /64 subnet. A single IPv6 client is routinely handed a whole /64, so
 * keying on the full address would let one host rotate through billions of
 * addresses and never hit a limit.
 */
const userOrIpKey = (req: { auth?: { userId: string }; ip?: string }): string =>
  req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown');

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Tests must not inherit a shared counter, or one slow suite fails the next.
  skip: () => isTest,
  handler: (req, res) => {
    log.warn({ reqId: req.requestId, path: req.path }, 'rate limit exceeded');
    const retryAfter = Number(res.getHeader('retry-after')) || 60;
    res.setHeader('retry-after', String(retryAfter));
    res.status(429).json({
      error: {
        code: 'rate_limited',
        message: 'Too many requests. Try again shortly.',
        requestId: req.requestId,
        details: { retryAfterSeconds: retryAfter },
      },
    });
  },
};

export const apiRateLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  keyGenerator: userOrIpKey,
  // Health checks must never be throttled: a probe that gets a 429 looks like a
  // dead instance, and the orchestrator will restart a healthy one.
  skip: (req) => isTest || req.path === '/health' || req.path === '/health/ready',
});

/**
 * Login and registration get a much tighter budget. This is the endpoint worth
 * brute-forcing, so it is the one that gets the strict limit.
 *
 * Keyed on IP alone even when a session exists, because these routes run before
 * authentication — there is no user id to key on yet. `skipSuccessfulRequests`
 * keeps a legitimate user who signs in repeatedly from consuming the budget.
 */
export const authRateLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  skipSuccessfulRequests: true,
});
