# Default-Deny Egress Security

## Problem

Adapters and agent tools that accept URLs or network identifiers can become
SSRF and data-exfiltration primitives. Application-level validation alone does
not provide a reliable network boundary: a client can point the app at the
loopback, a private subnet, the cloud metadata service, or spin up DNS-rebinding
to switch a resolved address mid-connection.

## Solution

A default-deny egress layer (`src/Security/egress/`) that all outbound requests
from agents and protocol adapters should route through via
`secureFetch(...)`. It is fail-closed: if a destination cannot be proven safe
against the deny list and allowlist, the request is refused.

### Denied addresses (IP-range firewall)

`ipGuard.ts` classifies every address — IPv4 and IPv6, including
IPv4-mapped IPv6 (`::ffff:a.b.c.d`, unwrapped to its underlying IPv4 range) —
and denies:

| Category | Examples |
|----------|----------|
| Loopback | `127.0.0.0/8`, `::1` |
| Link-local | `169.254.0.0/16`, `fe80::/10` |
| Cloud metadata service | `169.254.169.254`, `fd00:ec2::254` |
| Private (RFC1918 + ULA) | `10/8`, `172.16/12`, `192.168/16`, `fc00::/7` |
| Multicast | `224.0.0.0/4`, `ff00::/8` |
| Unspecified / reserved | `0.0.0.0`, `::`, reserved ranges |

Mixed/integer/percent-encoded encodings of IP literals are normalized by the
WHATWG URL parser before classification, so `2130706433`, `0x7f000001`,
`0177.0.0.1`, and `%31%32%37.0.0.1` are all treated as `127.0.0.1`.

### DNS rebinding protection (`dnsGuard.ts`)

Hostnames are resolved at request time with `dns.lookup(..., { all: true })`
and **every** returned A/AAAA record is validated. A single internal record
among public records is enough to deny the whole request. Resolution is
repeated and re-validated on every redirect hop.

### Redirect validation (`egressFetch.ts`)

Requests use `redirect: "manual"`; each 3xx `Location` is re-parsed and
re-validated against the same allowlist, scheme allowlist, and resolved-IP
deny list, and capped by a `maxRedirects` budget.

### Request budgets

- Wall-clock deadline (`timeLimitMs`) per request via `AbortController`.
- Concurrency budget (`maxConcurrentRequests`) per adapter.
- Redirect depth cap (`maxRedirects`).

### Per-adapter destination allowlist (`destinationPolicy.ts`, `ToolMetadata.ts`, `defiAdapters.ts`)

Adapters are default-deny. Each declares permitted hosts and protocols:

- `ToolMetadata.egress` — agent tools manifest
  (`allowedHosts`, `allowedProtocols`, `maxConcurrentRequests`, `budget`).
- `DeFiAdapterConfig.egress` — DeFi protocol adapters manifest
  (`allowedHosts`, `allowedProtocols`).

Host entries support exact names, `*.suffix` matching, and `*` (all public
FQDNS — still subject to the IP deny list and DNS validation). Bare IP
literals are **never** allowlisted as destinations; adapters must reference a
DNS name that is then resolved and validated.

## Wiring

- `sep1.ts` (agent tool, user-supplied domains) routes its `stellar.toml`
  fetches through `secureFetch` with an all-FQDN HTTPS manifest. The IP
  deny list, DNS rebinding defence, and redirect re-validation still apply.
- `defiAdapters.ts` declares `egress` manifests for the Equilibre and
  YieldBlox adapters.

> Note: some protocol adapters (e.g. `DeFiAdapter.ts`, chat adapters) contain
> pre-existing defects outside the scope of this change and were not rewired.
> New and clean outbound paths should use `secureFetch` and declare an egress
> manifest.

## Tests

`src/Security/egress/__tests__/egress.test.ts` covers loopback / link-local /
private / metadata / multicast denial, IPv6 and IPv4-mapped IPv6, mixed and
percent-encoded host forms, per-adapter allowlists, redirect re-validation,
request budgets, and a DNS-rebinding scenario.
