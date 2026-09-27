# ADR-0007: No user directory; members are added by email

Date: 2026-09-27 · Status: accepted

## Context

Adding someone to a project needs to identify them. The natural UI is a
typeahead over people, and the natural implementation is a directory endpoint the
typeahead queries as the user types.

The app's first version had exactly that: `GET /api/v1/users` returned every active
account's id, email, and display name to any authenticated caller, and
`POST /projects/:id/members` took `{ userId }`.

## Decision

- `GET /api/v1/users` now returns only accounts that share at least one project
  with the caller, so a typeahead over it lists colleagues rather than the
  platform.
- `POST /projects/:id/members` takes `{ email, role }` and resolves the exact
  address server-side. The id-based body is gone.

The user search still exists, because a colleague picker is a real convenience.
What changed is that it answers "people I already work with", not "everyone
registered".

## Why the id is the problem

An id-based body forces a discovery step. The only way for a client to learn a
stranger's id is to read it from a list — and a list that lets you find an id
lets you find the name and email attached to it, because that is the row. The
endpoint needed by the feature is the endpoint that leaks the directory.

Moving the lookup server-side removes the requirement rather than restricting it.
The typeahead still queries `/users`, but only ever renders the caller's
colleagues; the resolution that matters — the one for someone who has never been
a member — happens with no list endpoint involved.

## What is still disclosed

A project owner who submits an exact email learns whether that one address has an
account. That is a real, if narrow, oracle: it requires already being an owner of
some project, it answers one address at a time with no prefix matching, and the
attempt is logged. Removing it entirely would mean an invite flow with outbound
email, which is a larger feature with a credential that eventually sits in
someone's inbox.

The alternative — returning 404 for an unknown address and 201 for a known one,
with a distinct message — is the same disclosure with extra steps.

## Also fixed here

Membership insertion is a plain `INSERT`. It was an `ON CONFLICT ... DO UPDATE`,
which meant adding an existing editor as a viewer returned 201 and demoted them
while the service's `ConflictError` sat unreachable. The repository now relies on
the composite primary key to fail, and the service maps that to 409.

## Alternatives

| Option | Why not |
|---|---|
| Keep the directory, restrict by membership | still a list of every colleague across every project, and a compromised token reads all of it at once |
| Keep the directory, paginate and rate-limit it | pagination limits a scrape per request, not the disclosure |
| Keep `userId`, add `/users/by-email` | the same oracle as the add-member action, but available to every caller instead of project owners |
| Invite by email with no account check | needs outbound mail; a token that lands in an inbox is a credential this deployment then has to manage |
