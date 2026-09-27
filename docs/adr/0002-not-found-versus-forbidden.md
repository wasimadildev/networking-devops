# ADR-0002: 404 for a resource you cannot see, 403 for one you can

Date: 2026-09-27 · Status: accepted

## Context

Authorisation has to distinguish three cases: the resource does not exist, it
exists but you are not allowed to act on it, and you are allowed but the action
is not. The first two both mean "no", and the tempting design gives them different
status codes because it feels more informative.

Informedness is the problem. `403` on `/projects/:id` confirms the project exists.
That is enough to enumerate: iterate candidate ids, keep the ones that answer
`403` instead of `404`, and you have a map of which project ids are real. On a
system where ids are UUIDs, that is not a brute-force attack — it is a scan, and
it is the kind of scan a log file makes obvious after the fact.

## Decision

Two layers, deliberately:

- **Not a member of the project** → `404`. The project is treated as not existing
  for this caller. No difference from an id that was never issued.
- **A member, but the role is insufficient** → `403`. The project is already known
  to this caller, so denying it reveals nothing new.

The switch is membership, not permission. Once you are inside a project, you can
be told what you may not do with it.

## Where this is implemented

`application/backend/src/shared/authorization.ts` is the only place that decides.
Routes call `requireProjectAccess(userId, projectId, 'editor')` and never
evaluate roles themselves, so the rule cannot be applied inconsistently — the
version of this service that returned `403` for everything had at least two
copies of the check, and they did not agree.

## Alternatives

| Option | Why not |
|---|---|
| `403` for both | an enumeration oracle, as above |
| `404` for both, including insufficient role | unhelpful inside a project: a viewer who tries to edit a task is told the task does not exist |
| A single 404 with a generic body | correct, and it costs the API a distinction it needs to be usable — 403 is the only way a client knows to show "you do not have permission" rather than "not found" |

## Consequences

- A UI cannot distinguish "deleted" from "never had access" for a project it
  remembers. It shows the not-found state for both, which is the honest rendering
  of what the API told it.
- Testing a 403 requires a real member with the wrong role. Those negative tests
  exist, and they are the reason this rule has not quietly regressed.
- The rule applies to tasks and comments by way of their parent project: resolving
  a task means resolving membership of the project that owns it first. Knowing a
  task id is not permission.
