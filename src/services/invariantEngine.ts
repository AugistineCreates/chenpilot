/**
 * Invariant Evaluation Engine
 *
 * Provides structured accounting invariants that detect aggregate-level
 * drift between backend records and on-chain/authoritative state.
 *
 * Each invariant defines:
 *  - authoritative input (what is the source of truth)
 *  - tolerated lag (how stale the data can be)
 *  - repair safety (can we safely auto-repair)
 *  - attributable difference (the minimal delta on breach)
 *
 * IMPORTANT: All invariants are grounded in data that actually exists
 * in the repository. No invariant assumes tables, columns, or payload
 * fields that are not present in the existing schema.
 *
 * Data availability: Each invariant evaluator distinguishes between
 * "data was retrieved successfully and the invariant holds" versus
 * "data could not be retrieved so the invariant cannot be evaluated."
 * A result with dataAvailable=false is NOT evidence of correctness.
 */

// ─── Repair Safety ───────────────────────────────────────────────────────────

/**
 * Classification of how safe an automatic repair is for a given invariant breach.
 *
 * - PROVABLY_SAFE: Correction is deterministic from authoritative data.
 * - CONDITIONALLY_SAFE: Repair only when the exact cause can be proven.
 * - UNSAFE: Ambiguous drift — must never be automatically rewritten.
 */
export type RepairSafety =
  | "PROVABLY_SAFE"
  | "CONDITIONALLY_SAFE"
  | "UNSAFE";

// ─── Data Availability ───────────────────────────────────────────────────────

/**
 * Tracks whether each authoritative data source was successfully queried.
 * When a source fails, invariants depending on it become "indeterminate"
 * rather than vacuously passing.
 */
export interface DataAvailability {
  /** Whether the backend transactions query succeeded. */
  backendTransactions: boolean;
  /** Whether the on-chain transaction query succeeded. */
  onChainTransactions: boolean;
  /** Whether the backend wallet_balances query succeeded. */
  backendBalances: boolean;
  /** Whether the on-chain balance query succeeded. */
  onChainBalances: boolean;
  /** Whether the pending operations query succeeded. */
  pendingOperations: boolean;
}

// ─── Invariant Types ─────────────────────────────────────────────────────────

export type InvariantCategory =
  | "transaction_status"
  | "balance_integrity"
  | "liability_consistency";

/**
 * Explicit evaluation status for each invariant result.
 *
 * - "passing": data was available, invariant evaluated, and it holds.
 * - "failing": data was available, invariant evaluated, and it is breached.
 * - "indeterminate": authoritative data could not be retrieved; the invariant
 *   cannot be evaluated. This is NEVER equivalent to "passing".
 */
export type InvariantStatus = "passing" | "failing" | "indeterminate";

export interface InvariantDefinition {
  id: string;
  name: string;
  description: string;
  category: InvariantCategory;
  /** Human-readable description of the authoritative data source. */
  authoritativeInput: string;
  /** Maximum acceptable age (ms) of data before lag itself is flagged. */
  toleratedLagMs: number;
  /** How safe automatic repair is. */
  repairSafety: RepairSafety;
}

export interface InvariantResult {
  invariantId: string;
  invariantName: string;
  category: InvariantCategory;
  /** Whether the invariant logically holds (true when passing or indeterminate). */
  holds: boolean;
  /** Explicit evaluation status. Use this instead of `holds` alone to determine outcome. */
  status: InvariantStatus;
  /** Whether authoritative data was available to evaluate the invariant.
   *  When false, holds=true means "no data to prove a breach," NOT "invariant holds." */
  dataAvailable: boolean;
  /** What the invariant expected to be true. */
  expectedValue: string;
  /** What was actually observed. */
  actualValue: string;
  /** Minimal numeric or descriptive delta explaining the breach. */
  attributableDifference: string;
  /** Whether lag exceeded tolerated threshold. */
  lagExceeded: boolean;
  /** Specific entities (tx hashes, asset codes, etc.) responsible. */
  driftSources: string[];
  /** Timestamp of evaluation. */
  evaluatedAt: string;
  /** Safety classification for any automatic repair. */
  repairSafety: RepairSafety;
}

export interface SubmissionReconciliationSample {
  submittedCount: number;
  reconciledCount: number;
  sampledAtMs: number;
}

export interface SubmissionReconciliationDivergenceAlert {
  alert: boolean;
  windowMs: number;
  thresholdCount: number;
  consecutiveDivergentSamples: number;
  maxDivergence: number;
  startedAt: string | null;
  endedAt: string | null;
}

export interface InvariantEvaluationContext {
  /** Backend transaction records from DB (`transactions` table). */
  backendTransactions: BackendTransactionRecord[];
  /** On-chain transaction confirmations from Horizon. */
  onChainTransactions: OnChainTransactionRecord[];
  /** Per-asset backend balances from DB (`wallet_balances` table). */
  backendBalances: BackendBalanceRecord[];
  /** Per-asset on-chain balances from StarkNet RPC. */
  onChainBalances: OnChainBalanceRecord[];
  /** Pending operations from DB (`durable_operation` table). */
  pendingOperations: PendingOperationRecord[];
  /** Which authoritative data sources were successfully queried. */
  dataAvailability: DataAvailability;
  /** Timestamp of the data snapshot (ms). */
  snapshotTimestampMs: number;
  /** Timestamp when data was last refreshed from authoritative source. */
  lastAuthoritativeRefreshMs: number;
  /** Evaluation timestamp (ms). */
  evaluationTimestampMs: number;
}

// ─── Data Records ────────────────────────────────────────────────────────────

export interface BackendTransactionRecord {
  txHash: string;
  status: string; // "confirmed" | "pending" | "failed" | ...
  amount: string;
  assetCode: string;
  createdAtMs: number;
}

export interface OnChainTransactionRecord {
  txHash: string;
  successful: boolean;
  ledger: number;
}

export interface BackendBalanceRecord {
  assetCode: string;
  balance: string; // decimal string
  lastUpdatedMs: number;
}

export interface OnChainBalanceRecord {
  assetCode: string;
  balance: string; // decimal string
  fetchedAtMs: number;
}

export interface PendingOperationRecord {
  id: string;
  category: string;
  status: string; // "pending" | "running"
  createdAtMs: number;
}

// ─── Built-in Invariant Definitions ──────────────────────────────────────────

const DEFAULT_LAG_TOLERANCE_MS = 60_000; // 1 minute

/**
 * Durable operations in pending/running state for longer than this
 * are considered stale and worth flagging.
 */
const PENDING_STALE_THRESHOLD_MS = 300_000; // 5 minutes

const DEFAULT_SUBMISSION_RECONCILIATION_DIVERGENCE_WINDOW_MS = 5 * 60_000;

export const INVARIANT_DEFINITIONS: InvariantDefinition[] = [
  {
    id: "TX_COMPLETENESS",
    name: "Transaction Completeness",
    description:
      "Backend transactions should have corresponding on-chain records. " +
      "Missing on-chain records indicate sync failure or stuck operations.",
    category: "transaction_status",
    authoritativeInput: "Stellar Horizon transaction lookup",
    toleratedLagMs: 120_000, // 2 minutes
    repairSafety: "PROVABLY_SAFE",
  },
  {
    id: "ASSET_BALANCE_MATCH",
    name: "Per-Asset Balance Match",
    description:
      "When both backend and on-chain balance data are available for " +
      "an asset, the values should agree. Drift indicates stale or " +
      "corrupt backend cache.",
    category: "balance_integrity",
    authoritativeInput: "On-chain balance query (StarkNet RPC)",
    toleratedLagMs: DEFAULT_LAG_TOLERANCE_MS,
    repairSafety: "CONDITIONALLY_SAFE",
  },
  {
    id: "BALANCE_NON_NEGATIVITY",
    name: "Balance Non-Negativity",
    description:
      "All backend balance records must be non-negative. A negative " +
      "backend balance indicates data corruption.",
    category: "balance_integrity",
    authoritativeInput: "Backend wallet_balances table",
    toleratedLagMs: 0,
    repairSafety: "UNSAFE",
  },
  {
    id: "PENDING_OPS_STALENESS",
    name: "Pending Operation Staleness",
    description:
      "Durable operations in pending/running state longer than the " +
      "staleness threshold indicate stuck operations. " +
      "This is a system health check — it detects operational staleness, " +
      "not accounting correctness. Its breach does not prove balance or " +
      "liability inconsistency.",
    category: "liability_consistency",
    authoritativeInput: "Backend durable_operation table",
    toleratedLagMs: 0,
    repairSafety: "UNSAFE",
  },
  {
    id: "BACKEND_ONCHAIN_COVERAGE",
    name: "Backend-OnChain Coverage",
    description:
      "Every asset tracked in the backend should have a corresponding " +
      "on-chain balance entry, and vice versa. Missing coverage " +
      "indicates incomplete indexing or orphaned records.",
    category: "balance_integrity",
    authoritativeInput: "On-chain balance query (StarkNet RPC)",
    toleratedLagMs: DEFAULT_LAG_TOLERANCE_MS,
    repairSafety: "UNSAFE",
  },
];

// ─── Evaluation Functions ────────────────────────────────────────────────────

function parseAmount(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function formatNumber(n: number): string {
  return n.toFixed(8);
}

function isLagExceeded(
  lastRefreshMs: number,
  evaluationMs: number,
  toleratedLagMs: number,
): boolean {
  return evaluationMs - lastRefreshMs > toleratedLagMs;
}

function indeterminateResult(
  def: InvariantDefinition,
  evaluationTimestampMs: number,
  reason: string,
): InvariantResult {
  return {
    invariantId: def.id,
    invariantName: def.name,
    category: def.category,
    holds: true, // NOT proven — no data to prove a breach
    status: "indeterminate",
    dataAvailable: false,
    expectedValue: reason,
    actualValue: reason,
    attributableDifference: "N/A — data unavailable",
    lagExceeded: false,
    driftSources: [],
    evaluatedAt: new Date(evaluationTimestampMs).toISOString(),
    repairSafety: def.repairSafety,
  };
}

// ─── Per-invariant evaluators ────────────────────────────────────────────────

function evaluateTxCompleteness(
  ctx: InvariantContext,
  def: InvariantDefinition,
): InvariantResult {
  // Require both backend and on-chain data to be available
  if (!ctx.dataAvailability.backendTransactions || !ctx.dataAvailability.onChainTransactions) {
    return indeterminateResult(def, ctx.evaluationTimestampMs,
      "Transaction data unavailable — backend or on-chain query failed");
  }

  const lagExceeded = isLagExceeded(
    ctx.lastAuthoritativeRefreshMs,
    ctx.evaluationTimestampMs,
    def.toleratedLagMs,
  );

  const onChainHashes = new Set(ctx.onChainTransactions.map((tx) => tx.txHash));
  const driftSources: string[] = [];
  let missingCount = 0;
  let statusMismatchCount = 0;

  for (const bt of ctx.backendTransactions) {
    if (!onChainHashes.has(bt.txHash)) {
      driftSources.push(bt.txHash);
      missingCount++;
    }
  }

  const onChainMap = new Map<string, OnChainTransactionRecord>();
  for (const tx of ctx.onChainTransactions) onChainMap.set(tx.txHash, tx);

  for (const bt of ctx.backendTransactions) {
    if (onChainHashes.has(bt.txHash)) {
      const oc = onChainMap.get(bt.txHash)!;
      if (oc.successful !== (bt.status === "confirmed")) {
        statusMismatchCount++;
      }
    }
  }

  const totalIssues = missingCount + statusMismatchCount;
  const holds = totalIssues === 0 && !lagExceeded;

  return {
    invariantId: def.id,
    invariantName: def.name,
    category: def.category,
    holds,
    status: holds ? "passing" : "failing",
    dataAvailable: true,
    expectedValue: ctx.backendTransactions.length > 0
      ? `All ${ctx.backendTransactions.length} backend tx(s) have on-chain records`
      : "No backend transactions to evaluate",
    actualValue: totalIssues > 0
      ? `${missingCount} missing, ${statusMismatchCount} status mismatch`
      : "All transactions complete",
    attributableDifference: totalIssues > 0
      ? `${missingCount} missing + ${statusMismatchCount} status mismatch = ${totalIssues}`
      : "0",
    lagExceeded,
    driftSources,
    evaluatedAt: new Date(ctx.evaluationTimestampMs).toISOString(),
    repairSafety: def.repairSafety,
  };
}

function evaluateAssetBalanceMatch(
  ctx: InvariantContext,
  def: InvariantDefinition,
): InvariantResult {
  // Require on-chain balance data to be available
  if (!ctx.dataAvailability.onChainBalances) {
    return indeterminateResult(def, ctx.evaluationTimestampMs,
      "On-chain balance data unavailable — RPC query failed");
  }

  const lagExceeded = isLagExceeded(
    ctx.lastAuthoritativeRefreshMs,
    ctx.evaluationTimestampMs,
    def.toleratedLagMs,
  );

  const onChainMap = new Map<string, number>();
  for (const ob of ctx.onChainBalances) {
    onChainMap.set(ob.assetCode, parseAmount(ob.balance));
  }

  const driftSources: string[] = [];
  let totalDelta = 0;
  let mismatchedAssets = 0;
  let comparableAssets = 0;

  for (const bb of ctx.backendBalances) {
    const backendAmt = parseAmount(bb.balance);
    const onChainAmt = onChainMap.get(bb.assetCode);
    if (onChainAmt === undefined || !Number.isFinite(backendAmt)) continue;
    comparableAssets++;
    const delta = Math.abs(backendAmt - onChainAmt);
    if (delta > 0.000001) {
      driftSources.push(bb.assetCode);
      mismatchedAssets++;
      totalDelta += delta;
    }
  }

  const holds = mismatchedAssets === 0 && !lagExceeded;

  return {
    invariantId: def.id,
    invariantName: def.name,
    category: def.category,
    holds,
    status: holds ? "passing" : "failing",
    dataAvailable: true,
    expectedValue: comparableAssets > 0
      ? `All ${comparableAssets} comparable asset balance(s) match on-chain`
      : "No assets with both backend and on-chain data to compare",
    actualValue: mismatchedAssets > 0
      ? `${mismatchedAssets} of ${comparableAssets} differ by ${formatNumber(totalDelta)}`
      : `${comparableAssets} asset(s) all match`,
    attributableDifference: mismatchedAssets > 0
      ? `${formatNumber(totalDelta)} total across ${mismatchedAssets} asset(s)`
      : "0",
    lagExceeded,
    driftSources,
    evaluatedAt: new Date(ctx.evaluationTimestampMs).toISOString(),
    repairSafety: def.repairSafety,
  };
}

function evaluateBalanceNonNegativity(
  ctx: InvariantContext,
  def: InvariantDefinition,
): InvariantResult {
  // Require backend balance data to be available
  if (!ctx.dataAvailability.backendBalances) {
    return indeterminateResult(def, ctx.evaluationTimestampMs,
      "Backend balance data unavailable — wallet_balances query failed");
  }

  const driftSources: string[] = [];
  let negativeCount = 0;
  let totalNegativeAmount = 0;

  for (const bb of ctx.backendBalances) {
    const amt = parseAmount(bb.balance);
    if (Number.isFinite(amt) && amt < -0.000001) {
      negativeCount++;
      totalNegativeAmount += Math.abs(amt);
      driftSources.push(bb.assetCode);
    }
  }

  const holds = negativeCount === 0;

  return {
    invariantId: def.id,
    invariantName: def.name,
    category: def.category,
    holds,
    status: holds ? "passing" : "failing",
    dataAvailable: true,
    expectedValue: `All ${ctx.backendBalances.length} backend balance(s) are non-negative`,
    actualValue: negativeCount > 0
      ? `${negativeCount} asset(s) with negative balance totaling ${formatNumber(totalNegativeAmount)}`
      : "All balances non-negative",
    attributableDifference: negativeCount > 0
      ? `${formatNumber(totalNegativeAmount)} negative across ${negativeCount} asset(s)`
      : "0",
    lagExceeded: false,
    driftSources,
    evaluatedAt: new Date(ctx.evaluationTimestampMs).toISOString(),
    repairSafety: def.repairSafety,
  };
}

/**
 * PENDING_OPS_STALENESS: A system health check that detects durable
 * operations stuck in pending/running state beyond the staleness threshold.
 *
 * This is NOT an accounting invariant. It does not prove balance or
 * liability correctness. It detects operational staleness that may
 * require investigation.
 */
function evaluatePendingOpsStaleness(
  ctx: InvariantContext,
  def: InvariantDefinition,
): InvariantResult {
  // Require pending operations data to be available
  if (!ctx.dataAvailability.pendingOperations) {
    return indeterminateResult(def, ctx.evaluationTimestampMs,
      "Pending operations data unavailable — durable_operation query failed");
  }

  const now = ctx.evaluationTimestampMs;
  const driftSources: string[] = [];
  let staleCount = 0;
  let maxAgeMs = 0;

  for (const op of ctx.pendingOperations) {
    if (op.status !== "pending" && op.status !== "running") continue;
    const ageMs = now - op.createdAtMs;
    if (ageMs > PENDING_STALE_THRESHOLD_MS) {
      staleCount++;
      driftSources.push(op.id);
      maxAgeMs = Math.max(maxAgeMs, ageMs);
    }
  }

  const holds = staleCount === 0;
  const maxAgeMinutes = maxAgeMs > 0 ? (maxAgeMs / 60_000).toFixed(1) : "0";

  return {
    invariantId: def.id,
    invariantName: def.name,
    category: def.category,
    holds,
    status: holds ? "passing" : "failing",
    dataAvailable: true,
    expectedValue: `No pending/running operations older than ${PENDING_STALE_THRESHOLD_MS / 60_000} minutes`,
    actualValue: staleCount > 0
      ? `${staleCount} stale operation(s), oldest ${maxAgeMinutes} minutes`
      : "No stale operations",
    attributableDifference: staleCount > 0
      ? `${staleCount} operation(s) stale by up to ${maxAgeMinutes} minutes`
      : "0",
    lagExceeded: false,
    driftSources,
    evaluatedAt: new Date(ctx.evaluationTimestampMs).toISOString(),
    repairSafety: def.repairSafety,
  };
}

function evaluateBackendOnchainCoverage(
  ctx: InvariantContext,
  def: InvariantDefinition,
): InvariantResult {
  // Require on-chain balance data to be available
  if (!ctx.dataAvailability.onChainBalances) {
    return indeterminateResult(def, ctx.evaluationTimestampMs,
      "On-chain balance data unavailable — cannot verify coverage");
  }

  const lagExceeded = isLagExceeded(
    ctx.lastAuthoritativeRefreshMs,
    ctx.evaluationTimestampMs,
    def.toleratedLagMs,
  );

  const backendAssets = new Set(ctx.backendBalances.map((b) => b.assetCode));
  const onChainAssets = new Set(ctx.onChainBalances.map((b) => b.assetCode));

  const missingOnChain: string[] = [];
  const missingBackend: string[] = [];

  for (const asset of backendAssets) {
    if (!onChainAssets.has(asset)) missingOnChain.push(asset);
  }
  for (const asset of onChainAssets) {
    if (!backendAssets.has(asset)) missingBackend.push(asset);
  }

  const totalMissing = missingOnChain.length + missingBackend.length;
  const driftSources = [...missingOnChain, ...missingBackend];
  const holds = totalMissing === 0 && !lagExceeded;

  return {
    invariantId: def.id,
    invariantName: def.name,
    category: def.category,
    holds,
    status: holds ? "passing" : "failing",
    dataAvailable: true,
    expectedValue: backendAssets.size > 0 || onChainAssets.size > 0
      ? `${backendAssets.size} backend and ${onChainAssets.size} on-chain asset(s) should match`
      : "No assets to compare",
    actualValue: totalMissing > 0
      ? `${missingOnChain.length} backend-only, ${missingBackend.length} on-chain-only`
      : "Full coverage",
    attributableDifference: totalMissing > 0
      ? `${totalMissing} asset(s) missing cross-reference`
      : "0",
    lagExceeded,
    driftSources,
    evaluatedAt: new Date(ctx.evaluationTimestampMs).toISOString(),
    repairSafety: def.repairSafety,
  };
}

// ─── Internal typed context ──────────────────────────────────────────────────

type InvariantContext = InvariantEvaluationContext;

// ─── Engine ──────────────────────────────────────────────────────────────────

const EVALUATORS: Record<string, (ctx: InvariantContext, def: InvariantDefinition) => InvariantResult> = {
  TX_COMPLETENESS: evaluateTxCompleteness,
  ASSET_BALANCE_MATCH: evaluateAssetBalanceMatch,
  BALANCE_NON_NEGATIVITY: evaluateBalanceNonNegativity,
  PENDING_OPS_STALENESS: evaluatePendingOpsStaleness,
  BACKEND_ONCHAIN_COVERAGE: evaluateBackendOnchainCoverage,
};

export function evaluateInvariant(
  invariantId: string,
  ctx: InvariantContext,
): InvariantResult {
  const def = INVARIANT_DEFINITIONS.find((d) => d.id === invariantId);
  if (!def) throw new Error(`Unknown invariant: ${invariantId}`);
  const evaluator = EVALUATORS[invariantId];
  if (!evaluator) throw new Error(`No evaluator for invariant: ${invariantId}`);
  return evaluator(ctx, def);
}

export function evaluateAllInvariants(
  ctx: InvariantContext,
): InvariantResult[] {
  return INVARIANT_DEFINITIONS.map((def) => {
    const evaluator = EVALUATORS[def.id];
    if (!evaluator) {
      return {
        invariantId: def.id,
        invariantName: def.name,
        category: def.category,
        holds: false,
        status: "failing" as InvariantStatus,
        dataAvailable: false,
        expectedValue: "N/A",
        actualValue: "No evaluator registered",
        attributableDifference: "Engine misconfiguration",
        lagExceeded: false,
        driftSources: [],
        evaluatedAt: new Date(ctx.evaluationTimestampMs).toISOString(),
        repairSafety: "UNSAFE" as RepairSafety,
      };
    }
    return evaluator(ctx, def);
  });
}

export function evaluateInvariantsByCategory(
  ctx: InvariantContext,
  categories: InvariantCategory[],
): InvariantResult[] {
  const categorySet = new Set(categories);
  return INVARIANT_DEFINITIONS.filter((d) => categorySet.has(d.category)).map(
    (def) => {
      const evaluator = EVALUATORS[def.id];
      if (!evaluator) throw new Error(`No evaluator for invariant: ${def.id}`);
      return evaluator(ctx, def);
    },
  );
}

export function summarizeInvariantResults(
  results: InvariantResult[],
): {
  total: number;
  passing: number;
  failing: number;
  indeterminate: number;
  lagExceeded: number;
  byRepairSafety: Record<RepairSafety, number>;
} {
  const byRepairSafety: Record<RepairSafety, number> = {
    PROVABLY_SAFE: 0,
    CONDITIONALLY_SAFE: 0,
    UNSAFE: 0,
  };

  for (const r of results) {
    if (r.status === "failing") {
      byRepairSafety[r.repairSafety]++;
    }
  }

  return {
    total: results.length,
    passing: results.filter((r) => r.status === "passing").length,
    failing: results.filter((r) => r.status === "failing").length,
    indeterminate: results.filter((r) => r.status === "indeterminate").length,
    lagExceeded: results.filter((r) => r.lagExceeded).length,
    byRepairSafety,
  };
}

export function evaluateSubmissionReconciliationDivergence(
  samples: SubmissionReconciliationSample[],
  options: {
    windowMs?: number;
    thresholdCount?: number;
    nowMs?: number;
  } = {},
): SubmissionReconciliationDivergenceAlert {
  const windowMs =
    options.windowMs ?? DEFAULT_SUBMISSION_RECONCILIATION_DIVERGENCE_WINDOW_MS;
  const thresholdCount = options.thresholdCount ?? 1;
  const nowMs = options.nowMs ?? Date.now();
  const windowStartMs = nowMs - windowMs;

  const windowSamples = samples
    .filter((sample) => sample.sampledAtMs >= windowStartMs && sample.sampledAtMs <= nowMs)
    .sort((a, b) => a.sampledAtMs - b.sampledAtMs);

  let consecutiveDivergentSamples = 0;
  let maxDivergence = 0;
  let startedAtMs: number | null = null;
  let endedAtMs: number | null = null;

  for (const sample of windowSamples) {
    const divergence = Math.max(
      0,
      sample.submittedCount - sample.reconciledCount,
    );
    maxDivergence = Math.max(maxDivergence, divergence);

    if (divergence >= thresholdCount) {
      consecutiveDivergentSamples++;
      startedAtMs ??= sample.sampledAtMs;
      endedAtMs = sample.sampledAtMs;
      continue;
    }

    consecutiveDivergentSamples = 0;
    startedAtMs = null;
    endedAtMs = null;
  }

  const sustained =
    startedAtMs !== null &&
    endedAtMs !== null &&
    endedAtMs - startedAtMs >= windowMs;

  return {
    alert: sustained,
    windowMs,
    thresholdCount,
    consecutiveDivergentSamples,
    maxDivergence,
    startedAt: startedAtMs === null ? null : new Date(startedAtMs).toISOString(),
    endedAt: endedAtMs === null ? null : new Date(endedAtMs).toISOString(),
  };
}
