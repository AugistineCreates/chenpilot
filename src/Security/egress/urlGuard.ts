import { checkAddress, isIpLiteral } from "./ipGuard";
import { DestinationCheck, EgressDenyReason } from "./types";

export interface ParsedDestination {
  hostname: string;
  protocol: string;
  userinfo: boolean;
}

/**
 * Parse a URL string into its normalized destination components, or throw
 * a descriptive error when the URL is unusable.
 *
 * The WHATWG URL parser normalizes alternative host encodings (decimal /
 * hex / octal / percent-encoded octets) into a canonical hostname, so a
 * literal like `http://%31%32%37.0.0.1/` is treated as `127.0.0.1` here.
 *
 * @throws {Error} when the URL cannot be parsed or carries explicit userinfo.
 */
export function parseDestination(
  url: string,
  allowedProtocols: string[] = ["https", "http"]
): ParsedDestination {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`egress: invalid URL "${url}"`);
  }

  const protocol = parsed.protocol.toLowerCase();
  const protocolNoColon = protocol.endsWith(":") ? protocol.slice(0, -1) : protocol;
  const allowed = allowedProtocols.map((p) =>
    p.toLowerCase().endsWith(":") ? p.toLowerCase().slice(0, -1) : p.toLowerCase()
  );
  if (!allowed.includes(protocolNoColon)) {
    throw new Error(
      `egress: scheme "${protocol}" is not allowed for outbound requests`
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error("egress: URLs with embedded credentials are forbidden");
  }

  // Normalize the hostname (strip IPv6 brackets, decode any residual
  // percent-encoding) before any allowlist / IP classification.
  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  return {
    hostname,
    protocol,
    userinfo: false,
  };
}

/**
 * Check a hostname against the deny list when it is a literal IP, and flag
 * obviously non-FQDN hostnames. Domain names are not resolved here — the
 * caller resolves them and validates every resulting IP (see dnsGuard).
 */
export function checkIpLiteralDestination(
  input: string
): DestinationCheck | null {
  const hostname = input.toLowerCase();
  const literal = isIpLiteral(hostname);

  if (!literal) {
    return null;
  }

  const safety = checkAddress(hostname);
  if (safety.denied) {
    return {
      ok: false,
      reason: safety.reason,
      hostname,
      protocol: "",
    };
  }

  return {
    ok: true,
    hostname,
    protocol: "",
  };
}

/**
 * Validate a hostname for policy purposes: it must not be a bare literal IP
 * (these are always denied as a destination — an adapter should connect via
 * a real FQDN) and must be a non-empty dot-separated hostname without IP
 * syntax. Returns the deny reason for a bare-IP host.
 */
export function classifyHostname(
  hostname: string,
  allowedHosts: string[]
): { ok: boolean; reason?: EgressDenyReason } {
  if (!hostname) {
    return { ok: false, reason: "non-fqdn-hostname" };
  }

  // Bare IP literals are denied even when the range itself is public, so
  // that the allowlist must reference a DNS name (which is then resolved
  // and every address re-validated).
  if (isIpLiteral(hostname)) {
    return { ok: false, reason: "host-not-allowed" };
  }

  // Must be a plausible FQDN for allowlisting purposes.
  if (!/^[a-z0-9._-]+$/i.test(hostname) || !hostname.includes(".")) {
    return { ok: false, reason: "non-fqdn-hostname" };
  }

  return { ok: true };
}

/** Whether `hostname` matches an allowlist entry (exact, `*.suffix`, or `*`). */
export function hostMatchesAllowlist(
  hostname: string,
  allowedHosts: string[]
): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    const e = entry.toLowerCase();
    if (e === "*") {
      return true; // all FQDNs allowed; IP literals already denied upstream
    }
    if (e.startsWith("*.")) {
      const suffix = e.slice(1); // ".example.com"
      return host === e.slice(2) || host.endsWith(suffix);
    }
    return host === e;
  });
}
