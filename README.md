# TaskFlow

A three-tier task manager, built to the network and security design in
`01-paper-design/` and `02-address-plan/`, with the application tiers written as
the thing those designs are for.

**TaskFlow** is a team task manager: users, projects, memberships, tasks,
comments, and an activity log.

| Tier | Technology | Port | Reachable from |
|---|---|---|---|
| Presentation | React 19 + TypeScript + Vite | 8080 (served by Nginx) | App Gateway |
| Application | Node.js + Express 5 + TypeScript | 8080 | Web subnet only |
| Data | PostgreSQL 17 | 5432 | App subnet only |

Nothing reaches the data tier except the application tier, and that is enforced
in three independent places: an NSG on the subnet, no public route to 5432, and
a backend that reads `DATABASE_URL` from its own environment and never from a
request.

## Layout

```text
01-paper-design/      network flows and the NSG matrix
02-address-plan/      the CIDR plan
03-azure/             Azure CLI work
04-troubleshooting/   symptom-first fixes
application/
  backend/            Express API
  frontend/           React SPA
  db/                 SQL migrations and seed data
docs/
  architecture/       data model, request lifecycle, configuration
  api/                REST reference
  adr/                decisions, with the alternatives
  guides/             learning material
```

## Running it locally

Requires Node 20+ and PostgreSQL 17.

```bash
# data tier
createdb taskflow_dev

# application tier
cd application/backend
cp .env.example .env          # then edit DATABASE_URL and the two JWT secrets
npm install
npm run db:migrate
npm run db:seed
npm run dev                   # :3000 locally, :8080 in the example env

# presentation tier, in another shell
cd application/frontend
npm install
npm run dev                   # :5173, proxying /api to the backend
```

The frontend needs no environment file: the API is same-origin at `/api/v1`, so
one build artefact is valid in every environment. See
[configuration](docs/architecture/configuration.md).

### Demo accounts

The seed creates four users, all with the password `Passw0rd!`:

| Email | Platform role | Membership | What they demonstrate |
|---|---|---|---|
| `ada@taskflow.dev` | admin | owns Platform Migration | owner-only actions: add member, transfer ownership, archive |
| `grace@taskflow.dev` | member | editor on Platform Migration, **owns** Observability Rollout | the interesting case: not an admin, but an owner somewhere |
| `alan@taskflow.dev` | member | viewer on Platform Migration | read-only, can still comment |
| `edsger@taskflow.dev` | member | editor on Observability Rollout | a non-member of Platform Migration, so every route on it answers 404 — see [ADR-0002](docs/adr/0002-not-found-versus-forbidden.md) |

`grace` is deliberately both a non-admin editor and an owner. It is the account
that catches a check which has conflated "platform admin" with "project owner":
neither role implies the other.

`users.role` (`member` | `admin`) is validated and stored, but **no
authorisation check reads it**. An admin does not bypass project membership, and
there is no administrative endpoint. That is deliberate for now — a global role
that quietly overrides per-resource membership is the shortest route to the
enumeration problem in [ADR-0002](docs/adr/0002-not-found-versus-forbidden.md).
If an admin capability is ever added, it should be an explicit endpoint with its
own audit trail, not a branch inside the membership check.

## Verifying it

```bash
cd application/backend  && npm run typecheck && npm run lint && npm test
cd application/frontend && npm run typecheck && npm run lint && npm test
npm run smoke           # 75 real HTTP checks against a running backend
```

`npm run smoke` starts nothing itself — it expects a backend on `$PORT` and talks
to it over HTTP, so it proves the deployed-shaped path rather than a mock.

## The parts worth reading

- [Data model](docs/architecture/data-model.md) — the schema, and the invariants
  the database enforces rather than trusting the service layer.
- [Request lifecycle](docs/architecture/request-lifecycle.md) — a click to a row,
  and every point along the way that can refuse.
- [REST API](docs/api/rest-api.md) — envelopes, status codes, and the endpoints
  that deliberately do not exist.
- [Configuration](docs/architecture/configuration.md) — every variable, and why
  its default is what it is.
- [ADRs](docs/adr/) — the decisions with real alternatives, including the ones
  that are compromises.

## Security posture

The rules that are architecture, not preference — breaking one is a bug, not a
style choice:

1. The database is never exposed. Only the app tier reaches 5432.
2. CORS is an allowlist from an env var, defaulting to localhost. Never `*`.
3. Every SQL statement is parameterised, including dynamic ORDER BY, which comes
   from a `const` allowlist.
4. Input is validated at the boundary with Zod, and types are inferred from the
   schema so the two cannot drift.
5. Authorisation is per resource. Knowing a task id is not permission; every
   read and write resolves project membership first.
6. Errors never leak internals. A 500 returns a correlation id; the stack trace
   goes to the log.
7. Secrets come from the environment, and `.env.example` holds placeholders only.
8. Logs are JSON to stdout with no PII, no tokens, and no request bodies.

Two of these were bugs first. `GET /users` once returned every account to any
authenticated caller, and adding a project member once accepted a `userId` that
had to be discovered from that same endpoint. Both are written up in
[ADR-0007](docs/adr/0007-no-user-directory.md).

## Deployment

Deployment is the learner's work — this repository contains no Dockerfile, no
Compose file, no CI workflow, and no infrastructure-as-code, by design
(`AGENTS.md`). `docs/guides/` holds the concepts and the requirement checklists;
the artefacts themselves are meant to be written, not copied.
# networking-devops
