/**
 * Shared types for the default-deny egress policy layer.
 *
 * This module is a network boundary that sits in front of outbound
 * requests made by agents and protocol adapters. It is intentionally
 * fail-closed: if a destination cannot be proven safe against the deny
 * list and allowlist, the request is refused.
 */

/** Why an address / destination was denied. */
export type EgressDenyReason =
  | "loopback"
  | "link-local"
  | "private"
  | "metadata-service"
  | "multicast"
  | "unspecified"
  | "reserved"
  | "ipv4-mapped"
  | "userinfo"
  | "scheme-not-allowed"
  | "host-not-allowed"
  | "config-deny-all"
  | "dns-resolution-failure"
  | "no-resolved-addresses"
  | "undetermined-address"
  | "redirect-deep-limit"
  | "budget-exceeded"
  | "bad-url"
  | "non-fqdn-hostname";

/** Outcome of a single IP-address safety check. */
export interface IpSafety {
  denied: boolean;
  reason?: EgressDenyReason;
  /** The parsed/normalized form of the input address. */
  normalized: string;
}

/** Outcome of a destination (host + scheme) check. */
export interface DestinationCheck {
  ok: boolean;
  reason?: EgressDenyReason;
  /** Normalized hostname (with any IPv6 brackets removed). */
  hostname: string;
  protocol: string;
}

/** Outcome of a DNS resolution + address-safety sweep. */
export interface ResolvedAddressCheck {
  ok: boolean;
  reason?: EgressDenyReason;
  addresses: string[];
}

/**
 * Per-adapter egress manifest. Adapters are default-deny: they may only
 * connect to hosts and protocols declared here.
 */
export interface AdapterEgressConfig {
  /** Permitted hosts. Supports exact hostnames and `*.example.com` suffixes. */
  allowedHosts: string[];
  /** Permitted URL schemes, e.g. ["https"]. HTTPS must be listed explicitly. */
  allowedProtocols: string[];
  /** Absolute cap on simultaneous/outstanding requests for this adapter. */
  maxConcurrentRequests?: number;
}

/**
 * Request budget bounds enforced by the egress layer for a single request
 * (including any redirects).
 */
export interface EgressRequestBudget {
  /** Max request wall-clock budget in milliseconds. */
  timeLimitMs?: number;
  /** Max redirect hops that will be followed (and each is re-validated). */
  maxRedirects?: number;
}

/**
 * Injectable hostname resolver so DNS-rebinding tests can simulate a host
 * that resolves to a safe address on the first lookup and a private address
 * on a subsequent lookup.
 */
export interface HostResolver {
  lookup(hostname: string, options: { all: true }): Promise<HostAddress[]>;
}

export interface HostAddress {
  address: string;
  family: 4 | 6;
}
