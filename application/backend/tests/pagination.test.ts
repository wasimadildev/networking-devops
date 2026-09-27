import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  buildPage,
  decodeCursor,
  encodeCursor,
  emptyPage,
  paginationQuerySchema,
  MAX_PAGE_SIZE,
} from '../src/shared/pagination.js';
import { truncateAll, closeDatabase } from './helpers.js';

beforeEach(truncateAll);
afterAll(closeDatabase);

describe('paginationQuerySchema', () => {
  it('applies a default limit when none is given', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('coerces the string form, because a query string is always strings', () => {
    expect(paginationQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
  });

  it('rejects a limit of zero, which would make the cursor loop forever', () => {
    expect(paginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('rejects a negative limit', () => {
    expect(paginationQuerySchema.safeParse({ limit: -1 }).success).toBe(false);
  });

  it('rejects a fractional limit, which would truncate unpredictably', () => {
    expect(paginationQuerySchema.safeParse({ limit: 2.5 }).success).toBe(false);
  });

  it(`caps the limit at ${MAX_PAGE_SIZE} so one request cannot ask for the whole table`, () => {
    expect(paginationQuerySchema.safeParse({ limit: MAX_PAGE_SIZE + 1 }).success).toBe(false);
    expect(paginationQuerySchema.parse({ limit: String(MAX_PAGE_SIZE) })).toEqual({ limit: MAX_PAGE_SIZE });
  });

  it('rejects a non-numeric limit', () => {
    expect(paginationQuerySchema.safeParse({ limit: 'lots' }).success).toBe(false);
  });
});

describe('cursor encoding', () => {
  it('round-trips a timestamp and an id', () => {
    const createdAt = new Date('2026-03-04T05:06:07.008Z');
    const id = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    expect(decodeCursor(encodeCursor(createdAt, id))).toEqual({ createdAt, id });
  });

  it('produces url-safe output with no + / or = to escape', () => {
    const cursor = encodeCursor(new Date('2026-03-04T05:06:07.008Z'), '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects a cursor with no separator rather than guessing', () => {
    expect(decodeCursor(Buffer.from('no-separator-here', 'utf8').toString('base64url'))).toBeNull();
  });

  it('rejects a cursor whose id is not a uuid', () => {
    const bad = Buffer.from(`${new Date().toISOString()}|not-a-uuid`, 'utf8').toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });

  it('rejects a cursor whose timestamp is unparseable', () => {
    const bad = Buffer.from('not-a-date|3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', 'utf8').toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });

  it('rejects a cursor that is not base64url at all', () => {
    expect(decodeCursor('!!! not base64 !!!')).toBeNull();
  });

  it('rejects an empty cursor', () => {
    expect(decodeCursor('')).toBeNull();
  });
});

describe('buildPage', () => {
  // Real UUIDs, because the cursor deliberately validates the id shape. A
  // fixture using 'a' and 'b' would be rejected by decodeCursor, which is the
  // right behaviour and a confusing test failure if you do not know why.
  const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
  const row = (n: number) => ({ id: id(n), createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)) });

  it('reports no next page when the rows exactly fill the limit', () => {
    // A query that fetches limit + 1 is what makes this decidable; exactly
    // `limit` rows means the extra row came back empty, so there is no more.
    const page = buildPage([row(1), row(2)], 2);
    expect(page.data).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.pageInfo.nextCursor).toBeNull();
  });

  it('drops the lookahead row and reports a next page', () => {
    const page = buildPage([row(1), row(2), row(3)], 2);
    expect(page.data.map((r) => r.id)).toEqual([id(1), id(2)]);
    expect(page.pageInfo.hasNextPage).toBe(true);
  });

  it('returns a cursor pointing at the last returned row, not the lookahead', () => {
    const page = buildPage([row(1), row(2), row(3)], 2);
    const decoded = decodeCursor(page.pageInfo.nextCursor!);
    expect(decoded?.id).toBe(id(2));
    expect(decoded?.createdAt).toEqual(row(2).createdAt);
  });

  it('is stable when the client feeds the cursor back for the next page', () => {
    const all = [row(1), row(2), row(3), row(4), row(5)];
    const first = buildPage(all, 2);
    const cursor = decodeCursor(first.pageInfo.nextCursor!);

    const next = all.slice(2);
    const second = buildPage(next, 2);

    expect(first.data.map((r) => r.id)).toEqual([id(1), id(2)]);
    expect(second.data.map((r) => r.id)).toEqual([id(3), id(4)]);
    expect(second.pageInfo.hasNextPage).toBe(true);
    expect(cursor?.id).toBe(id(2));
  });

  it('handles an empty result set without inventing a cursor', () => {
    const page = buildPage([], 20);
    expect(page.data).toEqual([]);
    expect(page.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });
  });

  it('handles a single page of one row', () => {
    const page = buildPage([row(1)], 1);
    expect(page.data).toHaveLength(1);
    expect(page.pageInfo.hasNextPage).toBe(false);
  });
});

describe('emptyPage', () => {
  it('is a well-formed empty page with no cursor', () => {
    expect(emptyPage()).toEqual({ data: [], pageInfo: { hasNextPage: false, nextCursor: null } });
  });
});
