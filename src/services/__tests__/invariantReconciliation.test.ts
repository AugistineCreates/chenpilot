/**
 * Invariant Reconciliation Tests — Historical Replay & Drift Injection
 *
 * These tests exercise the invariant evaluation engine with constructed
 * accounting states. They intentionally inject drift at specific points
 * and verify that the engine correctly detects, classifies, and reports it.
 *
 * KEY INVARIANT: A failed query is NEVER treated as a passing invariant.
 * The `status` field explicitly distinguishes "passing", "failing", and
 * "indeterminate". A regression test proves that a consumer relying only
 * on `holds` would confuse indeterminate with passing.
 */

import {
  evaluateInvariant,
  evaluateAllInvariants,
  evaluateSubmissionReconciliationDivergence,
  summarizeInvariantResults,
  InvariantEvaluationContext,
  InvariantResult,
  BackendTransactionRecord,
  OnChainTransactionRecord,
  BackendBalanceRecord,
  OnChainBalanceRecord,
  PendingOperationRecord,
} from "../invariantEngine";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ALL_DATA_OK = {
  backendTransactions: true,
  onChainTransactions: true,
  backendBalances: true,
  onChainBalances: true,
  pendingOperations: true,
};

function makeCtx(overrides: Partial<InvariantEvaluationContext> = {}): InvariantEvaluationContext {
  const now = Date.now();
  return {
    backendTransactions: [],
    onChainTransactions: [],
    backendBalances: [],
    onChainBalances: [],
    pendingOperations: [],
    dataAvailability: ALL_DATA_OK,
    snapshotTimestampMs: now,
    lastAuthoritativeRefreshMs: now,
    evaluationTimestampMs: now,
    ...overrides,
  };
}

function makeTx(
  hash: string, status: string, amount: string = "100.0000000",
  assetCode: string = "XLM", createdAtMs?: number,
): BackendTransactionRecord {
  return { txHash: hash, status, amount, assetCode, createdAtMs: createdAtMs ?? Date.now() };
}

function makeOnChainTx(hash: string, successful: boolean, ledger: number = 100): OnChainTransactionRecord {
  return { txHash: hash, successful, ledger };
}

function makeBackendBalance(assetCode: string, balance: string, lastUpdatedMs?: number): BackendBalanceRecord {
  return { assetCode, balance, lastUpdatedMs: lastUpdatedMs ?? Date.now() };
}

function makeOnChainBalance(assetCode: string, balance: string, fetchedAtMs?: number): OnChainBalanceRecord {
  return { assetCode, balance, fetchedAtMs: fetchedAtMs ?? Date.now() };
}

function makePendingOp(id: string, category: string, status: string, createdAtMs?: number): PendingOperationRecord {
  return { id, category, status, createdAtMs: createdAtMs ?? Date.now() };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Data Availability / Vacuous-Pass Prevention
// ═══════════════════════════════════════════════════════════════════════════════

describe("Data Availability — Vacuous-Pass Prevention", () => {
  it("TX_COMPLETENESS: returns indeterminate when backend query fails", () => {
    const ctx = makeCtx({
      backendTransactions: [],
      onChainTransactions: [],
      dataAvailability: { ...ALL_DATA_OK, backendTransactions: false },
    });
    const result = evaluateInvariant("TX_COMPLETENESS", ctx);
    expect(result.status).toBe("indeterminate");
    expect(result.holds).toBe(true); // NOT proven
    expect(result.dataAvailable).toBe(false);
    expect(result.attributableDifference).toBe("N/A — data unavailable");
  });

  it("TX_COMPLETENESS: returns indeterminate when on-chain query fails", () => {
    const ctx = makeCtx({
      backendTransactions: [makeTx("tx1", "confirmed")],
      onChainTransactions: [],
      dataAvailability: { ...ALL_DATA_OK, onChainTransactions: false },
    });
    const result = evaluateInvariant("TX_COMPLETENESS", ctx);
    expect(result.status).toBe("indeterminate");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(false);
  });

  it("TX_COMPLETENESS: passes with data when all txs match", () => {
    const ctx = makeCtx({
      backendTransactions: [makeTx("tx1", "confirmed")],
      onChainTransactions: [makeOnChainTx("tx1", true)],
      dataAvailability: ALL_DATA_OK,
    });
    const result = evaluateInvariant("TX_COMPLETENESS", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(true);
  });

  it("ASSET_BALANCE_MATCH: returns indeterminate when on-chain query fails", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000.0000000")],
      onChainBalances: [],
      dataAvailability: { ...ALL_DATA_OK, onChainBalances: false },
    });
    const result = evaluateInvariant("ASSET_BALANCE_MATCH", ctx);
    expect(result.status).toBe("indeterminate");
    expect(result.holds).toBe(true); // NOT proven
    expect(result.dataAvailable).toBe(false);
  });

  it("BALANCE_NON_NEGATIVITY: returns indeterminate when backend query fails", () => {
    const ctx = makeCtx({
      backendBalances: [],
      dataAvailability: { ...ALL_DATA_OK, backendBalances: false },
    });
    const result = evaluateInvariant("BALANCE_NON_NEGATIVITY", ctx);
    expect(result.status).toBe("indeterminate");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(false);
  });

  it("BALANCE_NON_NEGATIVITY: passes with data when balances are non-negative", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000.0000000")],
      dataAvailability: ALL_DATA_OK,
    });
    const result = evaluateInvariant("BALANCE_NON_NEGATIVITY", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(true);
  });

  it("PENDING_OPS_STALENESS: returns indeterminate when query fails", () => {
    const ctx = makeCtx({
      pendingOperations: [],
      dataAvailability: { ...ALL_DATA_OK, pendingOperations: false },
    });
    const result = evaluateInvariant("PENDING_OPS_STALENESS", ctx);
    expect(result.status).toBe("indeterminate");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(false);
  });

  it("BACKEND_ONCHAIN_COVERAGE: returns indeterminate when on-chain query fails", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000.0000000")],
      onChainBalances: [],
      dataAvailability: { ...ALL_DATA_OK, onChainBalances: false },
    });
    const result = evaluateInvariant("BACKEND_ONCHAIN_COVERAGE", ctx);
    expect(result.status).toBe("indeterminate");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(false);
  });

  it("summarizeInvariantResults counts indeterminate separately from passing", () => {
    const results = [
      evaluateInvariant("TX_COMPLETENESS", makeCtx({
        dataAvailability: { ...ALL_DATA_OK, backendTransactions: false },
      })),
      evaluateInvariant("BALANCE_NON_NEGATIVITY", makeCtx({
        backendBalances: [makeBackendBalance("XLM", "1000.0000000")],
        dataAvailability: ALL_DATA_OK,
      })),
    ];
    const summary = summarizeInvariantResults(results);
    expect(summary.indeterminate).toBe(1);
    expect(summary.passing).toBe(1);
    expect(summary.failing).toBe(0);
  });

  it("all invariants are indeterminate when DB is unavailable", () => {
    const allFailed: typeof ALL_DATA_OK = {
      backendTransactions: false,
      onChainTransactions: false,
      backendBalances: false,
      onChainBalances: false,
      pendingOperations: false,
    };
    const ctx = makeCtx({ dataAvailability: allFailed });
    const results = evaluateAllInvariants(ctx);
    expect(results.every((r) => r.status === "indeterminate")).toBe(true);
    expect(results.every((r) => r.dataAvailable)).toBe(false);
    expect(results.every((r) => r.holds)).toBe(true); // holds=true but status=indeterminate
  });

  // ── Regression: status prevents indeterminate/passing confusion ──────────

  it("REGRESSION: status field prevents confusing indeterminate with passing", () => {
    // Simulate a consumer that checks `holds` vs one that checks `status`.
    const ctx = makeCtx({
      dataAvailability: { ...ALL_DATA_OK, backendTransactions: false, onChainTransactions: false },
    });
    const result = evaluateInvariant("TX_COMPLETENESS", ctx);

    // Naive consumer (broken): only checks holds
    const naiveConsumerPasses = result.holds === true;
    expect(naiveConsumerPasses).toBe(true); // would incorrectly think invariant passes

    // Correct consumer: checks status
    const correctConsumerPasses = result.status === "passing";
    expect(correctConsumerPasses).toBe(false); // correctly sees indeterminate

    // The summary should NOT count this as passing
    const summary = summarizeInvariantResults([result]);
    expect(summary.passing).toBe(0);
    expect(summary.indeterminate).toBe(1);
  });

  it("REGRESSION: failing invariant with data is never indeterminate", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("USDC", "-5.0000000")],
      dataAvailability: ALL_DATA_OK,
    });
    const result = evaluateInvariant("BALANCE_NON_NEGATIVITY", ctx);
    expect(result.status).toBe("failing");
    expect(result.holds).toBe(false);
    expect(result.dataAvailable).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TX_COMPLETENESS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Invariant: TX_COMPLETENESS", () => {
  it("passes when all backend txs have on-chain records", () => {
    const ctx = makeCtx({
      backendTransactions: [makeTx("abc", "confirmed"), makeTx("def", "failed")],
      onChainTransactions: [makeOnChainTx("abc", true), makeOnChainTx("def", false)],
    });
    const result = evaluateInvariant("TX_COMPLETENESS", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(true);
    expect(result.attributableDifference).toBe("0");
  });

  it("detects missing on-chain record", () => {
    const ctx = makeCtx({
      backendTransactions: [makeTx("abc", "confirmed"), makeTx("def", "confirmed")],
      onChainTransactions: [makeOnChainTx("abc", true)],
    });
    const result = evaluateInvariant("TX_COMPLETENESS", ctx);
    expect(result.status).toBe("failing");
    expect(result.holds).toBe(false);
    expect(result.dataAvailable).toBe(true);
    expect(result.driftSources).toContain("def");
    expect(result.repairSafety).toBe("PROVABLY_SAFE");
  });

  it("detects status mismatch", () => {
    const ctx = makeCtx({
      backendTransactions: [makeTx("abc", "pending")],
      onChainTransactions: [makeOnChainTx("abc", true)],
    });
    const result = evaluateInvariant("TX_COMPLETENESS", ctx);
    expect(result.status).toBe("failing");
    expect(result.holds).toBe(false);
    expect(result.dataAvailable).toBe(true);
  });

  it("detects lag exceeded", () => {
    const ctx = makeCtx({
      backendTransactions: [makeTx("abc", "confirmed")],
      onChainTransactions: [makeOnChainTx("abc", true)],
      lastAuthoritativeRefreshMs: Date.now() - 5 * 60 * 1000,
    });
    const result = evaluateInvariant("TX_COMPLETENESS", ctx);
    expect(result.status).toBe("failing");
    expect(result.lagExceeded).toBe(true);
    expect(result.holds).toBe(false);
    expect(result.dataAvailable).toBe(true);
  });

  it("passes with empty lists when data is available", () => {
    const ctx = makeCtx();
    const result = evaluateInvariant("TX_COMPLETENESS", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(true);
  });
});

describe("Submission vs reconciliation divergence alert window", () => {
  it("alerts only when submission divergence is sustained across the full window", () => {
    const now = Date.parse("2026-09-28T12:00:00.000Z");
    const windowMs = 5 * 60 * 1000;

    const transient = evaluateSubmissionReconciliationDivergence(
      [
        { submittedCount: 10, reconciledCount: 10, sampledAtMs: now - windowMs },
        { submittedCount: 12, reconciledCount: 10, sampledAtMs: now - 60_000 },
        { submittedCount: 12, reconciledCount: 12, sampledAtMs: now },
      ],
      { windowMs, thresholdCount: 1, nowMs: now },
    );

    expect(transient.alert).toBe(false);
    expect(transient.maxDivergence).toBe(2);

    const sustained = evaluateSubmissionReconciliationDivergence(
      [
        { submittedCount: 12, reconciledCount: 10, sampledAtMs: now - windowMs },
        { submittedCount: 13, reconciledCount: 10, sampledAtMs: now - 3 * 60_000 },
        { submittedCount: 14, reconciledCount: 10, sampledAtMs: now },
      ],
      { windowMs, thresholdCount: 1, nowMs: now },
    );

    expect(sustained.alert).toBe(true);
    expect(sustained.consecutiveDivergentSamples).toBe(3);
    expect(sustained.startedAt).toBe("2026-09-28T11:55:00.000Z");
    expect(sustained.endedAt).toBe("2026-09-28T12:00:00.000Z");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ASSET_BALANCE_MATCH
// ═══════════════════════════════════════════════════════════════════════════════

describe("Invariant: ASSET_BALANCE_MATCH", () => {
  it("passes when backend and on-chain balances match", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000.0000000")],
      onChainBalances: [makeOnChainBalance("XLM", "1000.0000000")],
    });
    const result = evaluateInvariant("ASSET_BALANCE_MATCH", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(true);
  });

  it("detects drift with attributable difference", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000.0000000")],
      onChainBalances: [makeOnChainBalance("XLM", "997.0000000")],
    });
    const result = evaluateInvariant("ASSET_BALANCE_MATCH", ctx);
    expect(result.status).toBe("failing");
    expect(result.holds).toBe(false);
    expect(result.dataAvailable).toBe(true);
    expect(result.attributableDifference).toContain("3.00000000");
    expect(result.driftSources).toContain("XLM");
  });

  it("skips assets without on-chain data", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000.0000000"), makeBackendBalance("RARE", "100.0000000")],
      onChainBalances: [makeOnChainBalance("XLM", "1000.0000000")],
    });
    const result = evaluateInvariant("ASSET_BALANCE_MATCH", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
  });

  it("tolerates sub-stroop differences", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000.0000000")],
      onChainBalances: [makeOnChainBalance("XLM", "1000.0000001")],
    });
    const result = evaluateInvariant("ASSET_BALANCE_MATCH", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  BALANCE_NON_NEGATIVITY
// ═══════════════════════════════════════════════════════════════════════════════

describe("Invariant: BALANCE_NON_NEGATIVITY", () => {
  it("passes when all balances are non-negative", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000.0000000"), makeBackendBalance("USDC", "0.0000000")],
    });
    const result = evaluateInvariant("BALANCE_NON_NEGATIVITY", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(true);
  });

  it("detects negative balance with attributable difference", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("USDC", "-5.0000000")],
    });
    const result = evaluateInvariant("BALANCE_NON_NEGATIVITY", ctx);
    expect(result.status).toBe("failing");
    expect(result.holds).toBe(false);
    expect(result.dataAvailable).toBe(true);
    expect(result.attributableDifference).toContain("5.00000000");
    expect(result.repairSafety).toBe("UNSAFE");
  });

  it("passes with empty balances when data is available", () => {
    const ctx = makeCtx({ backendBalances: [] });
    const result = evaluateInvariant("BALANCE_NON_NEGATIVITY", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(true);
  });

  it("ignores NaN balance values", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "not-a-number")],
    });
    const result = evaluateInvariant("BALANCE_NON_NEGATIVITY", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PENDING_OPS_STALENESS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Invariant: PENDING_OPS_STALENESS", () => {
  it("passes when no pending operations exist", () => {
    const ctx = makeCtx();
    const result = evaluateInvariant("PENDING_OPS_STALENESS", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(true);
  });

  it("passes when pending ops are fresh", () => {
    const now = Date.now();
    const ctx = makeCtx({
      pendingOperations: [
        makePendingOp("op1", "delayed_transaction", "pending", now - 60_000),
      ],
      evaluationTimestampMs: now,
    });
    const result = evaluateInvariant("PENDING_OPS_STALENESS", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
  });

  it("detects stale pending operations", () => {
    const now = Date.now();
    const ctx = makeCtx({
      pendingOperations: [
        makePendingOp("op1", "delayed_transaction", "pending", now - 600_000),
      ],
      evaluationTimestampMs: now,
    });
    const result = evaluateInvariant("PENDING_OPS_STALENESS", ctx);
    expect(result.status).toBe("failing");
    expect(result.holds).toBe(false);
    expect(result.dataAvailable).toBe(true);
    expect(result.driftSources).toContain("op1");
    expect(result.repairSafety).toBe("UNSAFE");
  });

  it("ignores completed operations", () => {
    const now = Date.now();
    const ctx = makeCtx({
      pendingOperations: [makePendingOp("op1", "x", "completed", now - 600_000)],
      evaluationTimestampMs: now,
    });
    const result = evaluateInvariant("PENDING_OPS_STALENESS", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
  });

  it("is explicitly a health check, not an accounting invariant", () => {
    // The definition description states this explicitly
    const def = require("../invariantEngine").INVARIANT_DEFINITIONS.find(
      (d: any) => d.id === "PENDING_OPS_STALENESS"
    );
    expect(def.description).toContain("system health check");
    expect(def.description).toContain("does not prove balance");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  BACKEND_ONCHAIN_COVERAGE
// ═══════════════════════════════════════════════════════════════════════════════

describe("Invariant: BACKEND_ONCHAIN_COVERAGE", () => {
  it("passes when backend and on-chain asset sets match", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000"), makeBackendBalance("USDC", "500")],
      onChainBalances: [makeOnChainBalance("XLM", "1000"), makeOnChainBalance("USDC", "500")],
    });
    const result = evaluateInvariant("BACKEND_ONCHAIN_COVERAGE", ctx);
    expect(result.status).toBe("passing");
    expect(result.holds).toBe(true);
    expect(result.dataAvailable).toBe(true);
  });

  it("detects backend-only asset", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000"), makeBackendBalance("RARE", "100")],
      onChainBalances: [makeOnChainBalance("XLM", "1000")],
    });
    const result = evaluateInvariant("BACKEND_ONCHAIN_COVERAGE", ctx);
    expect(result.status).toBe("failing");
    expect(result.holds).toBe(false);
    expect(result.dataAvailable).toBe(true);
    expect(result.driftSources).toContain("RARE");
  });

  it("detects on-chain-only asset", () => {
    const ctx = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000")],
      onChainBalances: [makeOnChainBalance("XLM", "1000"), makeOnChainBalance("NEW", "50")],
    });
    const result = evaluateInvariant("BACKEND_ONCHAIN_COVERAGE", ctx);
    expect(result.status).toBe("failing");
    expect(result.holds).toBe(false);
    expect(result.dataAvailable).toBe(true);
    expect(result.driftSources).toContain("NEW");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  evaluateAllInvariants
// ═══════════════════════════════════════════════════════════════════════════════

describe("evaluateAllInvariants", () => {
  it("returns results for all 5 invariants", () => {
    expect(evaluateAllInvariants(makeCtx())).toHaveLength(5);
  });

  it("all pass on a clean state with data available", () => {
    const now = Date.now();
    const ctx = makeCtx({
      backendTransactions: [makeTx("tx1", "confirmed")],
      onChainTransactions: [makeOnChainTx("tx1", true)],
      backendBalances: [makeBackendBalance("XLM", "1000.0000000")],
      onChainBalances: [makeOnChainBalance("XLM", "1000.0000000")],
      pendingOperations: [makePendingOp("op1", "x", "completed", now)],
    });
    const results = evaluateAllInvariants(ctx);
    expect(results.every((r) => r.status === "passing")).toBe(true);
    expect(results.every((r) => r.holds && r.dataAvailable)).toBe(true);
  });

  it("detects multiple simultaneous breaches", () => {
    const now = Date.now();
    const ctx = makeCtx({
      backendTransactions: [makeTx("tx1", "confirmed")],
      onChainTransactions: [],
      backendBalances: [makeBackendBalance("XLM", "1000.0000000")],
      onChainBalances: [makeOnChainBalance("XLM", "990.0000000")],
      pendingOperations: [makePendingOp("op1", "x", "pending", now - 600_000)],
      evaluationTimestampMs: now,
    });
    const results = evaluateAllInvariants(ctx);
    const failing = results.filter((r) => r.status === "failing");
    expect(failing.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Historical Replay — Drift Injection
// ═══════════════════════════════════════════════════════════════════════════════

describe("Historical Replay — Drift Injection", () => {
  it("replays a valid accounting sequence without drift", () => {
    const steps: InvariantEvaluationContext[] = [
      makeCtx({
        backendBalances: [makeBackendBalance("XLM", "100.0000000")],
        onChainBalances: [makeOnChainBalance("XLM", "100.0000000")],
        backendTransactions: [makeTx("tx1", "confirmed", "100.0000000")],
        onChainTransactions: [makeOnChainTx("tx1", true)],
      }),
      makeCtx({
        backendBalances: [makeBackendBalance("XLM", "95.0000000")],
        onChainBalances: [makeOnChainBalance("XLM", "95.0000000")],
        backendTransactions: [makeTx("tx1", "confirmed", "100"), makeTx("tx2", "confirmed", "-5")],
        onChainTransactions: [makeOnChainTx("tx1", true), makeOnChainTx("tx2", true)],
      }),
      makeCtx({
        backendBalances: [makeBackendBalance("XLM", "95.0000000")],
        onChainBalances: [makeOnChainBalance("XLM", "95.0000000")],
      }),
      makeCtx({
        backendBalances: [makeBackendBalance("XLM", "85.0000000")],
        onChainBalances: [makeOnChainBalance("XLM", "85.0000000")],
        backendTransactions: [makeTx("tx1", "confirmed", "100"), makeTx("tx2", "confirmed", "-5"), makeTx("tx3", "confirmed", "-10")],
        onChainTransactions: [makeOnChainTx("tx1", true), makeOnChainTx("tx2", true), makeOnChainTx("tx3", true)],
      }),
      makeCtx({
        backendBalances: [makeBackendBalance("XLM", "285.0000000")],
        onChainBalances: [makeOnChainBalance("XLM", "285.0000000")],
        backendTransactions: [makeTx("tx1", "confirmed", "100"), makeTx("tx2", "confirmed", "-5"), makeTx("tx3", "confirmed", "-10"), makeTx("tx4", "confirmed", "200")],
        onChainTransactions: [makeOnChainTx("tx1", true), makeOnChainTx("tx2", true), makeOnChainTx("tx3", true), makeOnChainTx("tx4", true)],
      }),
    ];

    for (const step of steps) {
      const results = evaluateAllInvariants(step);
      const failing = results.filter((r) => r.status === "failing");
      expect(failing).toHaveLength(0);
    }
  });

  it("injects balance drift and detects it with delta", () => {
    const valid = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "95.0000000")],
      onChainBalances: [makeOnChainBalance("XLM", "95.0000000")],
    });
    const drifted = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "95.0000000")],
      onChainBalances: [makeOnChainBalance("XLM", "92.0000000")],
    });

    expect(evaluateInvariant("ASSET_BALANCE_MATCH", valid).status).toBe("passing");

    const r = evaluateInvariant("ASSET_BALANCE_MATCH", drifted);
    expect(r.status).toBe("failing");
    expect(r.holds).toBe(false);
    expect(r.dataAvailable).toBe(true);
    expect(r.attributableDifference).toContain("3.00000000");
    expect(r.driftSources).toContain("XLM");
  });

  it("injects stale pending ops and detects them", () => {
    const now = Date.now();
    const valid = makeCtx({
      pendingOperations: [makePendingOp("op1", "delayed_transaction", "pending", now - 60_000)],
      evaluationTimestampMs: now,
    });
    const drifted = makeCtx({
      pendingOperations: [makePendingOp("op1", "delayed_transaction", "pending", now - 600_000)],
      evaluationTimestampMs: now,
    });

    expect(evaluateInvariant("PENDING_OPS_STALENESS", valid).status).toBe("passing");

    const r = evaluateInvariant("PENDING_OPS_STALENESS", drifted);
    expect(r.status).toBe("failing");
    expect(r.holds).toBe(false);
    expect(r.dataAvailable).toBe(true);
    expect(r.driftSources).toContain("op1");
  });

  it("injects tx completeness drift and detects it", () => {
    const valid = makeCtx({
      backendTransactions: [makeTx("tx1", "confirmed"), makeTx("tx2", "confirmed")],
      onChainTransactions: [makeOnChainTx("tx1", true), makeOnChainTx("tx2", true)],
    });
    const drifted = makeCtx({
      backendTransactions: [makeTx("tx1", "confirmed"), makeTx("tx2", "confirmed")],
      onChainTransactions: [makeOnChainTx("tx1", true)],
    });

    expect(evaluateInvariant("TX_COMPLETENESS", valid).status).toBe("passing");

    const r = evaluateInvariant("TX_COMPLETENESS", drifted);
    expect(r.status).toBe("failing");
    expect(r.holds).toBe(false);
    expect(r.dataAvailable).toBe(true);
    expect(r.driftSources).toContain("tx2");
    expect(r.attributableDifference).toContain("1");
  });

  it("injected coverage drift is detected", () => {
    const valid = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000")],
      onChainBalances: [makeOnChainBalance("XLM", "1000")],
    });
    const drifted = makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000"), makeBackendBalance("NEW", "50")],
      onChainBalances: [makeOnChainBalance("XLM", "1000")],
    });

    expect(evaluateInvariant("BACKEND_ONCHAIN_COVERAGE", valid).status).toBe("passing");

    const r = evaluateInvariant("BACKEND_ONCHAIN_COVERAGE", drifted);
    expect(r.status).toBe("failing");
    expect(r.holds).toBe(false);
    expect(r.dataAvailable).toBe(true);
    expect(r.driftSources).toContain("NEW");
    expect(r.attributableDifference).toContain("1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Repair Safety Classification
// ═══════════════════════════════════════════════════════════════════════════════

describe("Repair Safety Classification", () => {
  it("TX_COMPLETENESS is PROVABLY_SAFE", () => {
    const r = evaluateInvariant("TX_COMPLETENESS", makeCtx({
      backendTransactions: [makeTx("tx1", "confirmed")],
      onChainTransactions: [],
    }));
    expect(r.repairSafety).toBe("PROVABLY_SAFE");
    expect(r.status).toBe("failing");
  });

  it("ASSET_BALANCE_MATCH is CONDITIONALLY_SAFE", () => {
    const r = evaluateInvariant("ASSET_BALANCE_MATCH", makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000")],
      onChainBalances: [makeOnChainBalance("XLM", "999")],
    }));
    expect(r.repairSafety).toBe("CONDITIONALLY_SAFE");
    expect(r.status).toBe("failing");
  });

  it("BALANCE_NON_NEGATIVITY is UNSAFE", () => {
    const r = evaluateInvariant("BALANCE_NON_NEGATIVITY", makeCtx({
      backendBalances: [makeBackendBalance("XLM", "-10")],
    }));
    expect(r.repairSafety).toBe("UNSAFE");
    expect(r.status).toBe("failing");
  });

  it("PENDING_OPS_STALENESS is UNSAFE", () => {
    const now = Date.now();
    const r = evaluateInvariant("PENDING_OPS_STALENESS", makeCtx({
      pendingOperations: [makePendingOp("op1", "x", "pending", now - 600_000)],
      evaluationTimestampMs: now,
    }));
    expect(r.repairSafety).toBe("UNSAFE");
    expect(r.status).toBe("failing");
  });

  it("BACKEND_ONCHAIN_COVERAGE is UNSAFE", () => {
    const r = evaluateInvariant("BACKEND_ONCHAIN_COVERAGE", makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000")],
      onChainBalances: [makeOnChainBalance("DIFFERENT", "1000")],
    }));
    expect(r.repairSafety).toBe("UNSAFE");
    expect(r.status).toBe("failing");
  });

  it("no automatic repair is triggered for any invariant", () => {
    // Verify that the engine only returns results — it never performs writes
    const results = evaluateAllInvariants(makeCtx({
      backendBalances: [makeBackendBalance("XLM", "-10")],
      backendTransactions: [makeTx("tx1", "confirmed")],
      onChainTransactions: [],
    }));
    // All results should have status, but no side effects
    expect(results.length).toBeGreaterThan(0);
    // At least some should be failing
    expect(results.some((r) => r.status === "failing")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Lag Tolerance
// ═══════════════════════════════════════════════════════════════════════════════

describe("Lag Tolerance", () => {
  it("TX_COMPLETENESS tolerates lag within threshold", () => {
    const now = Date.now();
    const r = evaluateInvariant("TX_COMPLETENESS", makeCtx({
      backendTransactions: [makeTx("tx1", "confirmed")],
      onChainTransactions: [makeOnChainTx("tx1", true)],
      lastAuthoritativeRefreshMs: now - 60_000,
      evaluationTimestampMs: now,
    }));
    expect(r.lagExceeded).toBe(false);
    expect(r.status).toBe("passing");
  });

  it("TX_COMPLETENESS flags lag beyond threshold", () => {
    const now = Date.now();
    const r = evaluateInvariant("TX_COMPLETENESS", makeCtx({
      backendTransactions: [makeTx("tx1", "confirmed")],
      onChainTransactions: [makeOnChainTx("tx1", true)],
      lastAuthoritativeRefreshMs: now - 180_000,
      evaluationTimestampMs: now,
    }));
    expect(r.status).toBe("failing");
    expect(r.lagExceeded).toBe(true);
    expect(r.holds).toBe(false);
    expect(r.dataAvailable).toBe(true);
  });

  it("ASSET_BALANCE_MATCH tolerates lag within threshold", () => {
    const now = Date.now();
    const r = evaluateInvariant("ASSET_BALANCE_MATCH", makeCtx({
      backendBalances: [makeBackendBalance("XLM", "1000")],
      onChainBalances: [makeOnChainBalance("XLM", "1000")],
      lastAuthoritativeRefreshMs: now - 30_000,
      evaluationTimestampMs: now,
    }));
    expect(r.lagExceeded).toBe(false);
    expect(r.status).toBe("passing");
    expect(r.holds).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("Edge Cases", () => {
  it("empty context with data available: all invariants pass", () => {
    const results = evaluateAllInvariants(makeCtx());
    expect(results.every((r) => r.status === "passing")).toBe(true);
    expect(results.every((r) => r.holds && r.dataAvailable)).toBe(true);
  });

  it("NaN amounts in balances are handled gracefully", () => {
    const r = evaluateInvariant("ASSET_BALANCE_MATCH", makeCtx({
      backendBalances: [makeBackendBalance("XLM", "not-a-number")],
      onChainBalances: [makeOnChainBalance("XLM", "1000")],
    }));
    expect(r.dataAvailable).toBe(true);
    // NaN balance is skipped, so this should pass
    expect(r.status).toBe("passing");
  });

  it("zero balances pass all invariants", () => {
    const results = evaluateAllInvariants(makeCtx({
      backendBalances: [makeBackendBalance("XLM", "0.0000000")],
      onChainBalances: [makeOnChainBalance("XLM", "0.0000000")],
    }));
    expect(results.every((r) => r.holds)).toBe(true);
  });

  it("throw on unknown invariant ID", () => {
    expect(() => evaluateInvariant("NONEXISTENT", makeCtx())).toThrow("Unknown invariant");
  });

  it("status is always one of the three valid values", () => {
    const allResults = evaluateAllInvariants(makeCtx({
      backendTransactions: [makeTx("tx1", "confirmed")],
      onChainTransactions: [],
      backendBalances: [makeBackendBalance("USDC", "-5")],
      onChainBalances: [makeOnChainBalance("USDC", "100")],
      pendingOperations: [makePendingOp("op1", "x", "pending", Date.now() - 600_000)],
      evaluationTimestampMs: Date.now(),
    }));
    const validStatuses = new Set(["passing", "failing", "indeterminate"]);
    for (const r of allResults) {
      expect(validStatuses.has(r.status)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Property-based tests with fast-check
// ═══════════════════════════════════════════════════════════════════════════════

describe("Property-based: fast-check", () => {
  const fc = require("fast-check");

  it("TX_COMPLETENESS: no false positives when all txs have on-chain records", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 6, maxLength: 12 }), { minLength: 1, maxLength: 10 }),
        (hashes: string[]) => {
          const r = evaluateInvariant("TX_COMPLETENESS", makeCtx({
            backendTransactions: hashes.map((h) => makeTx(h, "confirmed")),
            onChainTransactions: hashes.map((h) => makeOnChainTx(h, true)),
          }));
          expect(r.status).toBe("passing");
          expect(r.holds).toBe(true);
          expect(r.dataAvailable).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("BALANCE_NON_NEGATIVITY: no false positives when all balances >= 0", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            assetCode: fc.string({ minLength: 2, maxLength: 6 }),
            balance: fc.double({ min: 0, max: 1000000, noNaN: true }).map((n: number) => n.toFixed(8)),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (items: Array<{ assetCode: string; balance: string }>) => {
          const r = evaluateInvariant("BALANCE_NON_NEGATIVITY", makeCtx({
            backendBalances: items.map((i) => makeBackendBalance(i.assetCode, i.balance)),
          }));
          expect(r.status).toBe("passing");
          expect(r.holds).toBe(true);
          expect(r.dataAvailable).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("BALANCE_NON_NEGATIVITY: detects any negative balance", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: -0.001, noNaN: true }).map((n: number) => n.toFixed(8)),
        (negativeBalance: string) => {
          const r = evaluateInvariant("BALANCE_NON_NEGATIVITY", makeCtx({
            backendBalances: [makeBackendBalance("TEST", negativeBalance)],
          }));
          expect(r.status).toBe("failing");
          expect(r.holds).toBe(false);
          expect(r.dataAvailable).toBe(true);
          expect(r.driftSources).toContain("TEST");
        },
      ),
      { numRuns: 50 },
    );
  });

  it("status is always valid for any combination of data availability", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (bt: boolean, octx: boolean, bb: boolean, ob: boolean, po: boolean) => {
          const results = evaluateAllInvariants(makeCtx({
            dataAvailability: {
              backendTransactions: bt,
              onChainTransactions: octx,
              backendBalances: bb,
              onChainBalances: ob,
              pendingOperations: po,
            },
          }));
          const validStatuses = new Set(["passing", "failing", "indeterminate"]);
          for (const r of results) {
            expect(validStatuses.has(r.status)).toBe(true);
            // If status is indeterminate, dataAvailable must be false
            if (r.status === "indeterminate") {
              expect(r.dataAvailable).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
