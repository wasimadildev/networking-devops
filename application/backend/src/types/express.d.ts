import type { AuthContext } from '../modules/auth/types.js';

/**
 * Express ships no types for request-scoped properties, so they are declared
 * here. The alternative — `req as Request & { auth: ... }` at every call site —
 * defeats the point of the compiler and lets a handler read `req.auth` from an
 * unauthenticated route without complaint.
 */
declare global {
  namespace Express {
    interface Request {
      /** Correlation id, set by the requestContext middleware. Always present. */
      requestId: string;
      /**
       * Set by the authenticate middleware. Optional on purpose: its absence is
       * what tells a handler it is running on a public route, so typing it as
       * always-present would be a lie the compiler could not catch.
       */
      auth?: AuthContext;
    }
  }
}

export {};
