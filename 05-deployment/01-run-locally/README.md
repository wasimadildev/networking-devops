# Phase 01 — Run it locally

The first deployment phase is not a container. It is proving the application runs
on a machine that is not your editor, with a real database and nothing else
running.

This matters more than it sounds. Every later phase — image, pipeline, Azure —
assumes the application *starts*. If it only starts because of something on your
machine, every one of those phases fails for a reason that has nothing to do with
the thing you are building, and you will be debugging two problems while trying
to learn one.

No Docker, no CI, no infrastructure code in this phase. That comes later, in
[`docs/guides/`](../../docs/guides/).

---

## What was fixed before this phase worked

While checking this path, a security bug was found and fixed. It is worth
recording, because the shape of it is the kind of mistake that survives review
and reaches production.

**The bug.** The app would boot in production using the secret from
`.env.example` — a value committed to the repository. The validation rejected
secrets *containing* the words `change` or `secret`, but the placeholder that
actually ships is `replace-with-openssl-rand-base64-48-output`, which contains
neither word. So the exact value the repository publishes passed the check that
was supposed to stop it.

**Why it mattered.** An access token is signed with that secret. A deployment
booting with a published signing key means anyone who has read the repository can
forge a valid token for any user id, including an owner. It is not a slow leak;
it is not a leak at all until someone uses it.

**Why the original check failed.** It guessed at what a bad value *looks like*
instead of rejecting the values that are *known to be bad*. A heuristic denylist
fails open, and it fails open silently, in production, where the test coverage is
thinnest.

**The fix.** Reject the literal placeholder strings from `.env.example` by
exact match, plus any secret under 48 characters (`openssl rand -base64 48`
produces 64). Verified by live boot — production mode now refuses to start:

```
Invalid environment configuration:
  - JWT_ACCESS_SECRET: JWT_ACCESS_SECRET is still the .env.example placeholder;
    generate one with: openssl rand -base64 48
```

Regression tests live in `application/backend/tests/env.test.ts` (16 cases, one per
known placeholder). Backend suite: **188 tests**, up from 172.

The transferable lesson: a check should name the specific bad values it knows
about. A check that pattern-matches on words is a guess wearing a test's
clothing.

---

## Prerequisites

| | |
|---|---|
| Node | 20+ (this machine: v24.7.0) |
| PostgreSQL | 17+ (this machine: 17.11) |
| Ports | 5432 database, 3000 backend, 5173 frontend |

## Step 0 — check your state before you start

Run these first. Every one of them is a question whose answer changes what you do
next, and each takes a second.

```bash
# 1. Is Postgres actually running? (blank result = nothing listening)
lsof -nP -iTCP:5432 -sTCP:LISTEN

# 2. Do the ports this project needs exist? Replace 3000 with 8080 and 5173 to repeat.
lsof -nP -iTCP:3000 -sTCP:LISTEN

# 3. Does the database exist? Ask postgres directly rather than listing
#    databases, so the result is one clear yes/no instead of a table of names.
psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'taskflow_dev'"

# 4. Is the backend .env real, or still the committed placeholders?
cd application/backend
grep -c "replace-with" .env        # must be 0
```

If (2) shows something holding 3000, find out what before starting:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN     # note the PID
ps -p <pid> -o command=              # what is it?
kill <pid>                           # or change PORT in .env instead
```

> **A boot failure on an occupied port is not an application bug.** It presents
> as one: `EADDRINUSE`, no log output, and a server that appears to have
> crashed. Check the port before you start reading code.

## Step 1 — database

Normally nothing to do; the database is already migrated. Only run this to
reset the demo data.

```bash
cd application/backend
npm run db:status     # expect 13 applied, no checksumMismatch
npm run db:seed       # reloads the 4 demo users; safe to repeat
```

`npm run db:seed` deletes and recreates `ada@`, `grace@`, `alan@`, and
`edsger@`. Prefer it over `dropdb` when you only want the demo accounts back —
other rows may reference them.

Expected from `db:status`: 13 migrations, every `applied: true`, and no
`checksumMismatch`. A mismatch means a migration file was edited after being
applied, which forward-only migrations cannot reconcile — see
[ADR-0006](../../docs/adr/0006-migrations-without-down.md).

## Step 2 — backend (terminal 1)

```bash
cd application/backend
npm run dev
```

Expect a JSON log line: `TaskFlow API listening`, on **port 3000**. The local
`.env` overrides the example's 8080; if you have not edited it, you are on 8080.

Confirm, in a second terminal:

```bash
curl -fsS localhost:3000/health
curl -fsS localhost:3000/health/ready
```

`/health/ready` is the one that matters. It performs a real database round trip
and reports latency:

```json
{"data":{"status":"ready","checks":{"database":{"ok":true,"latencyMs":1.05},
  "pool":{"total":1,"idle":1,"waiting":0}}}}
```

`status: ready` proves your database credentials work. `/health` alone does not
— it answers `ok` whether or not the database exists, which is by design: a
liveness probe that fails when the database is down would have the orchestrator
restarting a healthy process.

## Step 3 — frontend (terminal 2)

```bash
cd application/frontend
npm run dev
```

Open **http://localhost:5173** and sign in:

| Email | Password |
|---|---|
| `ada@taskflow.dev` | `Passw0rd!` |
| `grace@taskflow.dev` | `Passw0rd!` |
| `alan@taskflow.dev` | `Passw0rd!` |
| `edsger@taskflow.dev` | `Passw0rd!` |

All four are seeded with the same password (see the comment at the top of
`application/db/seed/0001_seed_demo.sql`). `ada` is the platform admin and owns
Platform Migration; `grace` is a plain member who owns a *different* project,
which is the account that proves platform role and project role are independent.

## Why the frontend has no `.env`

There is no `application/frontend/.env`, and that is deliberate. It is the first
design decision that pays off in this phase.

The SPA calls a **relative** `/api/v1`. In development, `server.proxy` in
`vite.config.ts` forwards that to the backend. In production, Nginx does the
same job. Two consequences:

**CORS is never exercised locally.** Because every request is same-origin, the
`CORS_ALLOWED_ORIGINS` allowlist is effectively untested by `npm run dev`. A CORS
misconfiguration ships silently and fails only once the origins are actually
split. Know that a green local run tells you nothing about CORS.

**One bundle is valid everywhere.** Nothing environment-specific is baked in at
build time, so the same artefact can be promoted from staging to production with
no rebuild — and a rebuild is a chance to ship a wrong value.

## Step 4 — optional: prove the built artefact runs

The most valuable step in this document, and the one most often skipped.

```bash
cd application/backend
npm run build
npm start          # serves dist/ on PORT — needs 8080 free
```

This runs `node dist/server.js`, which is the exact entry point a container will
run. If this works, the image you build in the next phase has one fewer unknown
in it. If it fails, you have found the problem with no container in the way.

## What this phase does *not* prove

Know these gaps before trusting a green run. Each one is real, and each is why
the next phases exist:

| Gap | Why it is not covered here |
|---|---|
| CORS | all local requests are same-origin |
| Dependency integrity | `npm ci` from a lockfile, not your `node_modules` |
| Reproducible build | your machine has the toolchain already |
| Non-root execution | you ran as your own user, which is fine locally |
| Graceful shutdown | you stopped with Ctrl-C, which the process handled |
| Configuration from environment | your `.env` is a file on disk, not injected |
| Log collection | JSON went to your terminal, not to a collector |
| Network isolation | backend and database are both on localhost |

## Next

[`docs/guides/containerising.md`](../../docs/guides/containerising.md) — the
problem each image solves, the decisions, and the checklist to review your own
Dockerfiles against. The artefacts are yours to write; see `AGENTS.md` for why.
