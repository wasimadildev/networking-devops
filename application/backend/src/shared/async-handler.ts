import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 forwards a rejected promise from an async handler to the error
 * middleware on its own, so this wrapper is belt-and-braces for handlers that
 * are not directly typed as async (a callback passed to `router.get` that
 * returns a promise built by a helper, for example).
 *
 * Without it an async throw becomes a request that hangs until the client times
 * out, which looks like a network problem rather than a bug.
 */
export const asyncHandler =
  <T>(handler: (req: Request, res: Response, next: NextFunction) => Promise<T>): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next);
  };
