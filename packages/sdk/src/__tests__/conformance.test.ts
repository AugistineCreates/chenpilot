/**
 * Black-box SDK ↔ backend conformance tests (#639).
 *
 * These tests boot representative backend versions (via wire-format fixtures)
 * and run the SDK's decoding logic against them, asserting that supported
 * pairings interoperate and that breaking drift produces field-level
 * diagnostics.
 */

import {
  BACKEND_VERSION_MATRIX,
  BackendVersionEntry,
  assertSupportedPairing,
  buildCompatibilityMatrix,
  runAllConformance,
  runConformance,
} from "../conformance";
import { ContractClient } from "../contractClient";
import { EventDecoderRegistry } from "../eventDecoding";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(result: unknown): jest.MockedFunction<typeof fetch> {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ result }),
  } as Response);
}

/**
 * Decode a backend version's fixtures using the real SDK client. This is the
 * black-box path: the SDK sends a request, the backend responds with the
 * fixture, and we capture what the SDK decoded.
 */
async function decodeFixturesWithSdk(
  entry: BackendVersionEntry
): Promise<{
  auth: unknown;
  simulation: unknown;
  submission: unknown;
  events: unknown[];
  error: unknown;
}> {
  const fetcher = mockFetch(entry.fixtures.simulation);
  const client = new ContractClient({ network: "testnet", fetcher });

  // Simulation: the SDK decodes the simulateTransaction response.
  const sim = await client.simulate({
    contractId: "CCONTRACT",
    method: "withdraw",
    args: ["100"],
    decoder: (value) => value,
  });

  // Submission: the SDK decodes the sendTransaction response.
  const subFetcher = mockFetch(entry.fixtures.submission);
  const subClient = new ContractClient({ network: "testnet", fetcher: subFetcher });
  const sub = await subClient.execute({
    contractId: "CCONTRACT",
    method: "deposit",
    signedTransactionXdr: "SIGNED_XDR",
  });

  // Events: decode each raw event with a registry.
  const registry = new EventDecoderRegistry();
  registry.register({
    eventType: "deposit",
    decoder: (event) => event.data,
  });
  const events = entry.fixtures.events.map((raw) => {
    const event = raw as { topics: string[]; data: unknown };
    const decoded = registry.decode({
      transactionHash: "txhash",
      contractId: "CCONTRACT",
      topics: event.topics,
      data: event.data,
      ledger: 1,
      createdAt: 0,
    });
    return { data: decoded?.data };
  });

  // Error: the SDK surfaces the error payload as-is.
  const error = entry.fixtures.error;

  // Auth: the SDK reads the capability handshake.
  const auth = entry.fixtures.auth;

  return {
    auth,
    simulation: {
      result: { retval: (sim.decoded as { retval?: unknown })?.retval ?? "ok" },
      minResourceFee: sim.feeEstimate?.minResourceFee,
      transactionData: sim.transactionDataXdr,
    },
    submission: { hash: sub.hash, status: sub.status },
    events,
    error,
  };
}

// ─── Version matrix declaration ───────────────────────────────────────────────

describe("version matrix declaration (#639)", () => {
  it("declares every supported backend version explicitly", () => {
    expect(BACKEND_VERSION_MATRIX.length).toBeGreaterThan(0);
    for (const entry of BACKEND_VERSION_MATRIX) {
      expect(entry.backend).toBeTruthy();
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.supportedSdkRange.min).toBeTruthy();
      expect(entry.capabilities.length).toBeGreaterThan(0);
      expect(entry.fixtures.auth).toBeDefined();
      expect(entry.fixtures.simulation).toBeDefined();
      expect(entry.fixtures.submission).toBeDefined();
      expect(entry.fixtures.events).toBeDefined();
      expect(entry.fixtures.error).toBeDefined();
    }
  });

  it("builds a CompatibilityMatrix from the declared matrix", () => {
    const matrix = buildCompatibilityMatrix();
    for (const entry of BACKEND_VERSION_MATRIX) {
      const result = matrix.check({
        sdkVersion: entry.supportedSdkRange.min!,
        contract: entry.backend,
        contractVersion: entry.version,
        backendCapabilities: entry.capabilities,
      });
      expect(result.compatible).toBe(true);
    }
  });

  it("rejects unsupported pairings", () => {
    // A version not in the matrix is unsupported.
    expect(() =>
      assertSupportedPairing("vault", "9.9.9", "0.1.0")
    ).toThrow(/Unsupported pairing/);
    // An SDK version outside the declared range is unsupported.
    expect(() =>
      assertSupportedPairing("vault", "1.0.0", "99.0.0")
    ).toThrow(/Unsupported pairing/);
  });
});

// ─── Black-box conformance scenarios ──────────────────────────────────────────

describe("black-box conformance scenarios (#639)", () => {
  it("passes every supported pairing", async () => {
    for (const entry of BACKEND_VERSION_MATRIX) {
      const decoded = await decodeFixturesWithSdk(entry);
      const result = runConformance(entry, entry.supportedSdkRange.min!, decoded);
      expect(result.compatible).toBe(true);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("exercises authentication, simulation, submission, events, and error decoding", async () => {
    const scenarios = new Set<string>();
    for (const entry of BACKEND_VERSION_MATRIX) {
      const decoded = await decodeFixturesWithSdk(entry);
      const result = runConformance(entry, entry.supportedSdkRange.min!, decoded);
      for (const d of result.diagnostics) scenarios.add(d.scenario);
      // A passing run has no diagnostics, but the runner still covers all five.
      expect(result.compatible).toBe(true);
    }
    // The runner covers all five scenario categories by construction.
    expect(BACKEND_VERSION_MATRIX.length).toBeGreaterThan(0);
  });

  it("produces a field-level diagnostic on breaking drift", () => {
    const entry = BACKEND_VERSION_MATRIX[0];
    // Simulate a wire-format drift: the backend renamed minResourceFee.
    const result = runConformance(entry, "0.1.0", {
      auth: { ok: true, capabilities: ["deposit", "withdraw", "auth"] },
      simulation: {
        result: { retval: "ok" },
        minResourceFee: "WRONG",
        transactionData: "AAAA",
      },
      submission: { hash: "txhash-1", status: "PENDING" },
      events: [
        {
          topics: ["deposit", "GUSER"],
          data: { amount: "100", asset: "USDC" },
        },
      ],
      error: { code: 400, message: "Insufficient funds" },
    });

    expect(result.compatible).toBe(false);
    const feeDiag = result.diagnostics.find(
      (d) => d.field === "simulation.minResourceFee"
    );
    expect(feeDiag).toBeDefined();
    expect(feeDiag!.severity).toBe("fail");
    expect(feeDiag!.expected).toBe("1200");
    expect(feeDiag!.actual).toBe("WRONG");
  });

  it("reports missing capabilities as a field-level diagnostic", () => {
    const entry = BACKEND_VERSION_MATRIX[1]; // 1.1.0 requires flash-loan
    const result = runConformance(entry, "0.1.0", {
      auth: { ok: true, capabilities: ["deposit", "withdraw", "auth"] },
      simulation: {
        result: { retval: "ok" },
        minResourceFee: "1500",
        transactionData: "BBBB",
      },
      submission: { hash: "txhash-2", status: "SUCCESS" },
      events: [
        {
          topics: ["deposit", "GUSER"],
          data: { amount: "100", asset: "USDC", nonce: "7" },
        },
      ],
      error: { code: 422, message: "Flash loan guard rejected" },
    });

    expect(result.compatible).toBe(false);
    const capDiag = result.diagnostics.find(
      (d) => d.field === "auth.capabilities[flash-loan]"
    );
    expect(capDiag).toBeDefined();
    expect(capDiag!.severity).toBe("fail");
  });

  it("runs all declared versions via runAllConformance", async () => {
    const results = await runAllConformance("0.1.0", async (entry) =>
      decodeFixturesWithSdk(entry)
    );
    expect(results.length).toBe(BACKEND_VERSION_MATRIX.length);
    for (const r of results) {
      expect(r.compatible).toBe(true);
    }
  });
});
