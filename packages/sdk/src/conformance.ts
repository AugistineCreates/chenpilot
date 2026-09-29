/**
 * Black-box SDK ↔ backend conformance testing (#639).
 *
 * Build-time type compatibility does not prove that a published SDK version
 * behaves correctly against a deployed backend version. This module declares a
 * version matrix of supported/unsupported backend releases and runs black-box
 * conformance scenarios (authentication, simulation, submission, events, and
 * error decoding) against representative wire-format fixtures for each version.
 *
 * A breaking wire-format drift produces a {@link ConformanceDiagnostic} that
 * names the exact field that diverged, so integrators can act on it.
 */

import { CompatibilityMatrix, CompatibilityMatrixEntry } from "./compatibility";

// ─── Version matrix ───────────────────────────────────────────────────────────

/**
 * A backend release that the SDK is tested against. Each entry declares the
 * exact contract version and the SDK range that is *supported* for it. Any
 * pairing not present in the matrix is implicitly *unsupported*.
 */
export interface BackendVersionEntry {
  /** Backend / contract name. */
  backend: string;
  /** Deployed backend version. */
  version: string;
  /** SDK versions that are supported against this backend version. */
  supportedSdkRange: { min?: string; max?: string };
  /** Capabilities this backend version advertises. */
  capabilities: string[];
  /**
   * Wire-format fixtures for this backend version. Each scenario is a
   * black-box interaction: the SDK sends a request and the backend responds
   * with this fixture. The conformance runner asserts the SDK decodes it
   * correctly.
   */
  fixtures: BackendFixtures;
}

/** Wire-format fixtures for one backend version. */
export interface BackendFixtures {
  /** Response to an authentication / capability handshake. */
  auth: unknown;
  /** Response to a simulateTransaction call. */
  simulation: unknown;
  /** Response to a sendTransaction call. */
  submission: unknown;
  /** Raw Soroban event payloads the backend emits. */
  events: unknown[];
  /** Error payload the backend returns for a failed call. */
  error: unknown;
}

/**
 * The canonical version matrix. Every supported pairing is declared here;
 * anything absent is unsupported by definition.
 */
export const BACKEND_VERSION_MATRIX: BackendVersionEntry[] = [
  {
    backend: "vault",
    version: "1.0.0",
    supportedSdkRange: { min: "0.1.0", max: "0.9.0" },
    capabilities: ["deposit", "withdraw", "auth"],
    fixtures: {
      auth: { ok: true, capabilities: ["deposit", "withdraw", "auth"] },
      simulation: {
        result: { retval: "ok", auth: [{ address: "GUSER" }] },
        minResourceFee: "1200",
        transactionData: "AAAA",
        warnings: [],
      },
      submission: { hash: "txhash-1", status: "PENDING" },
      events: [
        {
          topics: ["deposit", "GUSER"],
          data: { amount: "100", asset: "USDC" },
        },
      ],
      error: { code: 400, message: "Insufficient funds" },
    },
  },
  {
    backend: "vault",
    version: "1.1.0",
    supportedSdkRange: { min: "0.1.0", max: "0.9.0" },
    capabilities: ["deposit", "withdraw", "auth", "flash-loan"],
    fixtures: {
      auth: {
        ok: true,
        capabilities: ["deposit", "withdraw", "auth", "flash-loan"],
      },
      simulation: {
        result: { retval: "ok", auth: [{ address: "GUSER" }] },
        minResourceFee: "1500",
        transactionData: "BBBB",
        warnings: [{ code: "large_fee", message: "Fee exceeds policy" }],
      },
      submission: { hash: "txhash-2", status: "SUCCESS" },
      events: [
        {
          topics: ["deposit", "GUSER"],
          data: { amount: "100", asset: "USDC", nonce: "7" },
        },
      ],
      error: { code: 422, message: "Flash loan guard rejected" },
    },
  },
  {
    backend: "vault",
    version: "2.0.0",
    supportedSdkRange: { min: "0.1.0", max: "0.9.0" },
    capabilities: ["deposit", "withdraw", "auth", "flash-loan", "recovery"],
    fixtures: {
      auth: {
        ok: true,
        capabilities: ["deposit", "withdraw", "auth", "flash-loan", "recovery"],
      },
      simulation: {
        result: { retval: "ok", auth: [{ address: "GUSER" }] },
        minResourceFee: "2000",
        transactionData: "CCCC",
        warnings: [],
      },
      submission: { hash: "txhash-3", status: "SUCCESS" },
      events: [
        {
          topics: ["deposit", "GUSER"],
          data: { amount: "100", asset: "USDC", nonce: "7", chain: "stellar" },
        },
      ],
      error: { code: 500, message: "Internal error" },
    },
  },
];

// ─── Conformance diagnostics ──────────────────────────────────────────────────

/** Severity of a conformance finding. */
export type ConformanceSeverity = "pass" | "fail";

/** A field-level diagnostic produced when a scenario diverges. */
export interface ConformanceDiagnostic {
  /** Backend name. */
  backend: string;
  /** Backend version under test. */
  version: string;
  /** Scenario that was exercised (auth, simulation, submission, events, error). */
  scenario: string;
  /** Severity — `fail` means the SDK cannot interoperate with this version. */
  severity: ConformanceSeverity;
  /** The exact field that diverged, e.g. `simulation.minResourceFee`. */
  field: string;
  /** Human-readable explanation. */
  message: string;
  /** Expected value (from the fixture). */
  expected?: unknown;
  /** Actual value the SDK produced. */
  actual?: unknown;
}

/** Result of running the full conformance suite against one backend version. */
export interface ConformanceResult {
  /** Backend name. */
  backend: string;
  /** Backend version under test. */
  version: string;
  /** Whether the SDK is compatible with this backend version. */
  compatible: boolean;
  /** Field-level diagnostics (empty when compatible). */
  diagnostics: ConformanceDiagnostic[];
}

// ─── Conformance runner ───────────────────────────────────────────────────────

/**
 * Build a {@link CompatibilityMatrix} from the declared version matrix. This is
 * the single source of truth for supported/unsupported pairings.
 */
export function buildCompatibilityMatrix(): CompatibilityMatrix {
  const entries: CompatibilityMatrixEntry[] = BACKEND_VERSION_MATRIX.map(
    (entry) => ({
      contract: entry.backend,
      contractVersion: entry.version,
      sdkRange: entry.supportedSdkRange,
      requiredCapabilities: entry.capabilities,
    })
  );
  return new CompatibilityMatrix(entries);
}

/**
 * Assert that a backend version is explicitly declared as supported for the
 * given SDK version. Throws when the pairing is absent or out of range.
 */
export function assertSupportedPairing(
  backend: string,
  backendVersion: string,
  sdkVersion: string
): void {
  const matrix = buildCompatibilityMatrix();
  const result = matrix.check({
    sdkVersion,
    contract: backend,
    contractVersion: backendVersion,
    backendCapabilities: [],
  });
  if (!result.compatible) {
    throw new Error(
      `Unsupported pairing: ${backend}@${backendVersion} with SDK ${sdkVersion} — ` +
        result.issues.map((i) => i.message).join("; ")
    );
  }
}

/**
 * Run the black-box conformance scenarios for a backend version against the
 * SDK's decoding logic. Returns field-level diagnostics for any divergence.
 *
 * This is intentionally pure: it does not perform network I/O. Callers supply
 * the decoded values the SDK produced for each scenario, and the runner
 * compares them against the declared fixtures.
 */
export function runConformance(
  entry: BackendVersionEntry,
  sdkVersion: string,
  decoded: {
    auth?: unknown;
    simulation?: unknown;
    submission?: unknown;
    events?: unknown[];
    error?: unknown;
  }
): ConformanceResult {
  const diagnostics: ConformanceDiagnostic[] = [];
  const fail = (
    scenario: string,
    field: string,
    message: string,
    expected?: unknown,
    actual?: unknown
  ) =>
    diagnostics.push({
      backend: entry.backend,
      version: entry.version,
      scenario,
      severity: "fail",
      field,
      message,
      expected,
      actual,
    });

  // 1. Authentication / capability handshake.
  const authFixture = entry.fixtures.auth as Record<string, unknown>;
  const authDecoded = (decoded.auth ?? {}) as Record<string, unknown>;
  if (authFixture.ok !== authDecoded.ok) {
    fail("auth", "auth.ok", "Authentication handshake diverged", authFixture.ok, authDecoded.ok);
  }
  const expectedCaps = (authFixture.capabilities as string[]) ?? [];
  const actualCaps = (authDecoded.capabilities as string[]) ?? [];
  for (const cap of expectedCaps) {
    if (!actualCaps.includes(cap)) {
      fail("auth", `auth.capabilities[${cap}]`, `Missing capability ${cap}`, cap, undefined);
    }
  }

  // 2. Simulation.
  const simFixture = entry.fixtures.simulation as Record<string, unknown>;
  const simDecoded = (decoded.simulation ?? {}) as Record<string, unknown>;
  const simResult = (simFixture.result ?? {}) as Record<string, unknown>;
  const simResultDecoded = (simDecoded.result ?? {}) as Record<string, unknown>;
  if (simResult.retval !== simResultDecoded.retval) {
    fail("simulation", "simulation.result.retval", "Simulation return value diverged", simResult.retval, simResultDecoded.retval);
  }
  if (simFixture.minResourceFee !== simDecoded.minResourceFee) {
    fail("simulation", "simulation.minResourceFee", "Fee estimate diverged", simFixture.minResourceFee, simDecoded.minResourceFee);
  }
  if (simFixture.transactionData !== simDecoded.transactionData) {
    fail("simulation", "simulation.transactionData", "Transaction data diverged", simFixture.transactionData, simDecoded.transactionData);
  }

  // 3. Submission.
  const subFixture = entry.fixtures.submission as Record<string, unknown>;
  const subDecoded = (decoded.submission ?? {}) as Record<string, unknown>;
  if (subFixture.hash !== subDecoded.hash) {
    fail("submission", "submission.hash", "Transaction hash diverged", subFixture.hash, subDecoded.hash);
  }
  if (subFixture.status !== subDecoded.status) {
    fail("submission", "submission.status", "Submission status diverged", subFixture.status, subDecoded.status);
  }

  // 4. Events.
  const eventFixtures = entry.fixtures.events ?? [];
  const eventDecoded = decoded.events ?? [];
  if (eventFixtures.length !== eventDecoded.length) {
    fail("events", "events.length", "Event count diverged", eventFixtures.length, eventDecoded.length);
  } else {
    for (let i = 0; i < eventFixtures.length; i++) {
      const fixture = eventFixtures[i] as Record<string, unknown>;
      const actual = (eventDecoded[i] ?? {}) as Record<string, unknown>;
      const fixtureData = (fixture.data ?? {}) as Record<string, unknown>;
      const actualData = (actual.data ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(fixtureData)) {
        if (fixtureData[key] !== actualData[key]) {
          fail("events", `events[${i}].data.${key}`, `Event field ${key} diverged`, fixtureData[key], actualData[key]);
        }
      }
    }
  }

  // 5. Error decoding.
  const errFixture = entry.fixtures.error as Record<string, unknown>;
  const errDecoded = (decoded.error ?? {}) as Record<string, unknown>;
  if (errFixture.code !== errDecoded.code) {
    fail("error", "error.code", "Error code diverged", errFixture.code, errDecoded.code);
  }
  if (errFixture.message !== errDecoded.message) {
    fail("error", "error.message", "Error message diverged", errFixture.message, errDecoded.message);
  }

  return {
    backend: entry.backend,
    version: entry.version,
    compatible: diagnostics.length === 0,
    diagnostics,
  };
}

/**
 * Run conformance for every declared backend version. Returns one result per
 * version. This is the entry point CI invokes.
 */
export async function runAllConformance(
  sdkVersion: string,
  decodeFor: (entry: BackendVersionEntry) => Promise<{
    auth?: unknown;
    simulation?: unknown;
    submission?: unknown;
    events?: unknown[];
    error?: unknown;
  }>
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  for (const entry of BACKEND_VERSION_MATRIX) {
    results.push(runConformance(entry, sdkVersion, await decodeFor(entry)));
  }
  return results;
}
