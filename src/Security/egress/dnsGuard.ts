import * as dns from "dns";
import { promisify } from "util";
import { checkAddress } from "./ipGuard";
import { EgressDenyReason, HostResolver, ResolvedAddressCheck } from "./types";

const lookupAll = promisify(dns.lookup) as (
  hostname: string,
  options: dns.LookupAllOptions
) => Promise<dns.LookupAddress[]>;

/**
 * Default resolver backed by Node's DNS. Uses `lookup(..., { all: true })`
 * so every A/AAAA result is inspected — a single private/loopback A record
 * among public records is enough to deny the request.
 *
 * `verbatim: true` requests results in the DNS order returned by the
 * resolver, mirroring what connect-time resolution would observe.
 */
export const defaultHostResolver: HostResolver = {
  async lookup(hostname, options) {
    const results = await lookupAll(hostname, {
      all: true,
      hints: dns.ADDRCONFIG,
      verbatim: true,
    });
    return results.map((r) => ({
      address: r.address,
      family: r.family === 6 ? 6 : 4,
    }));
  },
};

/**
 * Resolve a hostname and validate EVERY resolved address against the deny
 * list. This is the DNS-rebinding defence-in-depth layer: the resolution
 * happens at request time, and any resolved address that falls into a denied
 * range rejects the whole request.
 */
export async function checkResolvedAddresses(
  hostname: string,
  resolver: HostResolver = defaultHostResolver
): Promise<ResolvedAddressCheck> {
  let addresses: { address: string; family: 4 | 6 }[];
  try {
    addresses = await resolver.lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: "dns-resolution-failure", addresses: [] };
  }

  if (!addresses || addresses.length === 0) {
    return { ok: false, reason: "no-resolved-addresses", addresses: [] };
  }

  const addrStrings = addresses.map((a) => a.address);

  for (const a of addresses) {
    const safety = checkAddress(a.address);
    if (safety.denied) {
      return {
        ok: false,
        reason: (safety.reason as EgressDenyReason) || "undetermined-address",
        addresses: addrStrings,
      };
    }
  }

  return { ok: true, addresses: addrStrings };
}
