import pg, { type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '../config/env.js';
import { childLogger } from '../shared/logger.js';
import { isRetryablePgError } from './pg-errors.js';

const log = childLogger('db.pool');

/**
 * `gen_random_uuid()` and `now()` are evaluated in the database, so the pool must
 * hand back real JS types rather than strings. Without this, every uuid and
 * timestamp arrives as text and a Date field silently becomes a string.
 */
pg.types.setTypeParser(20, (value) => value); // int8
pg.types.setTypeParser(1700, (value) => Number(value)); // numeric, money-adjacent

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  // Idle clients are cheap to hold but not free; a closed one per second is
  // plenty for a pool this small.
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Without this a single forgotten filter can hold a query open indefinitely and
  // exhaust the pool, turning one bad query into a total outage.
  statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
  application_name: 'taskflow-api',
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
});

pool.on('error', (error) => {
  // An idle client errored out of band. The pool discards the client itself, so
  // the only useful action is to record it — crashing here would turn a
  // recoverable event into a restart loop.
  log.error({ err: error }, 'idle database client errored');
});

export type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

export const query = async <T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
  client: Queryable = pool,
): Promise<QueryResult<T>> => client.query<T>(text, params as unknown[]);

export const queryOne = async <T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
  client: Queryable = pool,
): Promise<T | null> => {
  const result = await query<T>(text, params, client);
  return result.rows[0] ?? null;
};

export const queryMany = async <T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
  client: Queryable = pool,
): Promise<T[]> => (await query<T>(text, params, client)).rows;

const MAX_TRANSACTION_ATTEMPTS = 3;

/**
 * Runs `fn` inside a transaction, rolling back on any throw.
 *
 * Retries on a serialization failure or deadlock. Those are not bugs — they are
 * the database correctly refusing to let two transactions interleave badly — and
 * the documented recovery is to run the whole transaction again, which is only
 * safe because `fn` must be idempotent with respect to its own writes (they all
 * rolled back).
 */
export const withTransaction = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        log.error({ err: rollbackError }, 'rollback failed');
      });

      if (isRetryablePgError(error) && attempt < MAX_TRANSACTION_ATTEMPTS) {
        // Exponential backoff: two transactions that collided need slightly
        // different timing on the retry, not the same timing again.
        const delayMs = 2 ** attempt * 10;
        log.warn({ attempt, delayMs }, 'retrying transaction after concurrency conflict');
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  throw new Error('unreachable: withTransaction exhausted its attempts');
};

export const closePool = async (): Promise<void> => {
  await pool.end();
};
