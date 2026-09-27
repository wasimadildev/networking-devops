import type { ApiErrorBody } from './types';

/**
 * A failed API call, carrying the server's error code.
 *
 * `status` and `code` are kept separate because they answer different questions:
 * the status says whether to retry (a 429 or 503 is worth retrying, a 422 is
 * not), and the code says what to tell the user. A component that has to parse
 * the message to decide what to render is doing this file's job badly.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    if (body.requestId !== undefined) this.requestId = body.requestId;
    if (body.details !== undefined) this.details = body.details;
  }

  /** True when the request never reached the server, or the server did not reply. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /** True when the user has to sign in again, as opposed to being merely refused. */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  /**
   * True when retrying the identical request could plausibly succeed.
   *
   * Used to decide whether TanStack Query should keep trying. A 400 or 422 will
   * fail again identically, so retrying it just delays the error message.
   */
  get isRetryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  /**
   * Per-field messages from a validation failure, for rendering next to inputs.
   *
   * The server sends `details` as a flat array of `{ path, message }` issues, one
   * per failed rule — the same field appears more than once when several rules
   * failed against it, which is why this collapses to a map here. The alternative
   * shapes were both wrong in practice: reading it as a field-keyed object
   * returns nothing at all, because an array's keys are indices.
   *
   * Issues whose path is not a plain top-level field (a nested body, or the
   * server's `(body)` catch-all) are collected under `form`, so they are shown
   * once above the form rather than dropped.
   */
  get fieldErrors(): Record<string, string[]> {
    if (this.code !== 'validation_failed' || !Array.isArray(this.details)) {
      return {};
    }

    const mapped: Record<string, string[]> = {};
    for (const issue of this.details) {
      if (typeof issue !== 'object' || issue === null) continue;
      const { path, message } = issue as { path?: unknown; message?: unknown };
      if (typeof message !== 'string') continue;

      // A leading dot means the path continues, e.g. "meta.author". Only the first
      // segment names a field the form actually owns.
      const field = typeof path === 'string' ? (path.split('.')[0] || 'form') : 'form';
      (mapped[field] ??= []).push(message);
    }
    return mapped;
  }

  /** The first message for a field, for an input's `aria-describedby` target. */
  messageFor(field: string): string | undefined {
    return this.fieldErrors[field]?.[0];
  }

  /**
   * A single message for the form as a whole, when the failure is not tied to one
   * input — a 409, a 403, or a validation issue on a nested path.
   */
  get formMessage(): string {
    const perField = this.fieldErrors;
    const messages = perField['form'];
    return messages?.[0] ?? this.message;
  }
}

/** Wraps a thrown value so callers never have to guess what shape an error is. */
export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;
  if (error instanceof TypeError) {
    // fetch rejects with a TypeError for DNS failures, refused connections and
    // CORS blocks alike. All of them mean the same thing to a user: the API is
    // unreachable. Status 0 is what marks it as never having reached a server.
    return new ApiError(0, { code: 'network_error', message: 'Could not reach the server' });
  }
  return new ApiError(0, { code: 'unknown_error', message: 'Something went wrong' });
};
