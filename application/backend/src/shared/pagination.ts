import { z } from 'zod';

/**
 * Pagination is expressed as a cursor, not an offset.
 *
 * OFFSET has two problems that matter here: the database still counts the
 * skipped rows, so page 500 is slow, and rows inserted while paging shift the
 * window, so a task can appear twice or vanish. A cursor keyed on
 * `(created_at, id)` is stable and cheap because the index already exists.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface Page<T> {
  data: T[];
  pageInfo: {
    hasNextPage: boolean;
    nextCursor: string | null;
  };
}

export const emptyPage = <T>(): Page<T> => ({ data: [], pageInfo: { hasNextPage: false, nextCursor: null } });

/**
 * The cursor is opaque to the client and tamper-evident enough to reject
 * garbage early. It is base64url of `createdAt|uuid`; decoding failure is a 400
 * rather than a 500 because a bad cursor is always the caller's fault.
 */
export const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');

export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

export const decodeCursor = (cursor: string): DecodedCursor | null => {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = raw.indexOf('|');
    if (separator === -1) return null;

    const createdAt = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);
    if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;

    return { createdAt, id };
  } catch {
    return null;
  }
};

/**
 * Validates the cursor at the request boundary.
 *
 * Without this the schema accepted any string, `decodeCursor` returned null
 * three layers down, and a repository dereferenced it — a client sending
 * `?cursor=hello` got a 500. A malformed cursor is the caller's mistake, so it
 * belongs in the schema where it becomes a 422 with a field-level message, in
 * line with the rule that all input is validated before a handler sees it.
 */
export const cursorSchema = z
  .string()
  .refine((value) => decodeCursor(value) !== null, { message: 'cursor is malformed' });

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: cursorSchema.optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Turns one extra fetched row into `hasNextPage`.
 *
 * Fetch `limit + 1` and check the length: asking the database for a count() as
 * well would double the work on a hot list, and count(*) drifts as rows change
 * anyway. One extra row is the cheapest honest signal that more exist.
 */
export const buildPage = <T extends { id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
): Page<T> => {
  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;
  const last = data.at(-1);

  return {
    data,
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage && last ? encodeCursor(last.createdAt, last.id) : null,
    },
  };
};
