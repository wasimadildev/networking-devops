# ADR-0005: Keyset pagination, and no total count

Date: 2026-09-27 · Status: accepted

## Context

Lists — projects, tasks, activity — need to page. The pagination strategy and
the `pageInfo` shape are one decision, because the shape is determined by the
strategy.

## Decision

Order by `(created_at DESC, id DESC)`. Paginate with an **opaque keyset cursor**:
base64url of `createdAt|uuid`.

The response carries only:

```json
{ "data": [ … ], "pageInfo": { "hasNextPage": true, "nextCursor": "eyJ…" } }
```

There is no `total`, and no `page` number.

## Why keyset rather than OFFSET

`LIMIT 20 OFFSET 40` is a request for "rows 41–60", and the database has to walk
and discard the first 40. Two problems follow:

- **Insert during scroll duplicates.** If a task is created while a user is on
  page 2, everything shifts by one; row 41 is now on page 3. The user sees a
  task they have already seen and misses one they have not. `OFFSET` paginates
  over a moving target, so it cannot be correct while the data changes.
- **Cost grows with depth.** Page 50 of `OFFSET` reads 1000 rows to return 20.
  Keyset reads about 21.

## Why `id` breaks the tie

`created_at` is not unique. Many rows inserted in one transaction share a
timestamp, and a cursor on `created_at` alone is then ambiguous — the boundary
row is skipped or repeated, and it gets worse as clocks coarsen. Adding `id`
makes the ordering total, so the cursor identifies a position rather than a
timestamp.

`WHERE (created_at, id) < ($1, $2)` is a row-comparison expression, which is why
this is one of the places a query builder stops helping and starts emitting
parentheses. It is also why the repository returns the last row's values rather
than computing offsets: the cursor is the last row the database gave us, not a
number we incremented.

## Why no total

A count over a keyset-paginated, concurrently-changing table is expensive (a
second full scan) and the moment it arrives it is already wrong. A UI showing
"43 tasks" while the list changes under it is worse than a UI showing "more".

The consequence is real and worth stating: the UI cannot render "page 3 of 9",
and there is no jump-to-page. It renders "Load more" — which is the correct
control for a list that is still changing anyway.

## Why the cursor is opaque

Clients receive base64url, not a query fragment. A readable cursor invites
`ORDER BY` being rewritten by a well-meaning client, and the moment the ordering
expression is client-controlled the index is not being used and a sort happens in
the app. It also means a future change to the cursor format is not a breaking API
change. Decoding is strict: anything that is not base64url of exactly two
separated fields is a 422, not a silently empty page.

## Alternatives

| Option | Why not |
|---|---|
| `OFFSET` | duplicates and skips under concurrent writes; cost grows with depth |
| Count plus offset | same problems, plus an expensive count that goes stale |
| Page numbers | implies a stable total, which there is not |
| Keyset on `id` alone | UUIDv4 is random, so the ordering would be arbitrary and the index useless |
| Client-visible cursor fields | invites client-side re-sorting; the query plan is not a contract but the cursor is |
| Server-side sessions with a scroll offset | works, and couples a read to a write |
