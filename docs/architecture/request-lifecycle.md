# Request lifecycle

What happens between a click in the browser and a row in PostgreSQL, and which
layer is responsible for which refusal.

## A read: loading the project list

1. **`ProjectsPage`** renders. It calls `useProjects()`, which is a TanStack Query
   hook. The component does not `fetch`; it has no idea the base URL exists.

2. **The hook** builds a key from `query-keys.ts`, checks the cache, and calls
   `projectApi.list({ status: 'active' })` if there is nothing fresh.

3. **`endpoints.ts`** maps that call to `GET /api/v1/projects?status=active`. It
   is the only file that knows paths and parameter names.

4. **`client.ts`** attaches `Authorization`, calls `fetch`, and parses the
   envelope. If the status is 401 it performs a **single** refresh and replays the
   request once. A second 401 is not retried — it notifies the session store,
   which signs the user out. A refresh loop is the failure mode here: a client
   that retries refresh on failure will hammer the endpoint until the rate limiter
   stops it.

5. **Express** applies `helmet`, the request logger (which assigns `req.id`), the
   CORS allowlist, the rate limiter, and the JSON body parser.

6. **The route** validates query and params with Zod. A bad `status` is a 422
   before any database work happens.

7. **`requireAuth`** verifies the access token, then checks the user still exists
   and is active. A token for a deactivated account fails here, not at expiry.

8. **The service** applies business rules and calls the repository. It never sees
   `req` or `res`.

9. **The repository** runs one parameterised query, with the ORDER BY expression
   taken from a `const` allowlist and the cursor passed as a bound parameter. It
   contains no business rules.

10. **The handler** wraps the result in `{ data, pageInfo }`.

11. **The error middleware** would convert an `AppError` into the error envelope.
    On the happy path it does nothing.

12. **The client** unwraps `data`, and the query cache holds it. The component
    re-renders with rows.

## A write: adding a member, and what can refuse it

`POST /api/v1/projects/:projectId/members` with `{ email, role }`. Every step can
refuse, and the refusals are worth listing because they are the security posture:

| Step | Refuses when | Result |
|---|---|---|
| CORS | the origin is not in the allowlist | no CORS headers; the browser blocks the response |
| Rate limiter | over budget | 429 |
| Zod | the body is not `{ email, role }` with a valid role | 422 with per-field `details` |
| `requireAuth` | no/expired token, or an inactive user | 401 |
| `requireProjectAccess(owner)` | not a member of this project | **404**, not 403 |
| `requireProjectAccess(owner)` | a member, but not the owner | 403 |
| service | the address matches no active account | 404 |
| service | already a member | 409 |
| repository | any residual race on the unique key | 409 |

The two rows that matter most are the 404 and the 409:

- **404 before 403** is not a typo. A 403 confirms the project exists; iterating
  ids and collecting 403s maps the deployment. See
  [ADR-0002](../adr/0002-not-found-versus-forbidden.md).
- **409 is reachable.** Membership insert was an upsert that silently demoted an
  existing member and made the `ConflictError` dead code. It is now a plain
  insert, so the unique key fails and the service maps it. See
  [ADR-0007](../adr/0007-no-user-directory.md).

## A write: changing a task's status

`POST /api/v1/tasks/:taskId/move` with `{ status, position }`.

1. Zod validates the body.
2. `requireAuth`.
3. The service loads the task **with its project membership** in one query. The
   task id is not authorisation: knowing it proves nothing, and the lookup
   resolves the caller's role from the row it fetched rather than from a prior
   request.
4. `requireProjectAccess(editor)` — 404 if not a member, 403 if a viewer.
5. The `UPDATE ... SET status, position, completed_at` runs in a transaction with
   the activity-log insert, so the log and the change commit together.
6. `completed_at` is set by a **trigger** on the transition to `done`, not by the
   service. A task cannot be marked done without a completion time.

## Errors

Handlers throw `AppError` subclasses. One middleware converts them:

| Class | Status | `code` |
|---|---|---|
| `ValidationError` | 422 | `validation_failed` |
| `AuthenticationError` | 401 | `unauthenticated` |
| `AuthorizationError` | 403 | `forbidden` |
| `NotFoundError` | 404 | `not_found` |
| `ConflictError` | 409 | `conflict` |
| `UnprocessableError` | 422 | `unprocessable` |

A handler that throws a plain `Error` reaches the middleware as an unknown error:
it logs with a stack trace and returns `500` with a `requestId` and nothing else.
A service never throws a bare `Error`, because it has no way to say which of the
above it meant.

The `requestId` in the response is the same value as `req.id` in the log line, so
a user reporting a failure can be matched to a record without exposing a stack
trace, a query, or a hostname.

## Transactions

Any multi-statement write uses `withTransaction`. A service never writes `BEGIN`
or `COMMIT` — that way a transaction's boundaries are visible in one place, and a
service cannot half-apply a change and return success.

The activity log is the reason this matters: a logged change that did not happen,
or a change with no log, is the failure mode a plain log table always has.
