# How to containerise TaskFlow

**This guide has no code in it, and that is deliberate.** `AGENTS.md` forbids
agents writing this project's Dockerfiles, Compose files, or CI workflows — the
point of the exercise is the reasoning, and a file you were handed teaches
nothing. What follows is the problem each artefact solves, the decisions you have
to make, and how to prove you got it right. The artefacts are yours to write.

There is more in this directory: [deploying to Azure](deploying-to-azure.md)
covers the platform shape, and [ci-pipeline.md](ci-pipeline.md) covers the
pipeline that produces the images.

## The problem, before the syntax

A Dockerfile is a sequence of instructions, each of which creates a **layer**. The
layers are cached, and the cache is the whole reason the file has an order that
matters. A layer is reused only if every instruction *before* it is unchanged.

That single fact produces the single most common mistake: copying the entire
source tree before installing dependencies. Change one line of application code,
and the layer containing `node_modules` is invalidated, so a two-minute
`npm ci` runs on every build. Put the manifest first, install, then copy the
source. The dependency layer is now stable across code changes.

## There are three images, not one

This is a three-tier application and the tiers have genuinely different shapes:

| Image | Contents | Why it is separate |
|---|---|---|
| **frontend** | built static assets plus Nginx | a build-time-only dependency (Vite, the compiler) must not exist in the image that serves traffic |
| **backend** | compiled JS plus production dependencies | needs Node at runtime, and must not contain the build toolchain or the source |
| **postgres** | not built by you | use the official image and pin a major version |

Putting the frontend and backend in one image is tempting because they share a
Node base and a port. Resist it. They have different lifecycles (the frontend is
immutable once built; the backend restarts on deploy), different scaling triggers,
and — the real reason — different attack surfaces. A static file server and a
database-backed API should not share a filesystem.

## Decisions you have to make, and the reasoning behind each

**Which base image, and which tag.** A specific version, not `latest`. `latest` is
a moving target: a build that succeeded today can fail tomorrow with no change to
your repository, and you cannot say what is running in production. Prefer a
digest if you have one. Node's `-alpine` images are smaller, but Alpine uses
musl rather than glibc, and some native modules need a toolchain that Alpine does
not ship. If a native build fails on Alpine, that is the reason — use a
glibc-based or Debian-slim base and say so in a comment.

**Who runs the process.** Not root. Create an unprivileged user, `USER` to it
before the entrypoint, and make sure the files it reads are readable by it. This
is a real control: a process that does not need root has less to lose when it is
compromised, and it is the first thing a reviewer will look for.

**What is in the final image.** A production dependency install, the compiled
output, and nothing else. No source, no test files, no build toolchain, no `.env`,
no `node_modules` from a development install. The test is whether the image would
still start if you deleted the repository — if it depends on a file that is not
copied in, it will not.

**How dependencies are installed.** `npm ci`, not `npm install`. `ci` installs
exactly what the lockfile says and fails if the two disagree; `install` will
quietly update the lockfile, which means a build that was tested against one set
of versions is not necessarily the set that shipped. The lockfile has to be in
the image for `ci` to mean anything.

**Which layer is a cache bust.** For the backend: the build step. For the
frontend: the built assets. Anything that must invalidate the cache when
application code changes has to come *after* the dependency install and the
source copy — not before it.

**What happens on crash.** `CMD` in exec form (`["node", "dist/server.js"]`) so
the process is PID 1 and receives `SIGTERM` directly. Shell form
(`CMD node dist/server.js`) runs it through `/bin/sh`, and then your graceful
shutdown code never runs — the orchestrator sends `SIGTERM` to the shell, the
shell does not forward it, and the process is killed after the grace period. This
backend handles `SIGTERM` and closes the pool deliberately; exec form is what
makes that reachable.

**Where configuration comes from.** Environment variables, validated at startup.
Not a baked-in `ARG`, not a copied `.env`. An image built at one point in time
with secrets inside it is an image whose history contains the secrets, forever,
regardless of how many times you delete the file in a later layer.

## Requirement checklist

Use this to check your own work. Each line is something that must be observably
true, not a line of syntax.

- [ ] The build succeeds from a clean checkout with no other than the lockfile.
- [ ] Changing one source file does **not** re-run the dependency install
      (observable in the build log: `npm ci` should not appear in the second run).
- [ ] The image runs as a non-root user, and `id` inside the container confirms it.
- [ ] The image starts with the application repository deleted or absent.
- [ ] No `.env`, no private key, and no source file is present in any layer.
- [ ] The backend container logs a JSON line to **stdout**, not to a file inside
      the container. A log written to the container filesystem is lost when the
      container is replaced.
- [ ] The app listens on `0.0.0.0`, not `127.0.0.1`. A process bound to loopback
      is unreachable from outside the container, which presents as a mystery
      timeout.
- [ ] The frontend serves on **8080**, matching the web tier's port in the address
      plan. A container listening on 80 will not be reachable through the
      App Gateway path-to-backend, which is configured for 8080.
- [ ] `SIGTERM` produces a clean shutdown line, and the process exits.
- [ ] The backend's own `PORT` and `HOST` environment variables win over anything
      in the image.

## Proving it works

```bash
# Does the cache actually hold?
docker build -t taskflow-backend:test .     # first build: full
docker build -t taskflow-backend:test .     # second: mostly cached

# Is it really non-root?
docker run --rm taskflow-backend:test id

# Does it start with no repository?
docker run --rm -p 8080:8080 --env-file .env taskflow-backend:test

# Is the health endpoint answering, and is the log on stdout?
curl -fsS localhost:8080/health
docker logs <container>

# Is 5432 reachable from the app image? It should fail.
docker run --rm --network taskflow-net taskflow-backend:test \
  sh -c 'nc -z db 5432 && echo LEAKED || echo blocked'
```

That last one is the one worth remembering. The NSG matrix in
`01-paper-design/` is the real control, but this check tells you whether the
*application* is also behaving — and it is the check that catches a
`DATABASE_URL` pointed at a public hostname.

## What to write next

`deploying-to-azure.md` picks up from a working image: how the three tiers map
onto subnets, why the data tier has no public IP, and what the App Gateway is
actually terminating.
