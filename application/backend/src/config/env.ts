import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable the app reads is declared here, exactly once.
 *
 * dotenv is loaded from this module rather than from each entry point, so the
 * migration CLI, the test harness and the server all resolve configuration the
 * same way. A tool that needed its own `import 'dotenv/config'` would be a tool
 * that mysteriously fails when that line is forgotten.
 *
 * Two reasons this is a schema and not a `process.env` read at each call site:
 * a typo'd variable name becomes a startup crash instead of `undefined` at
 * runtime, and the production-only rules (a 32-char secret, a non-wildcard CORS
 * origin) are enforced before the first request rather than after an incident.
 */

/**
 * Environment values arrive as strings, but the code wants booleans. Coercing
 * in a preprocess step (rather than `.transform().pipe()`) keeps `.default()`
 * typed as the boolean it produces, which is what makes `env.DATABASE_SSL` a
 * real `boolean` everywhere instead of a string pretending to be one.
 */
const booleanish = (fallback: boolean) =>
  z
    .preprocess(
      (raw) => (raw === undefined || raw === '' ? undefined : raw === 'true' || raw === '1'),
      z.boolean().optional(),
    )
    .transform((value) => value ?? fallback);

/**
 * The literal texts that appear in `.env.example`. A deployment still carrying
 * one of these is running with a secret that is published in the repository,
 * which means anyone who has read the repository can forge an access token.
 *
 * This is a deny list of exact values on purpose. An earlier version rejected
 * secrets *containing* the words "change" or "secret", which is a guess about
 * what a placeholder looks like — and it missed `replace-with-openssl-rand-base64-48-output`,
 * the exact value that ships, because that string contains neither word. Guessing
 * at the shape of a bad value fails open, quietly, in production.
 */
const KNOWN_PLACEHOLDERS = [
  'replace-with-openssl-rand-base64-48-output',
  'replace-with-a-different-openssl-rand-base64-48',
  'change-me',
  'changeme',
  'secret',
  'your-secret',
  'your_secret',
  'placeholder',
] as const;

/** Words that only ever appear in an example value, never in a generated one. */
const PLACEHOLDER_WORDS = ['replace-with', 'change-me', 'changeme', 'placeholder', 'your-secret', 'example'] as const;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // App tier. Must be 0.0.0.0 in a container; 127.0.0.1 would make the health
    // probe fail because the probe arrives from outside the container.
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Data tier. Reached only from the app subnet — see 01-paper-design.
    // `error` rather than the inner `.min()` message: a missing variable is a
    // missing *key*, and the inner message ("expected string, received
    // undefined") never reaches the operator who needs to be told which one.
    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required' })
      .min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: booleanish(false),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),

    // Presentation tier. An allowlist, never a wildcard: CORS is a security
    // control, not a convenience switch.
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:8080,http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      )
      .refine(
        (origins) => !origins.includes('*'),
        'CORS_ALLOWED_ORIGINS must not contain * — use an explicit origin allowlist',
      ),

    // Auth. The two secrets are deliberately separate so a leak of one does not
    // compromise the other, and so access and refresh tokens can rotate apart.
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),

    TRUST_PROXY: booleanish(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    const weakSecret = (name: string, value: string) => {
      const lower = value.toLowerCase();
      const isKnownPlaceholder = KNOWN_PLACEHOLDERS.some((placeholder) => lower === placeholder);
      const looksLikePlaceholder = PLACEHOLDER_WORDS.some((word) => lower.includes(word));

      if (isKnownPlaceholder || looksLikePlaceholder) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is still the .env.example placeholder; generate one with: openssl rand -base64 48`,
        });
        return;
      }

      // A base64 secret from `openssl rand -base64 48` is 64 characters. Anything
      // dramatically shorter is a hand-typed value, and a hand-typed secret is
      // either a dictionary word or a leaked one.
      if (value.length < 48) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is only ${value.length} characters; use 48+ bytes of randomness (openssl rand -base64 48)`,
        });
      }
    };
    weakSecret('JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET);
    weakSecret('JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET);

    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'access and refresh secrets must differ',
      });
    }
  });

/**
 * Exported so the production rules above can be tested without the import-time
 * `safeParse(process.env)` at the bottom of this file throwing.
 */
export { envSchema, KNOWN_PLACEHOLDERS };

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env: Env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
