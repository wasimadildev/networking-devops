# Data model

PostgreSQL 17. Plain SQL migrations, no ORM. Every rule that matters is enforced
by a constraint, a trigger, or a unique index rather than by application code —
so an `UPDATE` issued by a future script, a psql session, or a mistaken endpoint
cannot bypass it.

Migrations live in `application/db/migrations`, are applied in filename order,
each in a transaction, and are recorded in `schema_migrations`. They are
forward-only: reverting a change means writing a new migration, not running a
down script. See [ADR-0006](../adr/0006-migrations-without-down.md).

```bash
npm run db:migrate   # apply pending migrations
npm run db:status    # what is applied, and whether any checksum has drifted
npm run db:seed      # load demo fixtures
```

## Tables

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | `gen_random_uuid()`, never generated in app code |
| `email` | `citext` | unique; case-insensitive, so `A@B.com` and `a@b.com` are one account |
| `password_hash` | `text` | bcrypt. Never leaves the database — no repository selects it except for login |
| `display_name` | `text` | shown everywhere the user appears |
| `role` | `user_role` | `member` or `admin`; unrelated to per-project roles |
| `is_active` | `boolean` | a deactivated account keeps its rows but cannot authenticate |
| `last_login_at` | `timestamptz` | set on successful login only |

`password_hash` is absent from every row type except the one used by the login
path. A type that omits a column is a type that cannot leak it.

### `refresh_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | |
| `user_id` | `uuid` | → `users` |
| `token_hash` | `text` | SHA-256 of the token. The token itself is never stored |
| `family_id` | `uuid` | shared by every token descended from one login |
| `expires_at` | `timestamptz` | |
| `revoked_at` | `timestamptz` | set on use (rotation) and on logout |
| `user_agent`, `ip_address` | `text`, `inet` | recorded for a "sign out everywhere" audit |

Rotation and reuse detection live here. Presenting a token that is already
revoked revokes the entire `family_id` — see
[ADR-0003](../adr/0003-rotating-refresh-tokens.md).

### `projects`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | |
| `name` | `text` | |
| `slug` | `project_slug` | unique; lowercase letters, numbers, single hyphens |
| `description` | `text` | nullable |
| `owner_id` | `uuid` | → `users` |
| `status` | `project_status` | `active` or `archived` |

### `project_members`

Composite primary key `(project_id, user_id)`, with `role` in `member_role`:
`owner`, `editor`, `viewer`.

A project's owner is both `projects.owner_id` and a `project_members` row with
role `owner`. Those two facts can disagree, so the database refuses to let them:
see [The owner invariant](#the-owner-invariant).

### `tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | |
| `project_id` | `uuid` | → `projects` |
| `title`, `description` | `text` | description nullable |
| `status` | `task_status` | `todo`, `in_progress`, `done` |
| `priority` | `task_priority` | `low`, `medium`, `high`, `urgent` |
| `assignee_id` | `uuid` | nullable, and must be a member of the same project |
| `created_by` | `uuid` | → `users` |
| `due_at` | `timestamptz` | nullable |
| `position` | `integer` | ordering within a column, assigned by the server |
| `completed_at` | `timestamptz` | set by trigger on the transition to `done` |

`completed_at` is derived, not set by the application. A trigger keeps it in step
with `status`, so a task cannot claim to be done without a completion time or
carry a stale one after being reopened.

### `comments`

`id`, `task_id`, `author_id`, `body`, `created_at`, `updated_at`. A comment has
no status: deleting it is the only removal, and the rule about who may do that
lives in the authorisation layer, not the schema.

### `activity_log`

`id` (`bigint`), `actor_id`, `project_id`, `entity_type`, `entity_id`, `action`
(an enum), `metadata` (`jsonb`), `created_at`.

Append-only and written inside the same transaction as the change it records, so
the log cannot disagree with the data.

## Ordering and cursors

Lists are ordered by `(created_at DESC, id DESC)` and paginated with an opaque
keyset cursor: base64url of `createdAt|uuid`, decoded and rejected as a 400 if it
is malformed. Keyset rather than `OFFSET` because `OFFSET` skips rows when
anything is inserted mid-scroll, and re-reads rows that were already seen.
`id` breaks ties so two rows with the same timestamp cannot swap places between
requests.

## Invariants the database enforces

These are the rules worth defending in review, because each one has been a real
bug in a version of this app that relied on the service layer instead.

### The owner invariant

A project must always have exactly one owner membership.

- `enforce_project_has_owner()` is a `BEFORE DELETE OR UPDATE OF role` trigger on
  `project_members`. It raises when the change would leave the project with no
  owner, so the last owner cannot be demoted or removed.
- `promote_member_to_owner(project, current_owner, new_owner)` performs a
  transfer atomically: it promotes the new owner and demotes the old one to
  editor in one transaction, so there is no instant where the project has two
  owners or none.

The API refuses an owner removing themselves with a 422, and the UI hides the
button — but neither is the guarantee. The trigger is.

### Content is not blank

`0013_content_not_blank.sql` adds checks that a trimmed value is non-empty for
user display names, emails, task titles and comment bodies, plus length bounds
matching the Zod schemas.

### Every task timestamp is `timestamptz`

The database is the only clock that matters for ordering. The application never
writes a timestamp it generated itself, so no tier can be a source of skew.

## Why ids are generated in the database

`gen_random_uuid()` in the column default means every tier that inserts produces
ids from one space, and the application cannot accidentally mint a colliding or
malformed id. It also means an insert that omits the id still works — the default
is not an optional convenience, it is the mechanism.
