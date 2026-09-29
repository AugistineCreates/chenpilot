import * as ipaddr from "ipaddr.js";
import { EgressDenyReason, IpSafety } from "./types";

/**
 * Addresses considered unreachable / dangerous as outbound destinations.
 *
 * Covers: loopback, link-local, private (RFC1918 + ULA), the cloud
 * metadata-service ranges (169.254.x.x and the IPv6 link-local metadata
 * range), multicast, the unspecified address, and reserved ranges.
 */
export const DENY_RANGES: Record<EgressDenyReason, readonly string[]> = {
  loopback: ["loopback"],
  "link-local": ["linkLocal"],
  private: ["private"],
  "metadata-service": ["linkLocal"],
  multicast: ["multicast"],
  unspecified: ["unspecified"],
  reserved: ["reserved"],
  "ipv4-mapped": [],
  userinfo: [],
  "scheme-not-allowed": [],
  "host-not-allowed": [],
  "config-deny-all": [],
  "dns-resolution-failure": [],
  "no-resolved-addresses": [],
  "undetermined-address": [],
  "redirect-deep-limit": [],
  "budget-exceeded": [],
  "bad-url": [],
  "non-fqdn-hostname": [],
};

const METADATA_V4 = "169.254.169.254";
const METADATA_V6 = "fd00:ec2::254";

/**
 * Normalize the string form of an IP address so that equivalent encodings
 * (IPv4-mapped IPv6, compressed IPv6, alternative integer/hex/octal forms)
 * collapse to a canonical string before classification.
 */
export function normalizeAddress(input: string): string {
  let raw = input.trim();
  // Strip IPv6 brackets produced by WHATWG URL for literal IPv6 hosts.
  if (raw.startsWith("[") && raw.endsWith("]")) {
    raw = raw.slice(1, -1);
  }

  // Remove a trailing zone id (e.g. fe80::1%eth0).
  const zoneIndex = raw.indexOf("%");
  if (zoneIndex !== -1) {
    raw = raw.slice(0, zoneIndex);
  }

  try {
    const parsed = ipaddr.parse(raw);
    return parsed.toString();
  } catch {
    // Not a clean parse; return the trimmed input so callers can decide.
    return raw;
  }
}

/**
 * Return true when the given string parses as a concrete IP literal
 * (IPv4 or IPv6) as opposed to a domain name.
 */
export function isIpLiteral(input: string): boolean {
  const raw = normalizeAddress(input);
  try {
    ipaddr.parse(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify a single IP literal against the deny list.
 *
 * Returns `denied: true` with a reason for loopback, link-local, private,
 * metadata-service, multicast, unspecified, and reserved ranges. IPv4-mapped
 * IPv6 addresses (::ffff:a.b.c.d) are unwrapped and classified as their
 * underlying IPv4 address so they cannot bypass v4-only checks.
 */
export function checkAddress(input: string): IpSafety {
  const normalized = normalizeAddress(input);

  try {
    const parsed = ipaddr.parse(normalized);

    let target = parsed;
    let mapped = false;

    // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) to its IPv4 range so an
    // IPv4-mapped private/loopback/metadata address cannot bypass v4 checks.
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) {
      target = parsed.toIPv4Address();
      mapped = true;
    }

    const addrString = target.toString();
    if (addrString === METADATA_V4 || addrString === METADATA_V6) {
      return { denied: true, reason: "metadata-service", normalized };
    }

    const range = target.range();
    if (mapped && range === "ipv4Mapped") {
      return { denied: true, reason: "ipv4-mapped", normalized };
    }

    const reason = mapDeniedRange(range);
    if (reason) {
      return { denied: true, reason, normalized };
    }

    return { denied: false, normalized };
  } catch {
    // Not a parseable IP. Callers distinguish "hostname" from invalid input.
    return { denied: false, normalized };
  }
}

/**
 * Map an ipaddr.js range identifier to the egress deny reason, or null when
 * the range is allowed (public unicast).
 */
function mapDeniedRange(range: string): EgressDenyReason | null {
  switch (range) {
    case "loopback":
      return "loopback";
    case "linkLocal":
      return "link-local";
    case "private":
      return "private";
    case "uniqueLocal":
      return "private"; // IPv6 ULA (fc00::/7, incl. fd00::/8)
    case "multicast":
      return "multicast";
    case "unspecified":
      return "unspecified";
    case "reserved":
      return "reserved";
    default:
      return null;
  }
}
