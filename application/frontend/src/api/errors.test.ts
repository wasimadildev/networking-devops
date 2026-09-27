import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from './errors';

/**
 * The 422 envelope is `{ details: [{ path, message }] }` — an array, not a map.
 * Reading it as a field-keyed object returns nothing, so every field error
 * silently vanishes and a form reports only a generic failure. These tests pin
 * the real shape, because it is easy to "fix" this file back into being wrong.
 */
const validationError = (details: unknown) =>
  new ApiError(422, { code: 'validation_failed', message: 'Request validation failed', details });

describe('ApiError.fieldErrors', () => {
  it('groups issues by the field they name', () => {
    const error = validationError([
      { path: 'email', message: 'Enter a valid email address' },
      { path: 'password', message: 'Password must be at least 12 characters' },
      { path: 'password', message: 'Password must include a digit' },
    ]);

    expect(error.fieldErrors).toEqual({
      email: ['Enter a valid email address'],
      password: ['Password must be at least 12 characters', 'Password must include a digit'],
    });
  });

  it('keeps every message when one field breaks several rules', () => {
    const error = validationError([
      { path: 'displayName', message: 'Display name is too short' },
      { path: 'displayName', message: 'Display name is too long' },
    ]);

    expect(error.messageFor('displayName')).toBe('Display name is too short');
    expect(error.fieldErrors['displayName']).toHaveLength(2);
  });

  it('returns nothing for a field that passed', () => {
    const error = validationError([{ path: 'email', message: 'Enter a valid email address' }]);

    expect(error.fieldErrors['password']).toBeUndefined();
    expect(error.messageFor('password')).toBeUndefined();
  });

  it('is empty for a non-validation error', () => {
    const error = new ApiError(409, { code: 'conflict', message: 'Already a member' });

    expect(error.fieldErrors).toEqual({});
  });

  it('is empty when details are missing entirely', () => {
    const error = new ApiError(500, { code: 'internal_error', message: 'Something broke' });

    expect(error.fieldErrors).toEqual({});
  });

  it('collects a nested path under its first segment', () => {
    // The form owns `meta`, not `meta.author`, so the message goes next to the
    // field the user can actually see.
    const error = validationError([{ path: 'meta.author', message: 'Author is required' }]);

    expect(error.fieldErrors['meta']).toEqual(['Author is required']);
  });

  it('files the catch-all path under form rather than dropping it', () => {
    const error = validationError([{ path: '', message: 'Body must be an object' }]);

    expect(error.fieldErrors['form']).toEqual(['Body must be an object']);
  });

  it('ignores malformed entries instead of throwing', () => {
    const error = validationError([
      { path: 'email', message: 'Enter a valid email address' },
      null,
      'not an object',
      { path: 'email' },
      { message: 'no path' },
    ]);

    expect(error.fieldErrors).toEqual({ email: ['Enter a valid email address'], form: ['no path'] });
  });
});

describe('ApiError.formMessage', () => {
  it('prefers a form-scoped message over the generic one', () => {
    const error = validationError([{ path: '', message: 'Body must be an object' }]);

    expect(error.formMessage).toBe('Body must be an object');
  });

  it('falls back to the top-level message when nothing is form-scoped', () => {
    const error = validationError([{ path: 'email', message: 'Enter a valid email address' }]);

    expect(error.formMessage).toBe('Request validation failed');
  });
});

describe('ApiError classification', () => {
  it.each([
    [0, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [403, false],
    [409, false],
    [422, false],
  ])('status %i retryable: %s', (status, expected) => {
    expect(new ApiError(status, { code: 'x', message: 'y' }).isRetryable).toBe(expected);
  });

  it('treats a 401 as needing a new session, not a retry', () => {
    const error = new ApiError(401, { code: 'unauthenticated', message: 'Expired' });

    expect(error.isAuthError).toBe(true);
    expect(error.isRetryable).toBe(false);
  });

  it('marks a fetch TypeError as a network error with status 0', () => {
    // fetch rejects with a TypeError for DNS failure, refused connection and
    // CORS block alike; all three mean the API was never reached.
    const error = toApiError(new TypeError('Failed to fetch'));

    expect(error.isNetworkError).toBe(true);
    expect(error.status).toBe(0);
    expect(error.isRetryable).toBe(true);
  });

  it('passes an ApiError through unchanged', () => {
    const original = new ApiError(404, { code: 'not_found', message: 'Task not found' });

    expect(toApiError(original)).toBe(original);
  });

  it('wraps an unknown throw rather than leaking it', () => {
    const error = toApiError('a string, somehow');

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Something went wrong');
  });
});
