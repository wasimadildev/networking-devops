import type { Request } from 'express';

/**
 * Reads a route parameter as a string.
 *
 * Express 5 types `req.params[name]` as `string | string[]` because a pattern
 * like `/:id` can technically capture a segment containing a slash under
 * repeated parameters. The validation middleware has already proved the value
 * is a single uuid by the time a handler sees it, so this narrows once instead of
 * forcing every handler to.
 */
export const param = (req: Request, name: string): string => {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new Error(`Route parameter ${name} is missing or repeated; check the route pattern`);
  }
  return value;
};

/** Reads the caller established by the authenticate middleware. */
export const caller = (req: Request): NonNullable<Request['auth']> => {
  if (!req.auth) {
    throw new Error('authenticate middleware must run before this route');
  }
  return req.auth;
};
