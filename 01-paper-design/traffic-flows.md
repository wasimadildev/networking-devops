# Traffic Flows

Phase 3 turns the architecture from a collection of Azure icons into a real
networking diagram: every arrow is a connection that must be allowed by a
network security group, a route, and a listening socket.

## Flow summary

| # | From | To | Port / Protocol | Purpose | Exposure |
|---|------|----|-----------------|---------|----------|
| 1 | User | Application Gateway | TCP 443 (HTTPS) | Public web entry point | Internet-facing |
| 2 | Application Gateway | Web VM (Web subnet) | TCP 8080 (HTTP) | Reverse proxy to frontend | Internal only |
| 3 | Web VM | App VM (App subnet) | TCP 8080 (HTTP) | Frontend calls backend API | Internal only |
| 4 | App VM | PostgreSQL | TCP 5432 | Database queries | Internal only |
| 5 | Administrator | Azure Bastion | TCP 443 (HTTPS) | Secure administrative entry | Internet-facing, authenticated |
| 6 | Azure Bastion | Web VM / App VM | TCP 22 (SSH) / TCP 3389 (RDP) | Admin session tunnelled to private IP | Internal only |

## Flow diagrams

### Public web path

```
User
  |
  | TCP 443 (HTTPS)
  v
Internet
  |
  v
Application Gateway  (public frontend IP, TLS termination)
  |
  | TCP 8080 (HTTP, inside VNet)
  v
Web subnet
  |
  v
Web VM  (application listening on 0.0.0.0:8080)
  |
  | TCP 8080 (HTTP, app -> app)
  v
App subnet
  |
  v
App VM  (API)
  |
  | TCP 5432 (PostgreSQL wire protocol)
  v
PostgreSQL
```

### Administrative path (preferred)

```
Admin workstation
  |
  | TCP 443 (HTTPS, authenticated)
  v
Azure Bastion
  |
  | TCP 22 (SSH) or TCP 3389 (RDP), tunnelled
  v
VM private IP  (Web VM / App VM)
```

Bastion replaces the anti-pattern of publishing SSH/RDP ports straight to the
Internet. No public IP is assigned to either VM, so there is nothing for an
attacker to scan.

### Anti-pattern being avoided

```
Admin --> Internet --> VM public IP :22 / :3389   (DO NOT DO THIS)
```

## Flow rules

1. **Default deny.** Every NSG denies inbound traffic unless a rule explicitly
   allows it. Rules are added per flow, in the order above.
2. **No direct Internet path to a VM.** Only Application Gateway (TCP 443) and
   Azure Bastion (TCP 443) hold public IPs.
3. **East-west traffic is named.** App Gateway to Web VM and Web VM to App VM
   use the service tag `AzureLoadBalancer` / explicit subnet-to-subnet rules
   rather than a wide address range.
4. **Database is reachable only from the app tier.** TCP 5432 is allowed from
   the App subnet only — never from the Web subnet and never from the Internet.
5. **Stateful return traffic.** NSGs are stateful, so responses to an allowed
   inbound flow are permitted automatically. No explicit return rules needed.
6. **Encryption in transit.** TLS terminates at Application Gateway; traffic
   from the gateway to the Web VM stays inside the VNet. Bastion sessions are
   encrypted end to end.

## NSG rule matrix

| Source | Destination | Inbound port | Purpose |
|--------|-------------|--------------|---------|
| Internet | Application Gateway public IP | 443 | Public web traffic |
| Application Gateway | Web VM | 8080 | Reverse proxy to frontend |
| Web subnet | App VM | 8080 | Frontend to backend API |
| App subnet | PostgreSQL | 5432 | Database access |
| Bastion subnet | Web VM / App VM | 22, 3389 | Administrative access |

## Ports not exposed

- **22 (SSH)** — not open to the Internet; reached only via Bastion.
- **3389 (RDP)** — not open to the Internet; reached only via Bastion.
- **5432 (PostgreSQL)** — internal to the VNet, App subnet only.
- **80 (HTTP)** — no plaintext listener; HTTPS only, redirect if terminated.
