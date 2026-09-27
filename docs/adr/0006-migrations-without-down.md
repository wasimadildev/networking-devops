# ADR-0006: Migrations forward-only, with a recorded history

Date: 2026-09-27 · Status: accepted

## Context

`application/db/migrations` is a directory of plain `.sql` files, applied in
filename order, each inside a transaction, recorded in `schema_migrations`.

The obvious question is why there are no `down` sections. The convention in most
ORMs is a pair of files, and its purpose is rollback: undo the last migration when
a deploy goes wrong.

## Decision

Migrations are forward-only. Each file is wrapped in a transaction, so a failure
part-way leaves the schema untouched — a migration either applies completely or
not at all. Reverting means writing a **new** migration that undoes the change.

## Why not down migrations

A down script is a second, untested implementation of the same change, and it
drifts. Nobody runs it until the day it matters, which is the day the schema has
already moved on. In this project specifically, the down path for
`0012_project_owner_invariant.sql` would have to reverse a trigger and a
function, and reversing it halfway is how a project ends up with two owners.

Forward-only also has an operational property: `schema_migrations` is a truthful
record of what has been applied. With paired up/down files, a database's actual
state is a function of the entire applied history including rollbacks, and
reconstructing it requires reading the file rather than querying the database.

What replaces rollback is: forward migrations that are small enough to write a
correction for, and the transaction boundary that guarantees a failed one is a
no-op.

## A `down` command was removed, deliberately

The migration CLI originally had `db:rollback`, which deleted the most recent row
from `schema_migrations` and nothing else — the SQL file is not stored, so the
runner could not reverse the DDL, and it said so in a log line that nobody reads
at 2am.

It was removed because it was a footgun, and the failure is worse than a failed
command. Sequence: apply 13 migrations → `db:rollback` (record for `0013`
deleted, constraints still on the table) → `db:migrate` (re-runs `0013` against a
schema that already has it):

```
constraint "users_email_non_blank" for relation "users" already exists
```

Every subsequent migration run now fails at `0013` forever. `schema_migrations`
says a migration was never applied while its constraints exist, so the one thing
this design is for — a truthful record — is now false. Recovery is manual SQL to
re-insert the record, or dropping and recreating the database.

A command whose only effect is to leave the database in a state that no longer
migrates should not exist, so it does not. Reverting a schema change means writing
a new numbered migration that undoes it, which is a reviewable, tested artefact
rather than a side effect.

**If you have already run `db:rollback`:** the constraints are still in place, so
re-insert the record with the checksum the runner expects — take the value from
the file and the migrator's checksum function, or simply drop and recreate the
database, which is cheaper and is the right move for a dev database.

## The transactional boundary, precisely

A migration is applied as:

1. `BEGIN`
2. the file's statements
3. `INSERT INTO schema_migrations (name) VALUES ($1)`
4. `COMMIT`

The record and the schema change commit together. A migration cannot be recorded
without having applied, and cannot apply without being recorded — which is the
property that makes the recorded history trustworthy. Note that
`CREATE INDEX CONCURRENTLY` cannot run inside a transaction; no migration here
uses it, and a future one that does must document the exception rather than
silently moving it out of the boundary.

## Alternatives

| Option | Why not |
|---|---|
| Up/down pairs | the down half is unexercised code, and the drift is silent |
| An ORM with auto-sync | the schema stops being reviewable, and a dev's local run can mutate production's shape |
| `db push`-style sync | no history, no ordering, no transaction boundary |
| Hand-written `schema.sql` | one file that cannot describe how the current state was reached, and no way to apply an incremental change safely |

## Consequences

- Rollback of an application is decoupled from rollback of the schema. Deploy
  code that is compatible with both the old and new schema, then migrate.
- Adding a column that the old code ignores is the normal way to release a
  change; removing one takes two deploys.
- A migration that turns out to be wrong is corrected by a new numbered file. The
  wrong one stays in the history, which is honest.
