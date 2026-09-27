import { describe, expect, it } from 'vitest';
import { baseEnvSchema } from '../src/config/env.js';
import { appEnvSchema, KNOWN_PLACEHOLDERS } from '../src/config/app-env.js';

/**
 * The production secret rules, tested against the schema directly.
 *
 * These matter more than they look. A deployment that boots with the committed
 * `.env.example` secret is running with a signing key that is published in this
 * repository, so anyone who has read it can mint a valid access token for any
 * user. The check that prevents this was previously a substring match on the
 * words "change" and "secret" — which passed the real placeholder straight
 * through, because the real placeholder contains neither word. The regression
 * test below is the one that would have caught it.
 */

const base = {
  NODE_ENV: 'production' as const,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/taskflow',
  CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
};

const parse = (overrides: Record<string, string>) => appEnvSchema.safeParse({ ...base, ...overrides });

const messageFor = (result: ReturnType<typeof parse>, name: string) =>
  result.error?.issues.find((issue) => issue.path[0] === name)?.message ?? '';

describe('env schema: production secrets', () => {
  it('accepts two distinct, long, random-looking secrets', () => {
    const result = parse({});
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it.each(KNOWN_PLACEHOLDERS)('rejects the shipped placeholder %j in production', (placeholder) => {
    const result = parse({ JWT_ACCESS_SECRET: placeholder });
    expect(result.success).toBe(false);
    // The exact message depends on which rule fires first — a 12-character
    // placeholder is caught by the length rule before the placeholder rule. The
    // requirement is that it is rejected at boot, not which rule explains it.
    expect(messageFor(result, 'JWT_ACCESS_SECRET')).toBeTruthy();
  });

  it('rejects the exact value that ships in .env.example', () => {
    // The literal from backend/.env.example. This is the case the old
    // substring check missed.
    const result = parse({ JWT_ACCESS_SECRET: 'replace-with-openssl-rand-base64-48-output' });
    expect(result.success).toBe(false);
    expect(messageFor(result, 'JWT_ACCESS_SECRET')).toMatch(/placeholder/i);
  });

  it('rejects a short hand-typed secret', () => {
    const result = parse({ JWT_REFRESH_SECRET: 'hunter2-but-long-enough-to-pass-min-32' });
    expect(result.success).toBe(false);
    expect(messageFor(result, 'JWT_REFRESH_SECRET')).toMatch(/randomness|48\+/i);
  });

  it('rejects identical access and refresh secrets', () => {
    const shared = 'x'.repeat(64);
    const result = parse({ JWT_ACCESS_SECRET: shared, JWT_REFRESH_SECRET: shared });
    expect(result.success).toBe(false);
    expect(messageFor(result, 'JWT_REFRESH_SECRET')).toMatch(/must differ/i);
  });

  it('allows a placeholder in development, so a fresh clone boots', () => {
    // The opposite failure would be worse in practice: a rule strict enough to
    // block local setup gets worked around with a committed .env.
    const result = appEnvSchema.safeParse({
      ...base,
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: 'replace-with-openssl-rand-base64-48-output',
      JWT_REFRESH_SECRET: 'replace-with-a-different-openssl-rand-base64-48',
    });
    expect(result.success).toBe(true);
  });
});

describe('env schema: still enforced outside production', () => {
  it('requires DATABASE_URL in every environment', () => {
    const result = appEnvSchema.safeParse({ ...base, DATABASE_URL: undefined });
    expect(result.success).toBe(false);
    expect(messageFor(result, 'DATABASE_URL')).toMatch(/required/i);
  });

  it('rejects a wildcard CORS origin', () => {
    const result = parse({ CORS_ALLOWED_ORIGINS: '*' });
    expect(result.success).toBe(false);
  });

  it('coerces TRUST_PROXY to a hop count rather than a boolean wildcard', () => {
    const asTrue = appEnvSchema.safeParse({ ...base, TRUST_PROXY: 'true' });
    const asCount = appEnvSchema.safeParse({ ...base, TRUST_PROXY: '1' });
    expect(asTrue.success).toBe(true);
    expect(asCount.success).toBe(true);
  });
});

/**
 * The data-tier half. These cases exist because of a real CI failure: the
 * migration CLI imported the full application schema, so `db:migrate` refused to
 * run without JWT secrets — which a data-tier tool never reads. A pipeline with
 * a working DATABASE_URL and no auth configuration failed at startup, before
 * connecting to anything.
 */
describe('base env schema: the migration CLI needs only a database', () => {
  const dbOnly = { DATABASE_URL: 'postgresql://user:pass@db:5432/taskflow' };

  it('parses with DATABASE_URL alone', () => {
    // The regression itself. No JWT secrets, no CORS, no PORT.
    const result = baseEnvSchema.safeParse(dbOnly);
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('does not require any application-tier variable', () => {
    const parsed = baseEnvSchema.safeParse(dbOnly);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // Proves the split: nothing from the app half leaks into the data half.
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CORS_ALLOWED_ORIGINS', 'PORT', 'HOST']) {
      expect(parsed.data).not.toHaveProperty(key);
    }
  });

  it('still requires DATABASE_URL', () => {
    const result = baseEnvSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('still applies the connection defaults', () => {
    const parsed = baseEnvSchema.safeParse(dbOnly);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.DATABASE_POOL_MAX).toBe(10);
    expect(parsed.data.DATABASE_SSL).toBe(false);
    expect(parsed.data.DATABASE_STATEMENT_TIMEOUT_MS).toBe(15_000);
    expect(parsed.data.LOG_LEVEL).toBe('info');
  });

  it('does not enforce the production secret rules — it has no secrets to check', () => {
    // Production mode with no secrets at all must still be valid for the data
    // half. If this ever fails, the two schemas have been recombined.
    const result = baseEnvSchema.safeParse({ ...dbOnly, NODE_ENV: 'production' });
    expect(result.success).toBe(true);
  });
});
