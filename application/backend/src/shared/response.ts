import type { Response } from 'express';
import type { Page } from './pagination.js';

/**
 * One response shape for the whole API.
 *
 * Success is always `{ data }`. Failure is always `{ error: { code, message,
 * requestId } }`. A client therefore needs exactly one branch to detect failure —
 * no guessing from a status code, and no field that means "sometimes this is an
 * error array, sometimes a string".
 */

export interface ErrorBody {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export type ApiResponse<T> = { data: T } | { data: T; pageInfo: Page<T>['pageInfo'] } | { error: ErrorBody };

export const sendData = <T>(res: Response, data: T, statusCode = 200): Response => res.status(statusCode).json({ data });

export const sendPage = <T>(res: Response, page: Page<T>): Response =>
  res.status(200).json({ data: page.data, pageInfo: page.pageInfo });

export const sendCreated = <T>(res: Response, data: T): Response => sendData(res, data, 201);

export const sendNoContent = (res: Response): Response => res.status(204).end();

export const sendError = (
  res: Response,
  statusCode: number,
  body: ErrorBody,
): Response => res.status(statusCode).json({ error: body });
