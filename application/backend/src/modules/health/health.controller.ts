import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendData } from '../../shared/response.js';
import { query, pool } from '../../db/pool.js';

export interface LivenessResult {
  status: 'ok';
  uptimeSeconds: number;
}

export interface ReadinessResult {
  status: 'ready' | 'degraded';
  checks: {
    database: { ok: boolean; latencyMs: number; error?: string };
    pool: { total: number; idle: number; waiting: number };
  };
}

/**
 * Liveness answers "is this process broken?" and must not touch the database.
 *
 * If liveness checked Postgres, a brief database blip would make an orchestrator
 * restart every healthy app instance at the same moment — turning a dependency
 * problem into a full outage. Liveness stays shallow on purpose.
 */
export const liveness = (_req: Request, res: Response): void => {
  const result: LivenessResult = {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
  };
  sendData(res, result);
};

/**
 * Readiness answers "should traffic be sent here?" and does check the database.
 *
 * This is what the Azure Load Balancer probe hits: a 503 here pulls the instance
 * out of rotation while it is still running, so the fix is the database, not a
 * restart. That distinction — restart (liveness) versus drain (readiness) — is
 * the whole reason the two endpoints exist separately.
 */
export const readiness = asyncHandler(async (_req: Request, res: Response) => {
  const startedAt = process.hrtime.bigint();
  let databaseOk = true;
  let error: string | undefined;

  try {
    // SELECT 1 exercises the whole round trip: connect, authenticate, execute.
    // `SELECT now()` would also be caught by a statement timeout, so the probe
    // cannot hang and turn a slow database into a hung health check.
    await query('SELECT 1');
  } catch (dbError) {
    databaseOk = false;
    error = dbError instanceof Error ? dbError.message : 'unknown database error';
  }

  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  const result: ReadinessResult = {
    status: databaseOk ? 'ready' : 'degraded',
    checks: {
      database: {
        ok: databaseOk,
        latencyMs: Number(latencyMs.toFixed(2)),
        ...(error ? { error } : {}),
      },
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    },
  };

  // 503 on degraded is what makes the load balancer act. Returning 200 with a
  // body that says "degraded" would require the probe to parse JSON, and most
  // probes only look at the status code.
  res.status(databaseOk ? 200 : 503).json({ data: result });
});
