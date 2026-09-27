# ADR-0003: Rotating refresh tokens with reuse detection

Date: 2026-09-27 · Status: accepted

## Context

The SPA needs a session that survives a page reload without keeping a usable
credential in a cookie, and the API needs a way to end a session. That second
requirement is what forces the design: a self-contained JWT cannot be revoked, so
a logout button over a long-lived token is a suggestion rather than an action.

## Decision

A refresh token is a random opaque string. Only its **SHA-256 hash** is stored, in
`refresh_tokens`, alongside a `family_id` shared by every token descended from
one login.

- On refresh, the presented token is revoked and a new one is issued in the same
  family. The old token stops working the moment the new one is issued.
- If a token that is **already revoked** is presented, that is either a replay or a
  stolen token that outlived its replacement. Either way the whole family is
  revoked and the user must sign in again.
- Logout revokes the presented token. `logout-all` revokes every row for the
  user.
- Every authenticated request re-checks that the user still exists and is
  `is_active`, so deactivating an account ends its sessions immediately rather
  than at token expiry.

## Why reuse detection is the load-bearing part

Rotation without detection is only marginally better than a long-lived token. If
a token is stolen, the legitimate client refreshes first, gets a new token, and
carries on — and the thief's next refresh of the old token succeeds too. Nothing
distinguishes the two.

Detection turns the ambiguity into a decision. A revoked token is never
legitimately presented twice, so presenting one proves a copy exists outside the
family's owner, and the safe response is to revoke everything. The cost is that a
genuine double-refresh logs the user out; with single-flight refresh in the
client, that should not happen, and when it does, failing closed is the right side
to err on.

## Alternatives

| Option | Why not |
|---|---|
| Long-lived JWT refresh token | cannot be revoked; "sign out everywhere" is unimplementable |
| Server-side sessions in a table | the token still has to be an identifier, and this is that, with a hash instead of the secret |
| Rotating without reuse detection | see above — a stolen token and a valid one are indistinguishable |
| HttpOnly cookie holding the session | removes the token from JS, and adds CSRF as a problem to solve instead of the XSS one |
| Storing the raw token | a database read then yields a working credential; the hash means a dump is not a set of sessions |

## Consequences

- The client must handle refresh failing and must not retry in a loop. It
  refreshes once, then signs out; see `setSessionEndedHandler` in
  `application/frontend/src/api/client.ts`.
- Sessions are rows, so a session count is a query. That is a feature: "revoke
  everything" and "list my devices" become available later without a schema
  change.
- Logout is a write on a path that used to be free. A refresh failure is a
  network round trip, which is why the boot restore is memoised in the client.
