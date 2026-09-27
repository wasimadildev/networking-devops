# Phase 2 — IP / CIDR Address Plan

## VNet

- **VNet:** `10.50.0.0/16`
- **Total addresses:** `65,536`
- **Azure usable addresses:** `65,531`
- **Azure reserves:** 5 addresses per subnet

> **Rule:** Leave unused address space deliberately for future growth.

## Address Plan

| Component | CIDR | Purpose | Usable IPs (n - 5) |
|---|---|---|---:|
| VNet | `10.50.0.0/16` | Whole VNet | 65,531 |
| Web | `10.50.1.0/24` | Web VMs | 251 |
| App | `10.50.2.0/24` | API / Backend | 251 |
| DB | `10.50.3.0/24` | Database | 251 |
| Management | `10.50.4.0/24` | Admin / Operations | 251 |
| App Gateway | `10.50.5.0/24` | Gateway / WAF | 251 |
| Future | `10.50.16.0/20` | Future growth | 4,091 |

## Address Layout

```text
10.50.0.0/16
│
├── 10.50.1.0/24   → Web
│                    Web VMs
│
├── 10.50.2.0/24   → App
│                    API / Backend
│
├── 10.50.3.0/24   → DB
│                    Database
│
├── 10.50.4.0/24   → Management
│                    Admin / Operations
│
├── 10.50.5.0/24   → App Gateway
│                    Gateway / WAF
│
└── 10.50.16.0/20  → Future
                     Growth / New Components