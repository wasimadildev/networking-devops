# Deploying TaskFlow to Azure

Guidance only — no Bicep, no Terraform, no ARM template, and no pipeline file
appears in this repository, by design (`AGENTS.md`). This is the shape of the
deployment, the reasoning behind each choice, and how to prove it is correct.
`containerising.md` covers producing the images; this starts from them.

## The shape, and why it is this shape

```text
Internet
   │  443
   ▼
Application Gateway          public IP, WAF, TLS termination
   │  8080
   ▼
Web subnet                  Nginx serving static assets   10.50.1.0/24
   │  8080
   ▼
App subnet                  Node API                      10.50.2.0/24
   │  5432
   ▼
DB subnet                   PostgreSQL, no public IP       10.50.3.0/24

Bastion ──► management subnet                          10.50.4.0/24
```

The load-bearing property is that **the data tier has no public IP and no route
to the internet**. Not a firewall rule added later — no public IP at all. There
is no address for the internet to connect to, so the control does not depend on
being maintained.

## Decisions, with the reasoning

**The application tier is in a subnet, not a PaaS service.** Azure App Service
would be less to run, and it would also put the API on a public endpoint or a
service-managed identity that does not appear in your NSG matrix. A VM in a
subnet is the choice that makes `01-paper-design/traffic-flows.md` literally
true: the rules in that document are the rules enforcing the network.

**App Gateway in front, not a public IP on the web tier.** Two separate reasons,
and both matter:

- *TLS termination in one place.* One certificate, one place to rotate it. The
  hop to the app tier is then plain HTTP over a private address, which is
  acceptable precisely because the address is private.
- *WAF.* A managed rule set in front of the presentation tier is a filter the web
  subnet does not have to implement. It also means the public IP belongs to a
  managed service, not to a subnet you also route to other things.

**The web tier serves static files and proxies `/api`.** This is why the frontend
has no environment file: the SPA is served same-origin and calls a relative
`/api/v1`, so Nginx routes it upstream to the app tier. The consequence to hold
onto — **the browser only ever talks to one origin**, so there is no CORS
preflight in production at all, and the `CORS_ALLOWED_ORIGINS` allowlist exists
for local development and for the case where you later split the origins.

**Nginx must set the API's own security headers, not duplicate the app's.** A
backend already sending `X-Content-Type-Options` and friends should not have
Nginx add a second, possibly different, set. Decide where each header is set and
make it one place.

**Managed Postgres, private networking, `sslmode=require`.** Note that even on a
private network `DATABASE_SSL` is `true` in this deployment. Private removes
reachability; TLS removes eavesdropping by anything that can see the traffic. They
are different threats and both apply.

**Bastion for administration, because there should be no other way in.** SSH to a
bastion host, then hop to the subnet you need. This is the reason SSH is not
open on the web or app tier: a second, cheaper way into a production subnet is
exactly the kind of thing that gets added "temporarily".

**Bastion is a cost decision worth naming.** A bastion host bills while it is
running. Stopping it when nobody is using it and starting it deliberately is the
normal pattern, and it is worth the friction — the friction is the point.

## NSG design

Design the matrix in `01-paper-design/traffic-flows.md` from **source and
destination**, not from ports. A rule that allows 8080 inbound to the app tier
allows it from anywhere the source is unspecified.

The rules that matter, and the reason each exists:

| Source | Destination | Port | Why |
|---|---|---|---|
| Internet | App Gateway | 443 | the only public entry point |
| App Gateway | Web | 8080 | the only way the gateway reaches static content |
| Web | App | 8080 | the proxied API path |
| App | DB | 5432 | the only path to the data tier |
| Bastion | App, Web | 22 | administration, from one known source |
| Everything else | Everything | — | denied by default |

Two rules of thumb that are not visible in a diagram:

- **Deny rules beat allow rules.** If a broad allow and a narrow deny both match,
  the deny wins. Use a default deny and specific allows so the safe outcome is
  the one that requires no configuration.
- **An NSG applies to the subnet and/or the NIC.** Attaching to both is not belt
  and braces — it is a union of rules, which surprises people. Decide which level
  each rule belongs at, and be consistent.

## The configuration that must change in production

`docs/architecture/configuration.md` has the full list. The ones that are
different from local, and why:

| Variable | Production value | Why it matters |
|---|---|---|
| `DATABASE_SSL` | `true` | TLS on a private network is not redundant |
| `CORS_ALLOWED_ORIGINS` | the real https origin | the allowlist is the browser-side control |
| `TRUST_PROXY` | `1` — the hop count | App Gateway. `true` would let any client spoof `X-Forwarded-For` and defeat the rate limiter |
| `JWT_*_SECRET` | from Key Vault | and they must differ |
| `NODE_ENV` | `production` | this is what makes placeholder secrets a boot failure |
| `LOG_LEVEL` | `info` | and the logs must reach somewhere queryable |

**Secrets from Key Vault, not from a pipeline variable that is also in a
`.env.example`.** A secret that exists in three places is a secret in three
places. The application tier is a VM, so the practical pattern is a managed
identity with a Key Vault access policy, and the app reads the secret at startup.

## Deploy ordering

The order is not arbitrary:

1. **Migrations first.** Forward-only and additive — add a column, do not drop
   one. The old code must tolerate the new schema, which is the whole reason
   [ADR-0006](../adr/0006-migrations-without-down.md) is
   forward-only.
2. **The app tier**, rolling. One instance at a time, so a health check failure
   rolls back the deploy rather than the platform.
3. **The web tier** last, because it is serving the version of the SPA that
   matches the currently deployed API. Reversing 2 and 3 gives users a new SPA
   calling an old API, which is the ordering that produces a front-end error
   nobody can reproduce.

## Proving the deployment is right

Verify the negative cases. A deployment that serves the homepage proves almost
nothing, because the homepage requires no network path you built.

```bash
# Positive: the app works end to end
curl -fsS https://<gateway-host>/health
curl -fsS -X POST https://<gateway-host>/api/v1/auth/login -d '{…}'

# The data tier must not be reachable from anywhere
psql "host=<db-host> user=…" -c 'select 1'          # must fail to connect
nmap -p 5432 <db-private-ip>                        # from a jump host: filtered
nmap -p 5432 <db-public-ip>                         # no public IP should resolve

# The app tier must not be reachable from the internet
nmap -p 8080 <app-public-ip>                        # should not resolve
curl --max-time 5 http://<app-private-ip>:8080/health  # from the web tier: 200
                                                   # from your laptop: timeout

# SSH must not be open on the app or web tier
nmap -p 22 <app-public-ip> <web-public-ip>          # filtered
```

The last group is the one people skip, and it is the one that catches the
mistake where a subnet is created with a default rule that permits everything
because the template had it. Run it from outside the VNet.

## When something is wrong

`04-troubleshooting/` in the repository root is symptom-first: start from what you
observe ("the site loads but every API call 502s") rather than from which service
you think is broken. The two that cost the most time here:

- **502 from the gateway** is almost always the app tier not listening on
  `0.0.0.0`, or listening on a different port than the gateway's
  path-to-backend is configured for. Check the health endpoint *from the web
  tier* first — that isolates it from the gateway entirely.
- **A container restarts in a loop** is usually a boot-time configuration
  failure. Read the first log line, not the last: this app validates its
  environment at startup on purpose, so the message names the variable.

## What to write next

`ci-pipeline.md` covers what has to happen before any of this is deployable: a
pipeline that builds the image, proves it, and produces something with a
traceable version.
