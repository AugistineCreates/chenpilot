import {
  classifyHostname,
  hostMatchesAllowlist,
} from "./urlGuard";
import {
  AdapterEgressConfig,
  DestinationCheck,
  EgressDenyReason,
} from "./types";

/** Default mitigation when an adapter declares no egress manifest. */
export const DEFAULT_ADAPTER_EGRESS: AdapterEgressConfig = {
  allowedHosts: [],
  allowedProtocols: [],
  maxConcurrentRequests: 4,
};

/** Default request budget applied when none is provided. */
export const DEFAULT_REQUEST_BUDGET = {
  timeLimitMs: 15_000,
  maxRedirects: 3,
};

/**
 * Enforce a per-adapter, default-deny destination allowlist.
 *
 * An adapter may only reach hosts within `allowedHosts` over the schemes in
 * `allowedProtocols`. Empty host/protocol lists deny request destinations.
 */
export function checkDestinationPolicy(
  hostname: string,
  protocol: string,
  egress?: AdapterEgressConfig
): DestinationCheck {
  const effective: AdapterEgressConfig = egress ?? DEFAULT_ADAPTER_EGRESS;

  if (!effective.allowedHosts || effective.allowedHosts.length === 0) {
    return {
      ok: false,
      reason: "config-deny-all",
      hostname,
      protocol,
    };
  }

  if (
    !effective.allowedProtocols ||
    effective.allowedProtocols.length === 0
  ) {
    return {
      ok: false,
      reason: "scheme-not-allowed",
      hostname,
      protocol,
    };
  }

  if (!effective.allowedProtocols.includes(protocol)) {
    return {
      ok: false,
      reason: "scheme-not-allowed",
      hostname,
      protocol,
    };
  }

  // Hostname policy: bare IPs are never allowed for adapters (they must
  // reference an allowlisted DNS name that is then resolved + validated).
  const hostClass = classifyHostname(
    hostname,
    effective.allowedHosts
  );
  if (!hostClass.ok) {
    return {
      ok: false,
      reason: (hostClass.reason as EgressDenyReason) || "host-not-allowed",
      hostname,
      protocol,
    };
  }

  if (!hostMatchesAllowlist(hostname, effective.allowedHosts)) {
    return {
      ok: false,
      reason: "host-not-allowed",
      hostname,
      protocol,
    };
  }

  return { ok: true, hostname, protocol };
}

/**
 * Simple in-memory concurrency budget that prevents an adapter from
 * opening unbounded simultaneous connections.
 */
export class EgressBudget {
  private counts = new Map<string, number>();
  private max: number;

  constructor(max = DEFAULT_ADAPTER_EGRESS.maxConcurrentRequests ?? 4) {
    this.max = max;
  }

  /** Reserve a slot for a key, returning false when at capacity. */
  acquire(key: string): boolean {
    const current = this.counts.get(key) ?? 0;
    if (current >= this.max) {
      return false;
    }
    this.counts.set(key, current + 1);
    return true;
  }

  release(key: string): void {
    const current = this.counts.get(key) ?? 0;
    if (current <= 1) {
      this.counts.delete(key);
    } else {
      this.counts.set(key, current - 1);
    }
  }
}
