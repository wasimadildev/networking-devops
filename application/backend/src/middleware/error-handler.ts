import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { isAppError } from '../shared/errors.js';
import { sendError } from '../shared/response.js';
import { childLogger } from '../shared/logger.js';
import { env } from '../config/env.js';

const log = childLogger('http');

interface PgErrorLike {
  code?: string;
  constraint?: string;
}

/**
 * The single place an error becomes a response body.
 *
 * The 500 path is the one that matters. An unexpected error is logged in full —
 * message, stack, cause — and the client receives a correlation id and nothing
 * else. That id is enough to find the matching log line, and it discloses
 * nothing about the server's internals.
 */
export const errorHandler =
  (): ((err: unknown, req: Request, res: Response, next: NextFunction) => void) =>
  (err, req, res, next) => {
    const requestId = req.requestId;

    if (res.headersSent) {
      // The response is already streaming; the only correct action is to abort
      // and let Express destroy the socket.
      log.error({ err, reqId: requestId }, 'error raised after headers were sent');
      return next(err);
    }

    if (isAppError(err)) {
      if (err.statusCode >= 500) {
        log.error({ err, reqId: requestId, path: req.path }, 'application error');
      } else {
        log.debug({ code: err.code, reqId: requestId, path: req.path }, 'request rejected');
      }

      return sendError(res, err.statusCode, {
        code: err.code,
        // `expose` is what keeps an internal message from reaching the client.
        message: err.expose ? err.message : 'An unexpected error occurred',
        requestId,
        ...(err.expose && err.details !== undefined ? { details: err.details } : {}),
      });
    }

    // A zod schema that threw instead of using safeParse is a programming error
    // in a route, not a client error.
    if (err instanceof ZodError) {
      log.error({ err, reqId: requestId }, 'schema raised outside the validate middleware');
      return sendError(res, 500, {
        code: 'internal_error',
        message: 'An unexpected error occurred',
        requestId,
      });
    }

    // Malformed JSON from body-parser: the client sent something unparseable, so
    // this is a 400 and not a server fault.
    if (isBodyParseError(err)) {
      return sendError(res, 400, {
        code: 'bad_request',
        message: 'Request body is not valid JSON',
        requestId,
      });
    }

    const pgError = err as PgErrorLike;
    if (pgError?.code === '23505') {
      log.warn({ constraint: pgError.constraint, reqId: requestId }, 'unique constraint violated');
      return sendError(res, 409, {
        code: 'conflict',
        message: 'That value is already taken',
        requestId,
      });
    }

    log.error({ err, reqId: requestId, path: req.path, method: req.method }, 'unhandled error');

    return sendError(res, 500, {
      code: 'internal_error',
      message: 'An unexpected error occurred',
      requestId,
    });
  };

function isBodyParseError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as { type?: string; status?: number; statusCode?: number };
  return (
    candidate.type === 'entity.parse.failed' ||
    ((candidate.status === 400 || candidate.statusCode === 400) && candidate.type === 'entity.parse.failed')
  );
}

/** Anything that reaches the router without a match. Registered after the routes. */
export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, {
    code: 'not_found',
    message: `No route matches ${req.method} ${req.path}`,
    requestId: req.requestId,
  });
};

/** Last-resort guard for a rejection that escaped the error middleware itself. */
export const unhandledRejectionGuard = (): void => {
  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'unhandled promise rejection');
    // Exiting is deliberate: a promise rejection nobody handled means the app is
    // in an unknown state, and a restart is more honest than limping on.
    if (env.NODE_ENV === 'production') process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    log.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });
};

