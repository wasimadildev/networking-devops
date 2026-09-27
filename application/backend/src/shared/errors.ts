/**
 * One error type for every expected failure.
 *
 * The point of `expose` is that a client learns *whether* it caused the problem,
 * never *why* internally. A 500 with `expose: false` becomes a correlation id and
 * nothing else; a stack trace in a response body is a reconnaissance gift.
 *
 * Services throw these. They never throw bare `Error`, because a bare Error
 * carries no HTTP semantics and would surface as a 500 for a client mistake.
 */

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'rate_limited'
  | 'internal_error';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly expose: boolean;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { statusCode: number; code: ErrorCode; expose?: boolean; details?: unknown; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.expose = options.expose ?? options.statusCode < 500;
    if (options.details !== undefined) this.details = options.details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, { statusCode: 400, code: 'bad_request', details });
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Request validation failed') {
    super(message, { statusCode: 422, code: 'validation_failed', details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { statusCode: 401, code: 'unauthenticated' });
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    // Deliberately identical to the "no such user" message. Distinguishing them
    // turns the login form into an account-enumeration oracle.
    super('Email or password is incorrect', { statusCode: 401, code: 'invalid_credentials' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super(message, { statusCode: 403, code: 'forbidden' });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, { statusCode: 404, code: 'not_found' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', details?: unknown) {
    super(message, { statusCode: 409, code: 'conflict', details });
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { statusCode: 422, code: 'unprocessable', details });
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('Too many requests', {
      statusCode: 429,
      code: 'rate_limited',
      details: { retryAfterSeconds },
    });
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
