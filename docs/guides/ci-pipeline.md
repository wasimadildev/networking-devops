# The CI pipeline

Guidance only — no workflow file, no pipeline config, no Jenkinsfile in this
repository, by design (`AGENTS.md`). This is what a pipeline is *for* here, the
decisions you have to make, and how to tell whether yours is actually protecting
you. `containerising.md` produces the images; this produces them reproducibly.

## The problem a pipeline solves

Not "build the code" — a laptop does that. A pipeline exists so that the
following is true of every single change, with nobody remembering to do it:

1. It compiles and passes its tests.
2. It passes the same checks a reviewer would.
3. It produces an artefact with a version you can name.
4. Nothing secret is in the artefact, the log, or the repository.
5. You can tell which commit is running in production, right now.

Point 5 is the one people underrate. A deploy you cannot answer "what version is
this?" for is a deploy you cannot roll back, and during an incident that question
is the first one asked.

## The stages, and why this order

```text
lint + typecheck
      │  cheap, catches the most
      ▼
unit + integration tests      ← needs a real PostgreSQL, not a mock
      │
      ▼
build image
      │
      ▼
scan image
      │
      ▼
tag with the commit sha, push
      │
      ▼
deploy to a non-production environment, smoke test it
```

**Lint before tests** because it is seconds, and it is the check most likely to
fail on a small change. Failing fast on the cheap gate means nobody waits two
minutes to be told about a missing semicolon.

**Tests against a real database.** This project's test suite issues real SQL —
enums, triggers, `citext`, keyset pagination. A mocked data layer would let all
of that pass and the database still be wrong. So the pipeline needs a PostgreSQL
service, and it needs to be reset between runs. This is the single most
important thing to get right, because a test suite that shares state across runs
will pass locally, pass in CI on the first run, and fail on the eleventh with
"constraint violation" and no useful message.

**Scan the image, not just the source.** A dependency scanner reading your
lockfile cannot tell you about a base image published three days ago with a
known CVE. Both, and note the result gets fixed on a schedule — an alert nobody
triages is not a control.

**Smoke test after deploy, before promoting.** The same 75 checks the backend
`smoke` script makes, pointed at the deployed environment. This is what catches
"the image is fine but the environment variables are not", which unit tests
cannot.

## Decisions you have to make

**What triggers a build.** Every push to a branch, or only pull requests. Every
push is faster feedback and costs more minutes; pull-request-only is cheaper and
means a broken commit can sit on `main`. Whatever you choose, the protection rule
that requires the pipeline to pass before merging is what actually enforces it —
a pipeline that reports failure is advisory, a required check is a gate.

**Where the database comes from in CI.** A service container in the job, a
managed instance, or a container started on a runner. The requirement is
PostgreSQL **17**, matching production: a suite that passes on 15 and fails on 17
has tested the wrong thing. Pin it, and pin the image, for the same reason
`latest` is not acceptable in a Dockerfile.

**How the image is versioned.** The commit SHA is the honest answer. Tags like
`latest` or `v1` are aliases that move, and a rollback to a moving tag is not a
rollback. Tag with the SHA, and additionally with a human-readable semver if you
want one — the SHA is what the deployment must record.

**Where credentials come from.** Not a repository secret that is a password you
typed. The container registry is authenticated to with a workload identity or an
app registration, and the deployment reads secrets from Key Vault using a managed
identity. A pipeline variable and a Key Vault secret that hold the same value
means the value is in two systems, one of which writes it to a log when someone
debugs a masked print.

**What the pipeline is not allowed to do.** Deploy to production from a feature
branch. Not "wouldn't happen" — it happens at 5pm on a Friday. If the path from a
branch to production exists, it will be taken, and usually by someone who was
trying to fix something.

## What must never be in the pipeline

- Secrets in a committed workflow file. If a secret was ever committed, rotating
  it is the fix; editing the file is not — the old value is in the history and
  in anyone who cloned the repository.
- `|| true` on a security or test step. That is not resilience, it is a disabled
  check with a comment.
- A cache key that is not tied to the lockfile hash. A cache that ignores its
  inputs will serve a stale `node_modules` and produce a build that is not the
  one you tested.
- `--force` on a push to a shared tag, used "just this once".

## Requirement checklist

- [ ] A change that breaks `npm run lint` fails the pipeline, and does so in
      under a minute.
- [ ] The test job runs PostgreSQL **17** and the database is reset per run.
- [ ] Running the same commit twice produces the same image digest, given the
      same base images.
- [ ] The image tag contains the commit SHA, and a deployed instance can be
      traced back to a commit with one command.
- [ ] No secret appears in the workflow file, in a log line, or in an image
      layer. Checkable: read the logs of a run that failed *after* the secrets
      were used.
- [ ] The image is scanned, and a critical finding fails the build.
- [ ] A deployment to production requires the main branch and an approved
      environment — not a branch name in a condition.
- [ ] The pipeline runs `npm run smoke` against the deployed environment and
      fails the promotion if it does not pass.
- [ ] Nobody can trigger a production deploy by pushing to a branch they can
      create.

## Proving it works

The test of a pipeline is not that it passes. It is that **it fails when it
should**, so check these deliberately:

```bash
# Does the lint gate actually gate?
#   introduce a lint error on a scratch branch, push, confirm red.

# Does the test job catch a real regression, or only test-file problems?
#   change a repository query to return the wrong column, confirm red.

# Is the artefact traceable?
docker inspect <image> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
#   → should be the full commit SHA of what is running

# Does the cache key respect the lockfile?
#   edit only application source; npm ci should be a cache hit
#   edit package-lock.json;     npm ci should re-run
```

The last one is the check most pipelines fail. A cache keyed on the branch name
serves yesterday's dependencies to today's commit, and the build passes against
something nobody is going to ship.

## The honest summary

A pipeline is a set of promises about what is true of every change. The value is
entirely in the ones you can make false deliberately and watch turn red. A
pipeline that has only ever been green has not been tested.
