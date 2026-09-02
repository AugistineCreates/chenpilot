/**
 * Runtime network identity checks.
 *
 * A client configured with an inconsistent passphrase, Horizon URL, RPC URL,
 * or contract/asset registry can submit valid transactions to the wrong
 * environment. On mainnet such a mistake is irreversible, so all configured
 * services must attest to the same network identity before the SDK builds,
 * signs, or submits anything.
 *
 * Safety contract (acceptance criteria):
 *  - all configured services must agree on network identity;
 *  - mismatch / discovery errors NEVER include secret keys or signed payloads
 *    (see {@link redactSensitive});
 *  - unreachable or unrecognized identities fail closed when asserted.
 */

import { SorobanNetwork } from "./types";

// ─── Canonical identity data ───────────────────────────────────────────────────

/** Network passphrases for the two canonical Stellar networks. */
export const NETWORK_PASSPHRASES: Record<SorobanNetwork, string> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};

/** Default Horizon endpoints for each canonical network. */
export const DEFAULT_HORIZON_URLS: Record<SorobanNetwork, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

/** Default Soroban RPC endpoints for each canonical network. */
export const DEFAULT_RPC_URLS: Record<SorobanNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

/** Hostnames that always identify the public (mainnet) network. */
const RELIABLE_MAINNET_HOSTS = new Set([
  "horizon.stellar.org",
  "soroban-mainnet.stellar.org",
  "soroban.stellar.org",
  "stellar.org",
]);

/** Substrings that identify a dev/test endpoint in URL hostnames. */
const TESTNET_URL_HINTS = ["testnet", "sandbox", "standalone", "localhost"];
// ─── Types ─────────────────────────────────────────────────────────────────────

export type NetworkIdentitySource =
  | "rpc"
  | "horizon"
  | "passphrase"
  | "url"
  | "registry";

/** A network identity observed at runtime from a single service. */
export interface NetworkIdentity {
  /** `unknown` when the endpoint answered but its attestation is unrecognized. */
  network: SorobanNetwork | "unknown";
  /** Raw passphrase attestation, when the service discloses one. */
  networkPassphrase: string | null;
  source: NetworkIdentitySource;
  /** Normalized (hostname-only) endpoint the identity was discovered from. */
  endpoint: string;
  discoveredAt: number;
  /** True when the identity came from the verifier's discovery cache. */
  fromCache?: boolean;
}

export type ServiceKind =
  | "passphrase"
  | "horizon"
  | "rpc"
  | "contractRegistry"
  | "assetRegistry";

export type AgreementStatus =
  | "verified"
  | "mismatch"
  | "unknown"
  | "unreachable"
  | "not_configured";

/** Per-service attestation result inside a {@link NetworkAgreementReport}. */
export interface ServiceAgreement {
  service: ServiceKind;
  status: AgreementStatus;
  /** Optional human-readable detail describing the service that attested. */
  detail?: string;
}

/** Result of a full multi-service network identity check. */
export interface NetworkAgreementReport {
  expectedNetwork: SorobanNetwork;
  /** The network attested by the first verified endpoint, if any. */
  discoveredNetwork: SorobanNetwork | "unknown" | null;
  services: ServiceAgreement[];
  /** True when every configured service agrees on the expected network. */
  verified: boolean;
  verifiedAt: number;
  /** True when the identity came from a (possibly stale) discovery cache. */
  discoveredFromCache?: boolean;
}

export interface NetworkIdentityVerifierConfig {
  /** The network the client believes it is on (required for enforcement). */
  expectedNetwork: SorobanNetwork;
  /** Configured Horizon endpoints; every reachable one must agree. */
  horizonUrls?: string[];
  /** Configured RPC endpoints; every reachable one must agree. */
  rpcUrls?: string[];
  /** Explicit network passphrase from the client configuration. */
  networkPassphrase?: string;
  /** fetch implementation (proxy-compatible); defaults to globalThis.fetch. */
  fetcher?: typeof fetch;
  /** Discovery-cache TTL in ms (default 60_000). */
  discoveryTtlMs?: number;
  /**
   * Fail-closed reachability: when true, unreachable endpoints make the report
   * unverified. When false, unreachable endpoints are reported but do not by
   * themselves fail the check (best effort discovery).
   */
  requireReachability?: boolean;
  /** Return the canonical networks present in the contract registry. */
  contractRegistryNetworks?: () => SorobanNetwork[];
  /** Return the network scopes present in the asset cache. */
  assetRegistryNetworks?: () => string[];
  /** Per-endpoint discovery timeout in ms (default 10_000). */
  timeoutMs?: number;
}
// ─── Pure resolution helpers ───────────────────────────────────────────────────

/**
 * Resolve a configured/attested passphrase to a canonical network.
 * Returns `undefined` for unrecognized (e.g. futurenet/custom) passphrases.
 */
export function resolveNetworkFromPassphrase(
  passphrase: string
): SorobanNetwork | undefined {
  const trimmed = (passphrase ?? "").trim();
  if (!trimmed) return undefined;
  if (trimmed === NETWORK_PASSPHRASES.mainnet) return "mainnet";
  if (trimmed === NETWORK_PASSPHRASES.testnet) return "testnet";

  // Explicit substrings only — never bucket an unrecognized network (e.g.
  // Futurenet or a custom standalone passphrase) into a canonical network.
  const lower = trimmed.toLowerCase();
  if (lower.includes("testnet")) return "testnet";
  if (
    lower.includes("mainnet") ||
    lower.includes("public global") ||
    lower.includes("pubnet")
  ) {
    return "mainnet";
  }
  return undefined;
}

/** Normalize an endpoint URL to its lowercase hostname (no credentials/paths). */
export function normalizeEndpointUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return String(url ?? "").trim().toLowerCase();
  }
}

/**
 * Best-effort network hint derived from a URL. Endpoints that can host either
 * network (e.g. a generic gateway) resolve to `undefined`, never to a guess.
 */
export function resolveNetworkFromUrl(
  url: string
): SorobanNetwork | undefined {
  const host = normalizeEndpointUrl(url);
  if (!host) return undefined;
  if (TESTNET_URL_HINTS.some((h) => host.includes(h))) return "testnet";
  if (host.includes("mainnet")) return "mainnet";
  if (RELIABLE_MAINNET_HOSTS.has(host)) return "mainnet";
  return undefined;
}

const SECRET_KEY_PATTERN = /S[1-9A-HJ-NP-Za-km-z]{55}/g;
const SIGNED_XDR_PATTERN = /[A-Za-z0-9+/]{40,}={0,2}/g;

/**
 * Strip known secret material (Stellar secret keys, signed XDR blobs) from a
 * string. Applied defensively to every value interpolated into an error.
 */
export function redactSensitive(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text
    .replace(SECRET_KEY_PATTERN, "[REDACTED_SECRET_KEY]")
    .replace(SIGNED_XDR_PATTERN, "[REDACTED_SIGNED_PAYLOAD]");
}
// ─── Errors ────────────────────────────────────────────────────────────────────

export type NetworkIdentityErrorCode =
  | "NETWORK_MISMATCH"
  | "NETWORK_DISCOVERY_FAILED"
  | "NETWORK_UNVERIFIABLE"
  | "NETWORK_IDENTITY_UNRECOGNIZED"
  | "NETWORK_IDENTITY_DISABLED";

/**
 * Base error for all network identity failures.
 *
 * Only pre-sanitized data is ever stored or serialized; secret keys and signed
 * transaction payloads are never included.
 */
export class NetworkIdentityError extends Error {
  readonly code: NetworkIdentityErrorCode;
  readonly expectedNetwork?: SorobanNetwork;
  readonly discoveredNetwork?: SorobanNetwork | "unknown";

  constructor(
    message: string,
    code: NetworkIdentityErrorCode,
    opts: {
      expectedNetwork?: SorobanNetwork;
      discoveredNetwork?: SorobanNetwork | "unknown";
    } = {}
  ) {
    super(redactSensitive(message));
    this.name = "NetworkIdentityError";
    this.code = code;
    this.expectedNetwork = opts.expectedNetwork;
    this.discoveredNetwork = opts.discoveredNetwork;
  }

  /** Safe, serializable shape — never contains secret or payload data. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      expectedNetwork: this.expectedNetwork,
      discoveredNetwork: this.discoveredNetwork,
    };
  }
}

/** Raised when configured services attest to different networks. */
export class NetworkMismatchError extends NetworkIdentityError {
  readonly mismatchedServices: ServiceKind[];
  readonly report?: NetworkAgreementReport;

  constructor(opts: {
    expectedNetwork: SorobanNetwork;
    discoveredNetwork: SorobanNetwork | "unknown";
    mismatchedServices: ServiceKind[];
    report?: NetworkAgreementReport;
  }) {
    const services = opts.mismatchedServices.length
      ? ` Services: ${opts.mismatchedServices.join(", ")}.`
      : "";
    super(
      `Network identity mismatch: client is configured for "${opts.expectedNetwork}" ` +
        `but the configured services attest to "${opts.discoveredNetwork}".` +
        services +
        " Refusing to proceed.",
      "NETWORK_MISMATCH",
      {
        expectedNetwork: opts.expectedNetwork,
        discoveredNetwork: opts.discoveredNetwork,
      }
    );
    this.name = "NetworkMismatchError";
    this.mismatchedServices = opts.mismatchedServices;
    this.report = opts.report;
  }
}

/** Raised when no endpoint could be reached to disclose an identity. */
export class NetworkDiscoveryError extends NetworkIdentityError {
  readonly endpointsTried: string[];

  constructor(
    message: string,
    endpointsTried: string[],
    opts: {
      expectedNetwork?: SorobanNetwork;
      discoveredNetwork?: SorobanNetwork | "unknown";
    } = {},
    code: NetworkIdentityErrorCode = "NETWORK_DISCOVERY_FAILED"
  ) {
    super(message, code, opts);
    this.name = "NetworkDiscoveryError";
    this.endpointsTried = [...endpointsTried];
  }
}

/** Raised when identity cannot be confirmed and the operation must fail closed. */
export class NetworkUnverifiableError extends NetworkDiscoveryError {
  constructor(message: string, endpointsTried: string[]) {
    super(message, endpointsTried, {}, "NETWORK_UNVERIFIABLE");
    this.name = "NetworkUnverifiableError";
  }
}

export function isNetworkMismatchError(
  error: unknown
): error is NetworkMismatchError {
  return error instanceof NetworkMismatchError;
}

export function isNetworkIdentityError(
  error: unknown
): error is NetworkIdentityError {
  return error instanceof NetworkIdentityError;
}
// ─── Runtime discovery ─────────────────────────────────────────────────────────

export interface DiscoverEndpointOptions {
  fetchTimeoutMs?: number;
}

interface JsonRpcPayload {
  jsonrpc: string;
  id: number;
  method: string;
  params: unknown;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal as AbortSignal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover the network identity attested by a Soroban RPC endpoint using the
 * standardized `getNetwork` method.
 *
 * @throws {NetworkDiscoveryError} when the endpoint is unreachable or the
 *   result carries no recognizable identity.
 */
export async function discoverNetworkIdentityFromRpc(
  rpcUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
  options: DiscoverEndpointOptions = {}
): Promise<NetworkIdentity> {
  const timeoutMs = options.fetchTimeoutMs ?? 10_000;
  const body: JsonRpcPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getNetwork",
    params: [],
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(
      rpcUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      fetcher,
      timeoutMs
    );
  } catch (err) {
    throw new NetworkDiscoveryError(
      `Failed to reach RPC endpoint ${normalizeEndpointUrl(rpcUrl)}: ${redactSensitive(
        err instanceof Error ? err.message : err
      )}`,
      [rpcUrl]
    );
  }

  if (!response.ok) {
    throw new NetworkDiscoveryError(
      `RPC endpoint ${normalizeEndpointUrl(rpcUrl)} rejected getNetwork with HTTP ${response.status}`,
      [rpcUrl]
    );
  }

  const payload = (await response.json()) as {
    result?: {
      networkPassphrase?: string;
      passphrase?: string;
      network?: string;
      friendbotUrl?: string;
    };
    error?: { code?: number; message?: string };
  };

  if (payload.error) {
    throw new NetworkDiscoveryError(
      `RPC endpoint ${normalizeEndpointUrl(rpcUrl)} returned an error for getNetwork: ${
        payload.error.message ?? payload.error.code
      }`,
      [rpcUrl]
    );
  }

  const result = payload.result ?? {};

  if (typeof result.networkPassphrase === "string" && result.networkPassphrase) {
    return identityFromPassphrase(result.networkPassphrase, "rpc", rpcUrl);
  }
  if (typeof result.passphrase === "string" && result.passphrase) {
    return identityFromPassphrase(result.passphrase, "rpc", rpcUrl);
  }
  if (result.network === "testnet" || result.network === "mainnet") {
    return {
      network: result.network,
      networkPassphrase: NETWORK_PASSPHRASES[result.network],
      source: "rpc",
      endpoint: normalizeEndpointUrl(rpcUrl),
      discoveredAt: Date.now(),
    };
  }

  throw new NetworkDiscoveryError(
    `RPC endpoint ${normalizeEndpointUrl(rpcUrl)} returned no recognizable network identity`,
    [rpcUrl]
  );
}

/**
 * Discover the network identity attested by the Horizon root endpoint
 * (`GET /`, reading `network_passphrase`).
 *
 * @throws {NetworkDiscoveryError} when the endpoint is unreachable or the root
 *   document carries no `network_passphrase`.
 */
export async function discoverNetworkIdentityFromHorizon(
  horizonUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
  options: DiscoverEndpointOptions = {}
): Promise<NetworkIdentity> {
  const timeoutMs = options.fetchTimeoutMs ?? 10_000;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      horizonUrl,
      { method: "GET", headers: { Accept: "application/json" } },
      fetcher,
      timeoutMs
    );
  } catch (err) {
    throw new NetworkDiscoveryError(
      `Failed to reach Horizon endpoint ${normalizeEndpointUrl(horizonUrl)}: ${redactSensitive(
        err instanceof Error ? err.message : err
      )}`,
      [horizonUrl]
    );
  }

  if (!response.ok) {
    throw new NetworkDiscoveryError(
      `Horizon endpoint ${normalizeEndpointUrl(horizonUrl)} rejected the root request with HTTP ${response.status}`,
      [horizonUrl]
    );
  }

  const payload = (await response.json()) as { network_passphrase?: string };

  if (typeof payload.network_passphrase !== "string" || !payload.network_passphrase) {
    throw new NetworkDiscoveryError(
      `Horizon endpoint ${normalizeEndpointUrl(horizonUrl)} returned no network_passphrase`,
      [horizonUrl]
    );
  }

  return identityFromPassphrase(payload.network_passphrase, "horizon", horizonUrl);
}

function identityFromPassphrase(
  passphrase: string,
  source: "rpc" | "horizon",
  endpointUrl: string
): NetworkIdentity {
  const network = resolveNetworkFromPassphrase(passphrase);
  return {
    network: network ?? "unknown",
    networkPassphrase: passphrase,
    source,
    endpoint: normalizeEndpointUrl(endpointUrl),
    discoveredAt: Date.now(),
  };
}
// ─── Verifier ──────────────────────────────────────────────────────────────────

interface EndpointRef {
  kind: "rpc" | "horizon";
  url: string;
}

interface CachedIdentity {
  identity: NetworkIdentity;
  fetchedAt: number;
}

export interface VerifyOptions {
  /** Bypass the discovery cache (used by signing paths and endpoint changes). */
  forceRefresh?: boolean;
}

/**
 * Runtime network identity verifier.
 *
 * Discovers the identity attested by every configured endpoint (with caching
 * and endpoint failover) and asserts that all configured services — passphrase,
 * RPC, Horizon, contract registry and asset registry — agree on the expected
 * network before the caller builds, signs, or submits.
 */
export class NetworkIdentityVerifier {
  public readonly config: Required<
    Pick<
      NetworkIdentityVerifierConfig,
      | "expectedNetwork"
      | "fetcher"
      | "discoveryTtlMs"
      | "requireReachability"
      | "timeoutMs"
    >
  > &
    NetworkIdentityVerifierConfig;

  private readonly cache = new Map<string, CachedIdentity>();
  private lastReport: NetworkAgreementReport | null = null;

  constructor(config: NetworkIdentityVerifierConfig) {
    if (config.expectedNetwork !== "testnet" && config.expectedNetwork !== "mainnet") {
      throw new TypeError(`Invalid expectedNetwork: ${String(config.expectedNetwork)}`);
    }
    this.config = {
      expectedNetwork: config.expectedNetwork,
      horizonUrls: config.horizonUrls ?? [],
      rpcUrls: config.rpcUrls ?? [],
      networkPassphrase: config.networkPassphrase,
      fetcher: config.fetcher ?? globalThis.fetch.bind(globalThis),
      discoveryTtlMs: config.discoveryTtlMs ?? 60_000,
      requireReachability: config.requireReachability ?? false,
      contractRegistryNetworks: config.contractRegistryNetworks,
      assetRegistryNetworks: config.assetRegistryNetworks,
      timeoutMs: config.timeoutMs ?? 10_000,
    };
  }

  private discoveryEndpoints(): EndpointRef[] {
    return [
      ...(this.config.rpcUrls ?? []).map((url): EndpointRef => ({ kind: "rpc", url })),
      ...(this.config.horizonUrls ?? []).map(
        (url): EndpointRef => ({ kind: "horizon", url })
      ),
    ];
  }

  private async discoverEndpoint(
    endpoint: EndpointRef,
    forceRefresh: boolean
  ): Promise<NetworkIdentity | null> {
    const key = `${endpoint.kind}:${normalizeEndpointUrl(endpoint.url)}`;
    const cached = this.cache.get(key);
    if (
      cached &&
      !forceRefresh &&
      Date.now() - cached.fetchedAt < this.config.discoveryTtlMs
    ) {
      return { ...cached.identity, fromCache: true };
    }

    try {
      const identity =
        endpoint.kind === "rpc"
          ? await discoverNetworkIdentityFromRpc(
              endpoint.url,
              this.config.fetcher,
              { fetchTimeoutMs: this.config.timeoutMs }
            )
          : await discoverNetworkIdentityFromHorizon(
              endpoint.url,
              this.config.fetcher,
              { fetchTimeoutMs: this.config.timeoutMs }
            );
      this.cache.set(key, { identity, fetchedAt: Date.now() });
      return identity;
    } catch {
      return null;
    }
  }
/**
   * Best-effort multi-service agreement check. Never throws for network
   * conditions; inspect `report.verified` (or use {@link assertVerified}).
   */
  async verify(options: VerifyOptions = {}): Promise<NetworkAgreementReport> {
    const expected = this.config.expectedNetwork;
    const services: ServiceAgreement[] = [];
    const mismatched: ServiceKind[] = [];

    let discoveredNetwork: SorobanNetwork | "unknown" | null = null;
    let discoveredFromCache = false;
    const endpointAttestations: NetworkIdentity[] = [];

    for (const endpoint of this.discoveryEndpoints()) {
      const identity = await this.discoverEndpoint(
        endpoint,
        options.forceRefresh ?? false
      );
      if (!identity) {
        services.push({
          service: endpoint.kind,
          status: "unreachable",
          detail: normalizeEndpointUrl(endpoint.url),
        });
        continue;
      }

      if (identity.fromCache) discoveredFromCache = true;
      endpointAttestations.push(identity);

      // Record the first concrete network any endpoint attests to, even when
      // it disagrees — so mismatch reports name the offending network.
      if (!discoveredNetwork && identity.network !== "unknown") {
        discoveredNetwork = identity.network;
      }

      if (identity.network === "unknown") {
        services.push({
          service: endpoint.kind,
          status: "unknown",
          detail: `${normalizeEndpointUrl(endpoint.url)} answered but its passphrase maps to no recognized network`,
        });
        mismatched.push(endpoint.kind);
        continue;
      }

      if (identity.network !== expected) {
        services.push({
          service: endpoint.kind,
          status: "mismatch",
          detail: `${normalizeEndpointUrl(endpoint.url)} is ${identity.network}, expected ${expected}`,
        });
        mismatched.push(endpoint.kind);
        continue;
      }

      services.push({
        service: endpoint.kind,
        status: "verified",
        detail: normalizeEndpointUrl(endpoint.url),
      });
    }

    if (this.config.networkPassphrase) {
      const resolved = resolveNetworkFromPassphrase(this.config.networkPassphrase);
      const attestations = endpointAttestations.filter(
        (i) => i.networkPassphrase !== null && i.networkPassphrase !== undefined
      );
      const contradiction = attestations.some(
        (i) => i.networkPassphrase !== this.config.networkPassphrase
      );
      const confirmation = attestations.some(
        (i) => i.networkPassphrase === this.config.networkPassphrase
      );

      let status: AgreementStatus;
      if (contradiction) {
        status = "mismatch";
      } else if (resolved === undefined) {
        status = "unknown";
      } else if (resolved === expected) {
        status = confirmation || attestations.length === 0 ? "verified" : "unknown";
      } else {
        status = "mismatch";
      }

      services.push({ service: "passphrase", status });
      if (status === "mismatch" || status === "unknown") {
        mismatched.push("passphrase");
      }
    }

    if (this.config.contractRegistryNetworks) {
      const networks = this.config.contractRegistryNetworks();
      const foreign = networks.filter((n) => n !== expected);
      services.push({
        service: "contractRegistry",
        status: foreign.length > 0 ? "mismatch" : "verified",
        detail:
          foreign.length > 0
            ? `contract registry contains contracts scoped to: ${foreign.join(", ")}`
            : undefined,
      });
      if (foreign.length > 0) mismatched.push("contractRegistry");
    }

    if (this.config.assetRegistryNetworks) {
      const networks = this.config.assetRegistryNetworks();
      const foreign = networks.filter((n) => n !== expected);
      services.push({
        service: "assetRegistry",
        status: foreign.length > 0 ? "mismatch" : "verified",
        detail:
          foreign.length > 0
            ? `asset cache contains entries scoped to: ${foreign.join(", ")}`
            : undefined,
      });
      if (foreign.length > 0) mismatched.push("assetRegistry");
    }

    const verified =
      mismatched.length === 0 &&
      !services.some((s) => s.status === "unknown") &&
      !(
        this.config.requireReachability &&
        services.some((s) => s.status === "unreachable")
      );

    this.lastReport = {
      expectedNetwork: expected,
      discoveredNetwork,
      services,
      verified,
      verifiedAt: Date.now(),
      ...(discoveredFromCache ? { discoveredFromCache: true } : {}),
    };
    return this.lastReport;
  }

  /**
   * Assert that every configured service agrees on the expected network.
   * Fail-closed: throws on mismatch, unrecognized identity, or when no
   * service could confirm the network at all.
   */
  async assertVerified(options: VerifyOptions = {}): Promise<NetworkAgreementReport> {
    const report = await this.verify(options);

    const mismatches = report.services.filter((s) => s.status === "mismatch");
    if (mismatches.length > 0) {
      throw new NetworkMismatchError({
        expectedNetwork: report.expectedNetwork,
        discoveredNetwork: report.discoveredNetwork ?? "unknown",
        mismatchedServices: mismatches.map((s) => s.service),
        report,
      });
    }

    const unknowns = report.services.filter((s) => s.status === "unknown");
    if (unknowns.length > 0) {
      throw new NetworkIdentityError(
        `Cannot verify network identity: ${unknowns
          .map((s) => s.service)
          .join(", ")} reported an unrecognized network`,
        "NETWORK_IDENTITY_UNRECOGNIZED",
        { expectedNetwork: report.expectedNetwork }
      );
    }

    if (!report.services.some((s) => s.status === "verified")) {
      throw new NetworkUnverifiableError(
        "Cannot verify network identity: no configured service could confirm the network. " +
          "Provide a reachable RPC/Horizon endpoint or an explicit network passphrase.",
        this.discoveryEndpoints().map((e) => e.url)
      );
    }

    return report;
  }

  /**
   * Identity check used immediately before signing or submitting.
   * Always force-refreshes discovery so stale cache entries cannot mask an
   * endpoint that changed networks since the last check.
   */
  async verifyBeforeSigning(options: VerifyOptions = {}): Promise<NetworkAgreementReport> {
    return this.assertVerified({ ...options, forceRefresh: true });
  }

  /** Last report produced by this verifier. */
  getLastReport(): NetworkAgreementReport | null {
    return this.lastReport;
  }

  /** Drop all cached discoveries; the next check re-discovers every endpoint. */
  invalidate(): void {
    this.cache.clear();
    this.lastReport = null;
  }

  /** Number of identities currently held in the discovery cache. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** True when the most recent report has at least one verified service. */
  get isConfirmed(): boolean {
    return (
      this.lastReport !== null &&
      this.lastReport.services.some((s) => s.status === "verified")
    );
  }
}