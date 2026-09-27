import type { RequestHandler } from 'express';
import { ZodError, type ZodType } from 'zod';
import { BadRequestError, ValidationError } from '../shared/errors.js';

export type RequestSchemas = {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
};

/**
 * Validates and *replaces* `req.body`, `req.query` and `req.params` with the
 * parsed result.
 *
 * Replacing rather than merely checking is the important part. After this
 * middleware a handler holds values that are known-coerced and known-typed, so
 * a `limit` is a number and not the string `"10"`. The zod schema is the single
 * source of the TypeScript type too, inferred by `z.infer`, so the two cannot
 * drift apart.
 *
 * Express 5 makes `req.query` a getter-only property, so a parsed query is
 * stashed on `res.locals.query` instead of being assigned back.
 */
export const validate = (schemas: RequestSchemas): RequestHandler => {
  return (req, res, next) => {
    const issues: { path: string; message: string }[] = [];

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        Object.assign(req.params, result.data);
      } else {
        issues.push(...formatIssues(result.error));
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        res.locals['query'] = result.data;
      } else {
        issues.push(...formatIssues(result.error));
      }
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        req.body = result.data;
      } else {
        issues.push(...formatIssues(result.error));
      }
    }

    if (issues.length > 0) {
      return next(new ValidationError(issues));
    }
    return next();
  };
};

/** Reads the validated query back out of `res.locals`. */
export const validatedQuery = <T>(res: { locals: Record<string, unknown> }): T =>
  res.locals['query'] as T;

function formatIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(body)',
    message: issue.message,
  }));
}

/** Narrowing helper for route params that must be a uuid. */
export const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const assertUuid = (value: string, field: string): string => {
  if (!isUuid(value)) {
    throw new BadRequestError(`${field} must be a uuid`);
  }
  return value;
};
