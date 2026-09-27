# AGENTS.md — TaskFlow 3-Tier Application

Instructions for AI agents (opencode, Claude Code, Copilot) working in this repository.
This file is the single source of truth for how agents must behave here.

## What this repository is

A production-style 3-tier web application built to be deployed on the Azure
platform described in `01-paper-design/` and `02-address-plan/`.

| Tier | Technology | Listen port |
|---|---|---|
| Presentation | React 19 + TypeScript + Vite | 8080 (served by Nginx) |
| Application | Node.js + Express + TypeScript | 8080 |
| Data | PostgreSQL 17 | 5432 |

Business domain: **TaskFlow** — a team task manager (users, projects, project
membership, tasks, comments, activity log).

## Current phase of the project

**Phase 1 — application code only.** The three tiers are being written. DevOps
work (Dockerfiles, Docker Compose, GitHub Actions, registry, IaC) has **not**
started yet.

## HARD RULE: no DevOps code from agents

Agents MUST NOT create, edit, suggest-as-final, or paste any of the following:

- `Dockerfile`, `*.Dockerfile`, `.dockerignore`
- `docker-compose.yml` / `docker-compose.yaml` / `compose.yml`
- Any file under `.github/workflows/`
- Terraform (`.tf`, `.tfvars`), Bicep, ARM templates
- Kubernetes manifests, Helm charts
- Shell scripts under `scripts/` that automate build/deploy
- CI/CD configs of any kind (Jenkinsfile, `.gitlab-ci.yml`, Azure Pipelines)

Agents MUST NOT paste the contents of these files into chat "just to show what it
should look like".

### What agents DO instead

1. **Explain the concept** — why it exists, what problem it solves, where it sits
   in the pipeline.
2. **State the requirements** — what the file must accomplish, expressed as a
   checklist of verifiable behaviours, not as syntax.
3. **Explain the reasoning** — which layer, which base image, why that order of
   instructions, what the cache invalidation point is.
4. **Review the learner's work** — read what they wrote, point out problems,
   explain *why* each problem matters.
5. **Point at the learning material** — `docs/guides/` holds the concept guides.

The learner writes all DevOps code. This is deliberate: the DevOps knowledge is
the resume, and it cannot be learned if an agent writes it.

Exception: agents MAY explain syntax in prose ("a Dockerfile is a sequence of
instructions, each creating a layer") and MAY show trivial illustrative snippets
clearly labelled as illustrative, never as a drop-in file for this repo.

## Repository layout

```text
Networking/
├── AGENTS.md                  # this file
├── README.md                  # project overview
├── 01-paper-design/           # network flows, NSG matrix (pre-existing)
├── 02-address-plan/           # CIDR plan (pre-existing)
├── 03-azure/                  # Azure CLI work (pre-existing)
├── application/
│   ├── backend/               # Node.js + Express + TypeScript API
│   ├── frontend/              # React + TypeScript + Vite SPA
│   └── db/                    # SQL migrations + seed data
└── docs/
    ├── architecture/          # diagrams, data model, request lifecycle
    ├── adr/                   # architecture decision records
    ├── api/                   # REST API reference
    └── guides/                # learning guides (incl. future DevOps phases)
```

## Architecture rules the code must respect

These are not style preferences. They are the security posture described in
`01-paper-design/traffic-flows.md`. Any change that breaks them is a bug.

1. **The database is never exposed.** Only the app tier may reach 5432. The
   backend must not read `DATABASE_URL` from anything the browser can influence.
2. **CORS is an allowlist.** Never `origin: true` or `*` in production. Allowed
   origins come from an env var and default to localhost only.
3. **Every SQL statement is parameterised.** No string interpolation into SQL,
   ever — including for ORDER BY and dynamic filters, which use an allowlist.
4. **All money/priority-like input is validated at the boundary** with a schema
   before it reaches a handler.
5. **Authorisation is checked per resource, not per route.** Knowing a task id is
   not permission. Every task/project read or write resolves membership first.
6. **Errors never leak internals.** 500 responses return a correlation id only.
   Stack traces go to logs, never to the response body.
7. **Secrets come from the environment.** No secret literals in source, and
   `.env.example` contains placeholders only.
8. **Structured logs, no PII/secrets.** JSON logs to stdout, ready for a log
   collector. Never log passwords, tokens, or full request bodies.

## Backend conventions

- **Layering:** `route → middleware → service → repository → database`.
  Handlers never write SQL. Repositories never contain business rules.
- **Validation:** zod schemas at the route boundary. Types are *inferred* from
  the schema (`z.infer`) so a schema change cannot drift from the type.
- **Errors:** throw `AppError` subclasses. A single error middleware converts
  them to the response envelope. Never `throw new Error()` in a service.
- **Migrations:** plain SQL in `application/db/migrations`, applied in
  filename order, each wrapped in a transaction, recorded in a
  `schema_migrations` table. No ORM, no auto-sync.
- **IDs:** `uuid` generated by PostgreSQL (`gen_random_uuid()`), never in app
  code, so the ID space is consistent regardless of which tier inserts.
- **Timestamps:** `timestamptz`, always UTC. The database is the only clock that
  matters for ordering.
- **Transactions:** any multi-statement write uses `withTransaction`. Never
  `BEGIN`/`COMMIT` inline in a service.
- **Testing:** Vitest + Supertest against a real PostgreSQL test database.
  Every endpoint that can be authorised incorrectly has a negative test.
- **Module system:** ESM (`"type": "module"`), NodeNext resolution, `.js`
  extensions in relative imports.

## Frontend conventions

- **Server state vs UI state.** Anything from the API is TanStack Query, never
  `useEffect` + `useState`. `useState` is for things like "is the menu open".
- **The API client is the only place that knows the base URL.** Components use
  hooks, never `fetch` directly.
- **Tokens live in `localStorage` with an in-memory mirror.** On a 401 the
  client refreshes once, then redirects to login. No refresh-token retry loop.
- **Route components are thin.** Fetching and shaping data belongs in hooks;
  rendering belongs in the component.
- **Every list view has three states:** loading, error, empty. Shipping only the
  happy path is considered incomplete.
- **Accessibility:** labelled form fields, keyboard-reachable actions, visible
  focus. A button is a `<button>`, not a styled `<div>`.
- **No design system dependency.** Plain CSS with custom properties. Fewer
  dependencies is a better story.

## Style

- TypeScript `strict` mode, no `any`. `unknown` plus narrowing when parsing.
- 2-space indent, single quotes, no semicolon-free style — match the file.
- Prefer named exports.
- Comments explain *why*, never *what*. If a line needs a comment to explain what
  it does, rename something instead.
- No file over roughly 300 lines. Split by responsibility.

## Definition of done for a change

Before reporting a change complete, an agent must:

1. `npm run typecheck` passes in every package it touched.
2. `npm test` passes, including new negative/authorisation tests.
3. `npm run lint` passes.
4. Migration files, if any, are pure SQL and reversible in intent (down section
   or a documented note on why not).
5. New env vars are added to `.env.example` **and** documented in
   `docs/architecture/configuration.md`.
6. No secret, token, or real credential appears anywhere in the diff.

Never claim a check passed without running it.

## Guidance tone for DevOps topics

When the learner asks about Docker, CI, or the cloud, agents should:

- Start with the problem the tool solves, not the syntax.
- Connect it to this repo's architecture (which tier, which port, which subnet).
- Give a checklist of requirements and let the learner implement.
- Offer to review their file afterwards and explain the review.
- Suggest a way to *prove* it works (a command, an observable symptom).
- Point to the relevant guide in `docs/guides/`.
