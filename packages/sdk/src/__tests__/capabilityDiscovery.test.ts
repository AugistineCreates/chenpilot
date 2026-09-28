/**
 * Tests for CapabilityDiscovery — Issue #378
 */

import { CapabilityDiscovery, createCapabilityDiscovery } from "../capabilityDiscovery";

const mockHorizonRoot = {
  core_supported_protocol_version: 21,
  horizon_version: "2.28.0",
};

function mockFetch(
  horizonOk = true,
  rpcOk = true
): jest.SpyInstance {
  return jest.spyOn(global, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    const urlStr = String(url);
    if (urlStr.includes("horizon")) {
      if (!horizonOk) throw new Error("horizon unreachable");
      return {
        ok: true,
        json: async () => mockHorizonRoot,
      } as Response;
    }
    if (!rpcOk) throw new Error("rpc unreachable");
    return {
      ok: true,
      json: async () => ({ result: { sequence: 1234 } }),
    } as Response;
  });
}

afterEach(() => jest.restoreAllMocks());

describe("CapabilityDiscovery.getCapabilities()", () => {
  it("returns sorobanEnabled=true when RPC is reachable", async () => {
    mockFetch(true, true);
    const d = new CapabilityDiscovery({ network: "testnet" });
    const caps = await d.getCapabilities();
    expect(caps.features.sorobanEnabled).toBe(true);
    expect(caps.versions.protocol).toBe(21);
    expect(caps.network).toBe("testnet");
  });

  it("returns sorobanEnabled=false when RPC is unreachable", async () => {
    mockFetch(true, false);
    const d = new CapabilityDiscovery({ network: "testnet" });
    const caps = await d.getCapabilities();
    expect(caps.features.sorobanEnabled).toBe(false);
    expect(caps.features.metadataEnabled).toBe(false);
  });

  it("caches result and avoids second fetch within TTL", async () => {
    const spy = mockFetch();
    const d = new CapabilityDiscovery({ network: "testnet", cacheTtlMs: 60_000 });
    await d.getCapabilities();
    await d.getCapabilities(); // should be cache hit
    expect(spy).toHaveBeenCalledTimes(2); // two underlying calls (horizon + rpc) from first getCapabilities
  });

  it("re-fetches after invalidateCache()", async () => {
    const spy = mockFetch();
    const d = new CapabilityDiscovery({ network: "testnet" });
    await d.getCapabilities();
    d.invalidateCache();
    await d.getCapabilities();
    expect(spy).toHaveBeenCalledTimes(4); // 2 per fetch * 2 fetches
  });
});

describe("CapabilityDiscovery.negotiate()", () => {
  it("returns compatible=true when all requirements are satisfied", async () => {
    mockFetch(true, true);
    const d = new CapabilityDiscovery({ network: "testnet" });
    const result = await d.negotiate({
      minProtocol: 20,
      requiredFeatures: ["sorobanEnabled", "feeBumpingEnabled"],
    });
    expect(result.compatible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("returns compatible=false when protocol is too old", async () => {
    mockFetch(true, true);
    const d = new CapabilityDiscovery({ network: "testnet" });
    const result = await d.negotiate({ minProtocol: 99 });
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("Protocol");
  });

  it("returns compatible=false when required feature is missing", async () => {
    mockFetch(true, false); // rpc down → sorobanEnabled=false
    const d = new CapabilityDiscovery({ network: "testnet" });
    const result = await d.negotiate({
      requiredFeatures: ["sorobanEnabled"],
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("sorobanEnabled");
  });

  it("includes capabilities in every negotiate result", async () => {
    mockFetch();
    const d = new CapabilityDiscovery({ network: "testnet" });
    const result = await d.negotiate({});
    expect(result.capabilities).toBeDefined();
    expect(result.capabilities.network).toBe("testnet");
  });
});

describe("createCapabilityDiscovery factory", () => {
  it("creates a CapabilityDiscovery instance", () => {
    const d = createCapabilityDiscovery("mainnet");
    expect(d).toBeInstanceOf(CapabilityDiscovery);
  });
});

describe("negotiate required backend capabilities when a client session starts (#869)", () => {
  it("should negotiate capabilities at session start", async () => {
    mockFetch(true, true);
    const d = new CapabilityDiscovery({ network: "testnet" });
    
    // Simulate session start negotiation
    const sessionNegotiation = await d.negotiate({
      minProtocol: 20,
      requiredFeatures: ["sorobanEnabled"],
    });
    
    expect(sessionNegotiation.compatible).toBe(true);
    expect(sessionNegotiation.capabilities).toBeDefined();
  });

  it("should fail session start when backend lacks required capabilities", async () => {
    mockFetch(true, false); // RPC down, no Soroban
    const d = new CapabilityDiscovery({ network: "testnet" });
    
    const sessionNegotiation = await d.negotiate({
      requiredFeatures: ["sorobanEnabled"],
    });
    
    expect(sessionNegotiation.compatible).toBe(false);
    expect(sessionNegotiation.reason).toContain("sorobanEnabled");
  });

  it("should negotiate multiple required features at session start", async () => {
    mockFetch(true, true);
    const d = new CapabilityDiscovery({ network: "testnet" });
    
    const result = await d.negotiate({
      minProtocol: 20,
      requiredFeatures: ["sorobanEnabled", "feeBumpingEnabled", "metadataEnabled"],
    });
    
    expect(result.compatible).toBe(true);
  });

  it("should return incompatible when protocol version is too old at session start", async () => {
    mockFetch(true, true);
    const d = new CapabilityDiscovery({ network: "testnet" });
    
    const result = await d.negotiate({
      minProtocol: 999, // Far future protocol
    });
    
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("Protocol");
  });

  it("should include full capability matrix in session negotiation result", async () => {
    mockFetch(true, true);
    const d = new CapabilityDiscovery({ network: "testnet" });
    
    const result = await d.negotiate({
      minProtocol: 20,
      requiredFeatures: ["sorobanEnabled"],
    });
    
    expect(result.capabilities.versions.protocol).toBe(21);
    expect(result.capabilities.features.sorobanEnabled).toBe(true);
    expect(result.capabilities.network).toBe("testnet");
  });
});
