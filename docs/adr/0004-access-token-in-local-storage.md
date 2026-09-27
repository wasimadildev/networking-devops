# ADR-0004: The access token lives in localStorage

Date: 2026-09-27 · Status: accepted · Revisit if the XSS risk model changes

## Context

The SPA is a same-origin static bundle. It needs to send a bearer token on API
requests, survive a reload, and be able to sign out. The two standard homes for a
credential in a browser are `localStorage` and an `HttpOnly` cookie.

This is the weakest of the decisions in the project, so it is written down with
its reasoning rather than presented as settled.

## Decision

The access token and refresh token are kept in `localStorage`, with an in-memory
mirror for reads. The refresh token is short-lived and rotates on every use; see
[ADR-0003](0003-rotating-refresh-tokens.md).

## Why

- **The CSRF trade is worth making, once.** A cookie sent automatically is the
  reason every cookie-authenticated API needs a CSRF defence. A bearer token in a
  header is not sent unless the code sends it, so a cross-origin form post cannot
  borrow a credential. That removes an entire class of bug and its whole
  accompanying machinery.
- **The blast radius of an XSS is capped by rotation.** If script does run in the
  page, it can read the token — but the refresh token is single-use and its reuse
  is detectable, so a stolen copy is at most one request deep. Detection revokes
  the family, which is the mechanism that makes this decision survivable rather
  than merely common.
- **Sign-out is honest.** Revoking a token is a server call, and a user who
  clicks "sign out everywhere" expects every session to die. A cookie you cannot
  inspect is harder to reason about when debugging a session that will not die.

## Why not HttpOnly cookies

Because the honest answer is that cookies are stronger against XSS, and that
HttpOnly plus CSRF tokens is the better security posture in most deployments. It
was not chosen because it moves the problem rather than removing it: CSRF
defences must be correct on every mutating route, and a bug in one is
indistinguishable from a bug in the other. The XSS risk is concentrated in
dependency supply and rendering, where it is visible in review; CSRF correctness
is spread across a dozen routes, where it is not.

That is a judgement about where this codebase is most likely to get it wrong, not
a claim that the risk is lower. A project with a CSP and no `dangerouslySetInnerHTML`
should choose cookies.

## Mitigations actually in place

- No `innerHTML` or `dangerouslySetInnerHTML` anywhere; React escapes by default.
- No third-party script on the page, and no analytics or tag manager.
- A CSP in `frontend/index.html` restricting `script-src` to the bundle's origin.
- Refresh is single-flight, so a token is not raced into double use — which would
  trip the reuse detector and log the user out.
- On an unrecoverable `401` the client signs out and clears storage rather than
  retrying.

## Consequences

- Any successful XSS yields a working access token for up to `JWT_ACCESS_TTL`
  (15 minutes). The refresh token does not extend that, and replaying it
  invalidates the whole session.
- The token is readable by anything running on the origin, including a browser
  extension with page access. Cookies are not.
- `localStorage` is per-origin and persists until cleared, so "sign out" must
  clear it — it does, and `logout-all` revokes server-side as well.
- If a CSP cannot be deployed strictly, revisit this. The decision is sound only
  in combination with the mitigations above.
