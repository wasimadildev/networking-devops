# REST API

Base path `/api/v1`. All request and response bodies are JSON. Authenticated
requests carry `Authorization: Bearer <access token>`.

## Response envelopes

Success, single resource:

```json
{ "data": { "id": "…", "name": "Networking" } }
```

Success, paginated list:

```json
{ "data": [ … ], "pageInfo": { "hasNextPage": true, "nextCursor": "eyJ…" } }
```

`pageInfo` carries no total count. A keyset cursor cannot report one without
counting the whole table, and a count that is wrong by the time it renders is
worse than none.

Success, no content: `204` with an empty body.

Failure — every non-2xx response, with no exceptions:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Request validation failed",
    "requestId": "ff3e0606-fac4-472e-b036-ac1592d6e96c",
    "details": [{ "path": "email", "message": "Enter a valid email address" }]
  }
}
```

`requestId` matches the `req.id` in the server's structured logs. It is the only
internal detail ever returned; stack traces and SQL never leave the process.
`details` is an **array** of `{ path, message }` issues, not a field-keyed map —
one entry per failed rule, so a single field can appear several times.

Codes: `bad_request`, `validation_failed`, `unauthenticated`,
`invalid_credentials`, `forbidden`, `not_found`, `conflict`, `unprocessable`,
`rate_limited`, `internal_error`.

## Status codes with a specific meaning here

| Code | Used for |
|---|---|
| `400` | malformed JSON, or an undecodable pagination cursor |
| `401` | missing, expired, or unusable access token; also an invalid or replayed refresh token |
| `403` | authenticated, but the caller's project role does not permit the action |
| `404` | absent **or** not visible to this caller. See below |
| `409` | a uniqueness conflict — duplicate slug, already a member |
| `422` | well-formed but semantically invalid — a malformed cursor, a malformed uuid, a state change the rules forbid |
| `429` | rate limited, on the auth routes |

**Why 404 for a non-member.** Asking about a project you do not belong to returns
404, not 403. A 403 confirms the project exists, which turns the API into an
enumeration oracle for project ids. Once you are a member, an action your role
cannot perform returns 403, because at that point the project is already known to
you.

## Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/register` | rate limited. Creates the user and signs in |
| `POST` | `/auth/login` | rate limited. Identical response for a wrong password and an unknown address |
| `POST` | `/auth/refresh` | rotates the refresh token, returns a new access token **and the user** |
| `POST` | `/auth/logout` | revokes one refresh token. 204 |
| `POST` | `/auth/logout-all` | revokes every session for the user. 204 |
| `POST` | `/auth/change-password` | requires the current password; returns `{ sessionsRevoked }` |

`login` and `register` return:

```json
{ "data": { "accessToken": "…", "refreshToken": "…", "user": { … } } }
```

`refresh` returns the same shape, which is why the SPA can restore a session in
one request rather than refreshing and then calling `/users/me`.

## Users

| Method | Path | Notes |
|---|---|---|
| `GET` | `/users/me` | the caller |
| `PATCH` | `/users/me` | `{ displayName }` |
| `GET` | `/users` | `?search=&limit=` — **scoped, not a directory.** See below |

`GET /users` returns a bare `{ data: User[] }` with no `pageInfo`: it is a lookup
box for the add-member field, not a browsable list. It returns only accounts that
share at least one project with the caller. A user with no projects sees nobody,
including themselves.

That scoping is not decoration. The unscoped version returned every active
account's name and email to anyone holding a valid token — a complete account
directory, handed out by the same deployment whose login endpoint goes to some
trouble to answer identically for "wrong password" and "no such account".

## Projects

| Method | Path | Role |
|---|---|---|
| `GET` | `/projects` | any member. `?status=active\|archived&search=&cursor=&limit=` |
| `POST` | `/projects` | any authenticated user; the creator becomes owner |
| `GET` | `/projects/:projectId` | member |
| `PATCH` | `/projects/:projectId` | owner for `status`; editor for `name`/`description` |
| `GET` | `/projects/:projectId/board` | member. Tasks grouped by status |
| `GET` | `/projects/:projectId/activity` | member |

A project detail carries `viewerRole`, `memberCount`, `taskCount` and
`openTaskCount` — computed in the query, so the client never has to fetch three
lists to render a card.

### Members

| Method | Path | Role |
|---|---|---|
| `GET` | `/projects/:projectId/members` | member |
| `POST` | `/projects/:projectId/members` | owner. Body: `{ email, role }` |
| `PATCH` | `/projects/:projectId/members/:userId` | owner. Body: `{ role }` |
| `DELETE` | `/projects/:projectId/members/:userId` | owner. 204 |

**Adding takes an email, not a user id.** An id-based body needs the client to
have discovered the id somewhere, and the only place to find a stranger's id is a
user directory — the endpoint that had to be removed. Moving the resolution
server-side means the directory never has to exist. A project owner can still
learn whether one address they typed has an account, which is a real but far
narrower disclosure: it requires already being an owner, and answers only the
exact address given, not every prefix of it.

Re-adding an existing member is a **409**, not a silent role change. The
repository once upserted on conflict, so adding a current editor as a viewer
returned 201 and demoted them while the service's `ConflictError` sat unreachable
in the catch block.

## Tasks

| Method | Path | Role |
|---|---|---|
| `GET` | `/projects/:projectId/tasks` | member. `?status=&priority=&assignedToMe=&search=&cursor=&limit=` |
| `POST` | `/projects/:projectId/tasks` | editor |
| `GET` | `/tasks/:taskId` | member of the owning project |
| `PATCH` | `/tasks/:taskId` | editor |
| `POST` | `/tasks/:taskId/move` | editor. Body: `{ status, position }` |
| `DELETE` | `/tasks/:taskId` | editor |

There is no cross-project task list. Tasks are always scoped to a project, which
means a dashboard showing "assigned to me" would need a new endpoint rather than
a new query parameter — noted rather than faked, because a filter applied after
fetching every project the user belongs to would leak their own task titles into
a component that has no project context to check them against.

## Comments

| Method | Path | Role |
|---|---|---|
| `GET` | `/tasks/:taskId/comments` | member. Oldest first |
| `POST` | `/tasks/:taskId/comments` | any member, including a viewer |
| `PATCH` | `/comments/:commentId` | the author only |
| `DELETE` | `/comments/:commentId` | the author, or an editor |

Viewers can comment but not create or edit tasks. That is deliberate: reading and
participating are cheap to grant, changing shared state is not.

## Health

`GET /health` and `GET /health/ready`. Unauthenticated, and outside `/api/v1`.
`/health/ready` reports the database round trip, which is what a load balancer
needs to know before sending traffic.

## Rate limiting

The auth routes (`register`, `login`, `refresh`) are limited per IP. The limit is
skipped when `NODE_ENV=test` so the suite is not throttled by its own volume of
requests — a limit that behaves differently under test is not being tested.

## What is deliberately absent

- **No `userId` on the add-member body.** See above.
- **No cross-project task endpoint.** See above.
- **No field indicating whether an email is registered.** The only place that
  would answer it is the add-member action, reachable by project owners only.
- **No account deletion, password reset by email, or invitations.** Each needs an
  outbound mail path, and a token that survives in a log is worse than a missing
  feature.
