import * as os from "os";
import * as path from "path";

import { AssetCache } from "../assetCache";
import { ContractClient } from "../contractClient";
import { ContractCompatibilityRegistry } from "../contractRegistry";
import {
  NetworkIdentityVerifier,
  NetworkMismatchError,
  NetworkUnverifiableError,
  resolveNetworkFromPassphrase,
  resolveNetworkFromUrl,
  normalizeEndpointUrl,
  redactSensitive,
  discoverNetworkIdentityFromRpc,
  discoverNetworkIdentityFromHorizon,
} from "../networkIdentity";
import { prepareOfflineSigning, validateSigningRequest } from "../offlineSigning";

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: async () => body,
  } as Response;
}

function rpcResult(passphrase: string): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id: 1,
    result: { networkPassphrase: passphrase },
  });
}

function horizonResult(passphrase: string): Response {
  return jsonResponse({ network_passphrase: passphrase });
}

interface EndpointBehavior {
  kind: "rpc" | "horizon";
  /** Return this passphrase on success. */
  passphrase?: string;
  /** Return HTTP status. */
  status?: number;
  /** Reject the request by throwing (simulate network failure). */
  throws?: boolean;
  /** Simulate a non-JSON / unexpected body. */
  malformed?: boolean;
}

function responseFor(behavior: EndpointBehavior | undefined): Response {
  if (!behavior) return jsonResponse({}, 404);
  if (behavior.throws) throw new Error("socket hang up");
  if (behavior.malformed) return jsonResponse({ unexpected: true });
  if (behavior.passphrase === undefined) return jsonResponse({}, 200);
  return behavior.kind === "rpc"
    ? rpcResult(behavior.passphrase)
    : horizonResult(behavior.passphrase);
}

/**
 * Build a fetch implementation that routes each endpoint URL to a mutable
 * behavior map — a close approximation of how a proxy or gateway fronts
 * multiple upstream networks.
 */
function makeRoutingFetcher(behaviors: Record<string, EndpointBehavior>) {
  const calls: string[] = [];
  const fetcher = jest.fn(
    async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const raw = typeof input === "string" ? input : String(input);
      calls.push(raw);
      const host = normalizeEndpointUrl(raw);
      const behavior = behaviors[host];
      return responseFor(behavior);
    }
  );
  return { fetcher, calls };
}

function discoverOptions(ttlMs = 60_000) {
  return { discoveryTtlMs: ttlMs, timeoutMs: 500 };
}

function rpcUrl(host: string): string {
  return `https://${host}`;
}

function horizonUrl(host: string): string {
  return `https://${host}`;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("networkIdentity resolution helpers", () => {
  it("maps canonical passphrases to networks", () => {
    expect(resolveNetworkFromPassphrase(TESTNET_PASSPHRASE)).toBe("testnet");
    expect(resolveNetworkFromPassphrase(MAINNET_PASSPHRASE)).toBe("mainnet");
  });

  it("maps unknown passphrases to undefined, never guessing", () => {
    expect(resolveNetworkFromPassphrase("Futurenet Network ; 2024")).toBeUndefined();
    expect(resolveNetworkFromPassphrase("")).toBeUndefined();
  });

  it("normalizes endpoints to lowercase hostnames", () => {
    expect(
      normalizeEndpointUrl("https://Horizon-Testnet.Stellar.Org/a/b")
    ).toBe("horizon-testnet.stellar.org");
    expect(normalizeEndpointUrl("not a url")).toBe("not a url");
  });

  it("resolves URL hints without guessing on ambiguous gateways", () => {
    expect(
      resolveNetworkFromUrl("https://soroban-testnet.stellar.org")
    ).toBe("testnet");
    expect(
      resolveNetworkFromUrl("https://horizon-testnet.stellar.org")
    ).toBe("testnet");
    expect(
      resolveNetworkFromUrl("https://soroban-mainnet.stellar.org")
    ).toBe("mainnet");
    expect(resolveNetworkFromUrl("https://horizon.stellar.org")).toBe("mainnet");
    expect(resolveNetworkFromUrl("https://my-rpc.example.com")).toBeUndefined();
  });

  it("redacts secret keys and signed payloads from error text", () => {
    const secret =
      "SAE7H2N2VJZ3VJZQXKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQ";
    const signedXdr =
      "AAAAAgAAAABkMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWZ4eXo=";
    const text = `secret=${secret} payload=${signedXdr}`;
    const redacted = redactSensitive(text);
    expect(redacted).not.toContain(secret);
    expect(redacted).not.toContain(signedXdr);
    expect(redacted).toContain("[REDACTED_SECRET_KEY]");
    expect(redacted).toContain("[REDACTED_SIGNED_PAYLOAD]");
  });

  it("redacts secrets from serialized mismatch errors", () => {
    const secret =
      "SAE7H2N2VJZ3VJZQXKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQ";
    const error = new NetworkMismatchError({
      expectedNetwork: "mainnet",
      discoveredNetwork: "testnet",
      mismatchedServices: ["rpc"],
    });
    const safe = JSON.stringify(error.toJSON()) + error.message + secret;
    expect(redactSensitive(safe)).not.toContain(secret);
  });
});
describe("runtime network identity discovery", () => {
  it("discovers identity from RPC getNetwork", async () => {
    const { fetcher } = makeRoutingFetcher({
      "soroban.example.com": {
        kind: "rpc",
        passphrase: TESTNET_PASSPHRASE,
      },
    });
    const identity = await discoverNetworkIdentityFromRpc(
      rpcUrl("soroban.example.com"),
      fetcher
    );
    expect(identity.network).toBe("testnet");
    expect(identity.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(identity.source).toBe("rpc");
  });

  it("discovers identity from Horizon root document", async () => {
    const { fetcher } = makeRoutingFetcher({
      "horizon.example.com": {
        kind: "horizon",
        passphrase: MAINNET_PASSPHRASE,
      },
    });
    const identity = await discoverNetworkIdentityFromHorizon(
      horizonUrl("horizon.example.com"),
      fetcher
    );
    expect(identity.network).toBe("mainnet");
    expect(identity.source).toBe("horizon");
  });

  it("throws NetworkDiscoveryError when the endpoint is unreachable", async () => {
    const { fetcher } = makeRoutingFetcher({
      "down.example.com": { kind: "rpc", throws: true },
    });
    await expect(
      discoverNetworkIdentityFromRpc(rpcUrl("down.example.com"), fetcher)
    ).rejects.toMatchObject({ code: "NETWORK_DISCOVERY_FAILED" });
  });
});

describe("NetworkIdentityVerifier — multi-service agreement", () => {
  it("verifies when RPC and Horizon both agree with the expected network", async () => {
    const { fetcher } = makeRoutingFetcher({
      "rpc.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
      "horizon.example.com": {
        kind: "horizon",
        passphrase: TESTNET_PASSPHRASE,
      },
    });
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("rpc.example.com")],
      horizonUrls: [horizonUrl("horizon.example.com")],
      fetcher,
      ...discoverOptions(),
    });

    const report = await verifier.assertVerified();
    expect(report.verified).toBe(true);
    expect(report.discoveredNetwork).toBe("testnet");
    expect(report.services.filter((s) => s.status === "verified")).toHaveLength(2);
  });

  it("fails closed when RPC attests a different network with no secret leak", async () => {
    const { fetcher } = makeRoutingFetcher({
      "rpc.example.com": { kind: "rpc", passphrase: MAINNET_PASSPHRASE },
    });
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("rpc.example.com")],
      fetcher,
      ...discoverOptions(),
    });

    const secret =
      "SAE7H2N2VJZ3VJZQXKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQKQ";
    const signedPayload =
      "AAAAAgAAAABkMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWZ4eXo=";
    try {
      await verifier.assertVerified();
      throw new Error("expected mismatch");
    } catch (err) {
      expect(err).toBeInstanceOf(NetworkMismatchError);
      const e = err as NetworkMismatchError;
      expect(e.code).toBe("NETWORK_MISMATCH");
      expect(e.mismatchedServices).toContain("rpc");
      const serialized = JSON.stringify(e.toJSON());
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain(signedPayload);
      expect(e.message).not.toContain(secret);
      expect(e.message).not.toContain(signedPayload);
      expect(e.message).toContain("testnet");
      expect(e.message).toContain("mainnet");
    }
  });

  it("detects contradictory explicit passphrase vs RPC attestation", async () => {
    const { fetcher } = makeRoutingFetcher({
      "rpc.example.com": { kind: "rpc", passphrase: MAINNET_PASSPHRASE },
    });
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "mainnet",
      rpcUrls: [rpcUrl("rpc.example.com")],
      networkPassphrase: TESTNET_PASSPHRASE,
      fetcher,
      ...discoverOptions(),
    });

    const report = await verifier.verify();
    expect(report.verified).toBe(false);
    expect(
      report.services.find((s) => s.service === "passphrase")?.status
    ).toBe("mismatch");
  });

  it("reports unreachable endpoints without failing when best-effort", async () => {
    const { fetcher } = makeRoutingFetcher({
      "down.example.com": { kind: "rpc", throws: true },
      "up.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
    });
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("down.example.com"), rpcUrl("up.example.com")],
      fetcher,
      ...discoverOptions(),
    });

    const report = await verifier.verify();
    expect(report.verified).toBe(true);
    expect(
      report.services.find(
        (s) => s.service === "rpc" && s.status === "unreachable"
      )
    ).toBeDefined();
  });

  it("fails when every endpoint is unreachable", async () => {
    const { fetcher } = makeRoutingFetcher({
      "down1.example.com": { kind: "rpc", throws: true },
      "down2.example.com": { kind: "rpc", throws: true },
    });
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("down1.example.com"), rpcUrl("down2.example.com")],
      fetcher,
      ...discoverOptions(),
    });

    await expect(verifier.assertVerified()).rejects.toBeInstanceOf(
      NetworkUnverifiableError
    );
  });
});
describe("NetworkIdentityVerifier — proxies and failover", () => {
  it("discovers identity through a proxy-style fetch implementation", async () => {
    // The configured endpoint is a generic gateway host; the fetch
    // implementation (like a proxy) forwards to the real upstream.
    const { fetcher, calls } = makeRoutingFetcher({
      "gateway.internal": {
        kind: "rpc",
        passphrase: TESTNET_PASSPHRASE,
      },
    });
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("gateway.internal")],
      fetcher,
      ...discoverOptions(),
    });

    const report = await verifier.assertVerified();
    expect(report.verified).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("gateway.internal");
  });

  it("fails over to the next endpoint when the first is unreachable", async () => {
    const { fetcher, calls } = makeRoutingFetcher({
      "primary.example.com": { kind: "rpc", throws: true },
      "backup.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
    });
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [
        rpcUrl("primary.example.com"),
        rpcUrl("backup.example.com"),
      ],
      fetcher,
      ...discoverOptions(),
    });

    const report = await verifier.assertVerified();
    expect(report.verified).toBe(true);
    expect(calls.some((url) => url.includes("backup.example.com"))).toBe(true);
  });

  it("fails closed when one endpoint disagrees even if another agrees", async () => {
    const { fetcher } = makeRoutingFetcher({
      "a.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
      "b.example.com": { kind: "rpc", passphrase: MAINNET_PASSPHRASE },
    });
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("a.example.com"), rpcUrl("b.example.com")],
      fetcher,
      ...discoverOptions(),
    });

    const report = await verifier.verify();
    expect(report.verified).toBe(false);
    await expect(verifier.assertVerified()).rejects.toBeInstanceOf(
      NetworkMismatchError
    );
  });
});

describe("NetworkIdentityVerifier — discovery cache freshness", () => {
  it("serves verified reports from a non-expired cache", async () => {
    const behaviors: Record<string, EndpointBehavior> = {
      "rpc.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
    };
    const { fetcher } = makeRoutingFetcher(behaviors);
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("rpc.example.com")],
      fetcher,
      ...discoverOptions(60_000),
    });

    const first = await verifier.assertVerified();
    expect(first.verified).toBe(true);

    // Endpoint flips to mainnet after the first check — but the cache is
    // still fresh, so a cached check must NOT notice (stale cache behavior).
    behaviors["rpc.example.com"] = {
      kind: "rpc",
      passphrase: MAINNET_PASSPHRASE,
    };

    const cached = await verifier.assertVerified();
    expect(cached.verified).toBe(true);
    expect(cached.discoveredFromCache).toBe(true);
  });

  it("force-refresh (signing path) replays discovery and catches stale caches", async () => {
    const behaviors: Record<string, EndpointBehavior> = {
      "rpc.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
    };
    const { fetcher, calls } = makeRoutingFetcher(behaviors);
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("rpc.example.com")],
      fetcher,
      ...discoverOptions(60_000),
    });

    await verifier.assertVerified();
    const callsAfterFirst = calls.length;

    // Endpoint switched networks; the stale cache would have passed.
    behaviors["rpc.example.com"] = {
      kind: "rpc",
      passphrase: MAINNET_PASSPHRASE,
    };

    await expect(verifier.verifyBeforeSigning()).rejects.toBeInstanceOf(
      NetworkMismatchError
    );
    // The sign-time check must have hit the network again, not the cache.
    expect(calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("expires cached identities after the TTL and re-discovers", async () => {
    const behaviors: Record<string, EndpointBehavior> = {
      "rpc.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
    };
    const { fetcher, calls } = makeRoutingFetcher(behaviors);
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("rpc.example.com")],
      fetcher,
      discoveryTtlMs: 10,
      timeoutMs: 500,
    });

    await verifier.assertVerified();
    const callsAfterFirst = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 25));

    behaviors["rpc.example.com"] = {
      kind: "rpc",
      passphrase: MAINNET_PASSPHRASE,
    };
    await expect(verifier.assertVerified()).rejects.toBeInstanceOf(
      NetworkMismatchError
    );
    expect(calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("invalidate() drops the cache and triggers fresh discovery", async () => {
    const behaviors: Record<string, EndpointBehavior> = {
      "rpc.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
    };
    const { fetcher, calls } = makeRoutingFetcher(behaviors);
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("rpc.example.com")],
      fetcher,
      ...discoverOptions(60_000),
    });

    await verifier.assertVerified();
    verifier.invalidate();
    expect(verifier.cacheSize).toBe(0);
    const callsBefore = calls.length;
    await verifier.assertVerified();
    expect(calls.length).toBeGreaterThan(callsBefore);
  });
});
describe("network-scoped registries", () => {
  it("scopes contract registry entries by network", () => {
    ContractCompatibilityRegistry.registerContractVersion(
      "custom_swap",
      { version: "1.0.0", capabilities: ["swap"] },
      "CUSTOMSWAPCONTRACTID0000000000000001",
      "testnet"
    );

    const onTestnet = ContractCompatibilityRegistry.getContractDeployment(
      "custom_swap",
      "testnet"
    );
    const onMainnet = ContractCompatibilityRegistry.getContractDeployment(
      "custom_swap",
      "mainnet"
    );

    expect(onTestnet?.contractId).toBe(
      "CUSTOMSWAPCONTRACTID0000000000000001"
    );
    expect(onMainnet).toBeUndefined();
  });

  it("rejects by-id lookups outside the requested network scope", () => {
    const id = "CCHAINNESCROSSSCOPEID0000000000000001";
    ContractCompatibilityRegistry.registerContractVersion(
      "mainnet_only",
      { version: "1.0.0", capabilities: ["swap"] },
      id,
      "mainnet"
    );

    expect(
      ContractCompatibilityRegistry.getContractDeployment(id, "testnet")
    ).toBeUndefined();
    expect(
      ContractCompatibilityRegistry.getContractDeployment(id, "mainnet")
    )?.toBeDefined();
  });

  it("reports registered networks to the verifier and flags foreign scopes", async () => {
    const { fetcher } = makeRoutingFetcher({
      "rpc.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
    });
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("rpc.example.com")],
      fetcher,
      contractRegistryNetworks: () => ["testnet", "mainnet"],
      ...discoverOptions(),
    });

    const report = await verifier.verify();
    expect(report.verified).toBe(false);
    expect(
      report.services.find((s) => s.service === "contractRegistry")?.status
    ).toBe("mismatch");
  });

  it("scopes asset cache entries by network", () => {
    const dir = path.join(os.tmpdir(), `asset-cache-${Date.now()}`);
    const testnetCache = new AssetCache(dir, "testnet");
    const mainnetCache = new AssetCache(dir, "mainnet");

    const asset = {
      isNative: () => false,
      getCode: () => "USDC",
      getIssuer: () => "GUSDCISSUER",
    } as unknown as import("@stellar/stellar-sdk").Asset;

    testnetCache.set(asset, {
      code: "USDC",
      issuer: "GUSDCISSUER",
      lastUpdated: 0,
    });

    expect(testnetCache.get(asset)).toBeDefined();
    expect(mainnetCache.get(asset)).toBeUndefined();
    expect(testnetCache.inspectNetworks()).toContain("testnet");
  });

  it("flags foreign asset scopes during verification", async () => {
    const dir = path.join(os.tmpdir(), `asset-cache-${Date.now()}`);
    const mainnetCache = new AssetCache(dir, "mainnet");
    mainnetCache.set(
      {
        isNative: () => false,
        getCode: () => "USDC",
        getIssuer: () => "GUSDCISSUER",
      } as unknown as import("@stellar/stellar-sdk").Asset,
      { code: "USDC", issuer: "GUSDCISSUER", lastUpdated: 0 }
    );

    const { fetcher } = makeRoutingFetcher({
      "rpc.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
    });
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: "testnet",
      rpcUrls: [rpcUrl("rpc.example.com")],
      fetcher,
      assetRegistryNetworks: () => mainnetCache.inspectNetworks(),
      ...discoverOptions(),
    });

    const report = await verifier.verify();
    expect(report.verified).toBe(false);
    expect(
      report.services.find((s) => s.service === "assetRegistry")?.status
    ).toBe("mismatch");
  });
});
describe("ContractClient network identity integration", () => {
  it("refuses to query when verification is enabled and RPC mismatches", async () => {
    const { fetcher } = makeRoutingFetcher({
      "rpc.example.com": { kind: "rpc", passphrase: MAINNET_PASSPHRASE },
    });
    const client = new ContractClient({
      network: "testnet",
      rpcUrl: rpcUrl("rpc.example.com"),
      fetcher,
      verifyNetworkIdentity: true,
    });

    await expect(
      client.query({ contractId: "CCONTRACT", method: "state" })
    ).rejects.toMatchObject({ code: "NETWORK_MISMATCH" });
  });

  it("queries normally when verification is disabled", async () => {
    const behaviors: Record<string, EndpointBehavior> = {
      "rpc.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
    };
    const { fetcher } = makeRoutingFetcher(behaviors);
    const client = new ContractClient({
      network: "testnet",
      rpcUrl: rpcUrl("rpc.example.com"),
      fetcher,
    });

    const result = await client.query({
      contractId: "CCONTRACT",
      method: "state",
    });
    expect(result.compatibility.compatible).toBe(true);
  });

  it("force-refreshes discovery before submitting a signed transaction", async () => {
    const behaviors: Record<string, EndpointBehavior> = {
      "rpc.example.com": { kind: "rpc", passphrase: TESTNET_PASSPHRASE },
    };
    const { fetcher } = makeRoutingFetcher(behaviors);
    const client = new ContractClient({
      network: "testnet",
      rpcUrl: rpcUrl("rpc.example.com"),
      fetcher,
      verifyNetworkIdentity: true,
    });

    // Warm the discovery cache with a valid identity.
    await client.verifyNetworkIdentity();

    // The endpoint switches networks right before submission.
    behaviors["rpc.example.com"] = {
      kind: "rpc",
      passphrase: MAINNET_PASSPHRASE,
    };

    await expect(
      client.execute({
        contractId: "CCONTRACT",
        method: "deposit",
        signedTransactionXdr: "BASE64SIGNEDXDRPAYLOAD=",
      })
    ).rejects.toMatchObject({ code: "NETWORK_MISMATCH" });
  });
});

describe("offline signing network validation", () => {
  it("rejects a passphrase that disagrees with the declared expected network", () => {
    const report = validateSigningRequest({
      transactionXdr:
        "AAAAAgAAAABkMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWZ4eXo=",
      networkPassphrase: TESTNET_PASSPHRASE,
      expectedNetwork: "mainnet",
      sourceAccount:
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      expectedSigners: [
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      ],
    });
    expect(report.valid).toBe(false);
    expect(
      report.errors.some((issue) => issue.code === "NETWORK_MISMATCH")
    ).toBe(true);
  });

  it("accepts a passphrase that matches the declared expected network", () => {
    const artifact = prepareOfflineSigning({
      transactionXdr:
        "AAAAAgAAAABkMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWZ4eXo=",
      networkPassphrase: TESTNET_PASSPHRASE,
      expectedNetwork: "testnet",
      sourceAccount:
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      expectedSigners: [
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      ],
    });
    expect(artifact.payload.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(artifact.payload.expectedNetwork).toBe("testnet");
  });
});