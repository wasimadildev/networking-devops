# ADR-0001: Plain SQL with hand-written repositories, no ORM

Date: 2026-09-27 · Status: accepted

## Context

The data tier is PostgreSQL 17, and the domain uses features an ORM would mostly
route around: `citext`, partial unique indexes, composite primary keys, enums, a
`BEFORE` trigger guarding project ownership, a `jsonb` activity log, and keyset
pagination.

## Decision

No ORM. `pg` with hand-written repositories, one per table, returning plain
objects. Every statement is parameterised, and dynamic fragments (ORDER BY,
filters) are chosen from a fixed allowlist in code rather than interpolated.

Layering is `route → middleware → service → repository → database`. Handlers never
write SQL; repositories contain no business rules.

## Why

- **The schema *is* the design.** An ORM's value is mapping a schema you did not
  choose. Here the constraints are the point — `0012_project_owner_invariant.sql`
  is a trigger and a function, and no ORM maps that as a first-class concept. The
  parts an ORM would model well are the easy parts.
- **Keyset pagination needs raw SQL anyway.** `(created_at, id) < ($1, $2)` is
  exactly the case where a query builder stops helping and starts generating
  parentheses.
- **Parameterisation becomes auditable.** With no query builder, every value in
  every statement is a `$n`, and an interpolated identifier cannot hide among
  builder calls. The ORDER BY allowlist is a `const` array, not a runtime check.
- **The layering stays honest.** A repository that needs to know about roles
  cannot express them without becoming a service, so the boundary is enforced by
  what each layer can import.

## The cost, stated plainly

More code, and a real risk of drift between a hand-written query and the schema.
That risk is answered by integration tests against a real PostgreSQL — the
suite runs against the actual database, so a column rename breaks the build
rather than production. The tests would be weaker against a mocked data layer,
which is the main reason an ORM is usually paired with one.

## Alternatives

| Option | Why not |
|---|---|
| Prisma | generates a client that has to model triggers, enums, and raw keyset queries anyway |
| TypeORM / ActiveRecord-style | a repository layer that grows business rules in it, and decorators that hide the SQL being emitted |
| Knex / query builder | reasonable, but it is a thin wrapper over `pg`; the wrapper would need extending for the keyset and allowlist cases, so it is one more layer to read |
| Raw `pg` everywhere, no repositories | SQL would leak into services, and there would be nowhere to put parameterisation discipline |

## Consequences

- Queries are hand-written and reviewable; a reviewer can see the joins, the
  locks, and the parameters in one file.
- New reports mean new SQL, not a new migration of generated code.
- The repository count is the table count. That is a fine ratio.
