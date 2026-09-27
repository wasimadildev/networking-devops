import { z } from 'zod';
import { baseEnvSchema, type BaseEnv } from './env.js';

/**
 * Application-tier configuration: everything the *server* needs on top of the
 * data tier.
 *
 * Kept separate from `env.ts` so that `db:migrate` — a data-tier tool — can run
 * with only `DATABASE_URL` set. See the comment in `env.ts` for the failure that
 * motivated the split.
 *
 * Everything here is validated only by processes that serve requests. A stricter
 * split is the point: if a variable is only read on a request path, then
 * demanding it before the process can open a database connection is a stricter
 * policy than the code actually needs, and strictness that blocks legitimate work
 * gets worked around.
 */

/**
 * Environment values arrive as strings, but the code wants booleans.
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
export const KNOWN_PLACEHOLDERS = [
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

export const appEnvSchema = baseEnvSchema
  .extend({
    // App tier. Must be 0.0.0.0 in a container; 127.0.0.1 would make the health
    // probe fail because the probe arrives from outside the container.
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    HOST: z.string().default('0.0.0.0'),

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

export type Env = z.infer<typeof appEnvSchema>;

const parsed = appEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

/**
 * The full application configuration. Note the type is `Env` (everything), not
 * `BaseEnv`, so a module that needs a JWT secret cannot accidentally type-check
 * against the data-tier shape.
 */
export const env: Env = parsed.data;

// Re-exported so a module needing both halves imports from one place.
export { isProduction, isTest } from './env.js';
export type { BaseEnv };
