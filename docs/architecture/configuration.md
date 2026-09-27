# Configuration

Every backend variable is validated at startup by `src/config/env.ts` (data tier
and logging) and `src/config/app-env.ts` (everything the server serves), both
with Zod. A typo crashes the process at boot rather than becoming `undefined` on
a hot path three hours later.

**The two schemas exist because of a real failure.** `db:migrate` is a data-tier
tool — it applies DDL and reads nothing else. It used to import the full
application schema, so applying a migration required JWT secrets to be set. A CI
job with a perfectly good `DATABASE_URL` and no auth configuration failed at
startup, before connecting to anything:

```
Invalid environment configuration:
  - JWT_ACCESS_SECRET: Invalid input: expected string, received undefined
```

So the split is: **`DATABASE_*`, `LOG_LEVEL`, and `NODE_ENV` are validated by
everything; `PORT`, `HOST`, `CORS_ALLOWED_ORIGINS`, `JWT_*`, `BCRYPT_COST`,
`RATE_LIMIT_*`, and `TRUST_PROXY` are validated only by the server.** A pipeline
running migrations needs `DATABASE_URL` and nothing else.

If a variable is only read on a request path, demanding it before the process can
open a database connection is stricter than the code needs — and strictness that
blocks legitimate work gets worked around.

Two consequences worth knowing before you edit anything:

- **The app tier has no default for `DATABASE_URL`.** Without it the process
  refuses to start, which is the point: an app tier that boots with no database
  will take traffic and fail every request.
- **Placeholders are rejected in production.** `JWT_ACCESS_SECRET` and
  `JWT_REFRESH_SECRET` must differ, must be 48+ characters, and must not be one
  of the literal `.env.example` values. A deployment that booted with the
  committed example secret would accept tokens anyone can forge from the
  repository.

## Shared by the server and the migration CLI

These are in `config/env.ts`, so `npm run db:migrate` needs only `DATABASE_URL`.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test`, or `production`. `test` disables rate limiting |
| `LOG_LEVEL` | `info` | structured JSON to stdout at every level |

## App tier

These are in `config/app-env.ts`, so they are required only to serve requests.

| Variable | Default | Notes |
|---|---|---|
| `HOST` | `0.0.0.0` | |
| `PORT` | `8080` | the app tier's only listening port |

## Data tier

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | **required** | never sourced from a request, a header, or anything the browser can influence |
| `DATABASE_POOL_MAX` | `10` | sized against `DATABASE_STATEMENT_TIMEOUT_MS`, not guessed upward |
| `DATABASE_SSL` | `false` | `true` in Azure, where the app and database tiers are on a private network |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `15000` | a stuck query cannot hold a pool slot forever |

## Presentation tier

| Variable | Default | Notes |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | `localhost:5173` | comma-separated allowlist. A wildcard is rejected at startup |

CORS is an allowlist because the browser is the only place it is enforced. A
server-side `Access-Control-Allow-Origin: *` protects nothing on its own; it only
becomes a decision the browser makes about which origins may read responses.
Keep the header absent unless the origin is in the list — sending a wildcard
reflected from the request is `origin: true` with worse branding.

## Auth

| Variable | Default | Notes |
|---|---|---|
| `JWT_ACCESS_SECRET` | **required in production** | `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | **required in production** | a *different* random value |
| `JWT_ACCESS_TTL` | `15m` | short, because it is not revocable in the way a refresh token is |
| `JWT_REFRESH_TTL` | `7d` | long enough to be usable, short enough to matter |
| `BCRYPT_COST` | `12` | the cost applies to the data tier's CPU budget, not the app's latency target |

Two secrets rather than one is not tidiness. Access tokens are verified
statelessly, so a compromise of that secret means every unexpired access token
in the world is forgeable — unless refresh tokens are signed with a *different*
key, in which case an attacker with the access secret still cannot mint a
long-lived credential.

## Rate limits

| Variable | Default | Notes |
|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | `900000` | 15 minutes |
| `RATE_LIMIT_MAX` | `300` | general API budget |
| `AUTH_RATE_LIMIT_MAX` | `20` | `login`, `register`, `refresh` |

`TRUST_PROXY` defaults to `false` and takes the **number of trusted hops**, not
a boolean. This is the one setting where `true` is actively unsafe: the rate
limiter buckets by client IP, which it reads from `X-Forwarded-For`. Behind a
proxy that does not overwrite the header, `TRUST_PROXY=true` lets any client
choose its own bucket by setting the header itself, turning the limiter into a
no-op. Behind exactly one Application Gateway, it is `1`.

## The frontend has no environment file

Not an oversight. The API base is a same-origin `/api/v1` and the browser gets it
from the page's own origin, so there is nothing to bake into a build. That is the
reason the production build is byte-identical across environments: the same
bundle is served behind the internal host and behind the App Gateway domain, and
the SPA talks to whichever origin served it.

A `VITE_API_URL` would reintroduce the problem this avoids — a value baked in at
build time, so a single artefact cannot be promoted from staging to production
without a rebuild, and a rebuild is a chance to ship a wrong one.

The one thing that is environment-specific on the frontend is the token, and that
lives in `localStorage` — see
[ADR-0005](../adr/0004-access-token-in-local-storage.md).

## Changing a variable

1. Add or change it in `backend/.env.example` with the real default or a clear
   placeholder.
2. Add the schema entry in `backend/src/config/env.ts` or
   `backend/src/config/app-env.ts` — whichever half reads it. The example file
   and the schema are supposed to disagree only when one of them is wrong. Put it
   in `env.ts` only if a data-tier tool needs it; otherwise `app-env.ts`, so the
   migration CLI never demands a variable it does not read.
3. Note it here, including why the default is what it is.
4. If it is secret, confirm the value appears nowhere else: not in `docs/`, not
   in a test fixture, not in a committed `.env`.
