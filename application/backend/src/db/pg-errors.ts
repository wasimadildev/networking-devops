/**
 * PostgreSQL error codes that the application knows how to translate.
 *
 * Hard-coding these strings is the alternative to string-matching `message`
 * output, which changes between PG versions and locales. The names come from
 * `src/include/utils/errcodes.h` in the PostgreSQL source.
 */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  INSUFFICIENT_PRIVILEGE: '42501',
  /** Serialization failure: a concurrent transaction touched the same rows. */
  SERIALIZATION_FAILURE: '40001',
  /** Deadlock detected; the current transaction is aborted and can be retried. */
  DEADLOCK_DETECTED: '40P01',
} as const;

export type PgErrorCode = (typeof PG_ERROR)[keyof typeof PG_ERROR];

export interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

export const hasPgCode = (error: unknown, code: PgErrorCode): boolean =>
  typeof error === 'object' && error !== null && (error as PgError).code === code;

/** Retryable means "the same statement may succeed later unchanged". */
export const isRetryablePgError = (error: unknown): boolean =>
  hasPgCode(error, PG_ERROR.SERIALIZATION_FAILURE) || hasPgCode(error, PG_ERROR.DEADLOCK_DETECTED);
