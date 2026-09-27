import 'dotenv/config';
import { z } from 'zod';

/**
 * Base configuration: the data tier and logging.
 *
 * This is deliberately the *smaller* half of the configuration, and the split
 * exists because of a concrete failure rather than tidiness. `db:migrate` is a
 * data-tier tool: it applies DDL and touches nothing else. It used to import the
 * full application schema, which meant applying a migration required JWT secrets
 * to be present — so a CI job that had a perfectly good `DATABASE_URL` and no
 * auth configuration still failed at startup, before connecting to anything:
 *
 *   Invalid environment configuration:
 *     - JWT_ACCESS_SECRET: Invalid input: expected string, received undefined
 *
 * A tool being unable to run because of configuration it does not use is a
 * configuration bug, not a user error. The application-tier half — CORS, JWT
 * secrets, rate limits, the listening port — lives in `app-env.ts` and is only
 * validated by processes that serve requests.
 *
 * dotenv is loaded here rather than in each entry point, so the migration CLI,
 * the test harness and the server all resolve configuration the same way. A tool
 * that needed its own `import 'dotenv/config'` would be a tool that mysteriously
 * fails when that line is forgotten.
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
 * Shared by both halves so the data-tier and application tiers cannot disagree
 * about what `NODE_ENV` or `DATABASE_URL` mean.
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Data tier. Reached only from the app subnet — see 01-paper-design.
  // `error` rather than the inner `.min()` message: a missing variable is a
  // missing *key*, and the inner message ("expected string, received
  // undefined") never reaches the operator who needs to be told which one.
  DATABASE_URL: z.string({ error: 'DATABASE_URL is required' }).min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_SSL: booleanish(false),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

/**
 * Turns a Zod failure into the message an operator can act on. Kept here because
 * both halves format their errors identically, and a tool that printed a
 * different shape from the server would be its own small confusion.
 */
const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

/**
 * Parsed for any process that touches the database or the logger, including the
 * migration CLI. Exported separately from the application `env` in
 * `app-env.ts` so a data-tier tool never validates application credentials.
 */
const parsedBase = baseEnvSchema.safeParse(process.env);

if (!parsedBase.success) {
  throw new Error(`Invalid environment configuration:\n${formatIssues(parsedBase.error)}`);
}

export const env: BaseEnv = parsedBase.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
