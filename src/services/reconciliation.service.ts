import * as StellarSdk from "@stellar/stellar-sdk";
import { RpcProvider, Contract } from "starknet";
import AppDataSource from "../config/Datasource";
import config from "../config/config";
import logger from "../config/logger";
import { getObservabilityContext } from "../observability";
import { buildRpcServer } from "../services/soroban/sdkAdapter";
import {
  InvariantResult,
  InvariantEvaluationContext,
  InvariantCategory,
  DataAvailability,
  evaluateAllInvariants,
  evaluateInvariantsByCategory,
  summarizeInvariantResults,
  BackendTransactionRecord,
  OnChainTransactionRecord,
  BackendBalanceRecord,
  OnChainBalanceRecord,
  PendingOperationRecord,
} from "./invariantEngine";

export type DriftSeverity = "none" | "minor" | "major" | "critical";
export type DriftType =
  | "transaction_missing"
  | "transaction_status_mismatch"
  | "balance_mismatch"
  | "contract_state_mismatch"
  | "external_activity_unmatched"
  | "external_activity_quarantined";

export interface DriftItem {
  type: DriftType;
  severity: DriftSeverity;
  entityId: string;
  backendValue: unknown;
  onChainValue: unknown;
  description: string;
  repairAction?: string;
  detectedAt: string;
}

export interface InvariantSummary {
  total: number;
  passing: number;
  failing: number;
  indeterminate: number;
  lagExceeded: number;
  byRepairSafety: Record<string, number>;
}

export interface ReconciliationReport {
  id: string;
  userId: string;
  scope: ReconciliationScope;
  startedAt: string;
  completedAt: string;
  driftItems: DriftItem[];
  summary: {
    total: number;
    critical: number;
    major: number;
    minor: number;
    none: number;
  };
  status: "clean" | "drifted" | "error";
  errorMessage?: string;
  /** Invariant evaluation results — populated when scope.invariants is true. */
  invariantResults?: InvariantResult[];
  /** Aggregate invariant summary — populated when scope.invariants is true. */
  invariantSummary?: InvariantSummary;
}

export interface ReconciliationScope {
  transactions?: boolean;
  balances?: boolean;
  contractState?: boolean;
  walletAddress?: string;
  contractIds?: string[];
  network?: "testnet" | "mainnet";
  lookbackLedgers?: number;
  /** When true, evaluate system-level accounting invariants. */
  invariants?: boolean;
  /** Filter invariant evaluation to specific categories. If omitted, all are evaluated. */
  invariantCategories?: InvariantCategory[];
}

const STELLAR_HORIZON: Record<string, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

const SOROBAN_RPC: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

export class ReconciliationService {
  private starkProvider: RpcProvider;

  constructor() {
    this.starkProvider = new RpcProvider({ nodeUrl: config.node_url });
  }

  async reconcile(
    userId: string,
    scope: ReconciliationScope
  ): Promise<ReconciliationReport> {
    const reportId = crypto.randomUUID();
    const context = getObservabilityContext();
    const correlationId = context?.requestId || reportId;
    const startedAt = new Date().toISOString();
    const driftItems: DriftItem[] = [];
    let status: ReconciliationReport["status"] = "clean";
    let errorMessage: string | undefined;
    let invariantResults: InvariantResult[] | undefined;
    let invariantSummary: InvariantSummary | undefined;

    logger.info("Starting reconciliation", { reportId, correlationId, userId, scope });

    try {
      if (scope.transactions) {
        const txDrift = await this.reconcileTransactions(userId, scope);
        driftItems.push(...txDrift);
      }

      if (scope.balances && scope.walletAddress) {
        const balDrift = await this.reconcileBalances(
          userId,
          scope.walletAddress,
          scope
        );
        driftItems.push(...balDrift);
      }

      if (scope.contractState && scope.contractIds?.length) {
        const contractDrift = await this.reconcileContractState(
          scope.contractIds,
          scope
        );
        driftItems.push(...contractDrift);
      }

      if (scope.invariants) {
        const invCtx = await this.buildInvariantContext(userId, scope);
        if (scope.invariantCategories?.length) {
          invariantResults = evaluateInvariantsByCategory(invCtx, scope.invariantCategories);
        } else {
          invariantResults = evaluateAllInvariants(invCtx);
        }
        invariantSummary = summarizeInvariantResults(invariantResults);
        // Promote only evaluated failures (not indeterminate) to drift items
        for (const ir of invariantResults) {
          if (ir.status === "failing") {
            driftItems.push({
              type: "balance_mismatch",
              severity: "major",
              entityId: `invariant:${ir.invariantId}`,
              backendValue: ir.actualValue,
              onChainValue: ir.expectedValue,
              description: `[Invariant ${ir.invariantId}] ${ir.invariantName}: ${ir.attributableDifference}` + (ir.lagExceeded ? " (lag exceeded)" : ""),
              detectedAt: ir.evaluatedAt,
            });
          }
        }
      }

      status = driftItems.length > 0 ? "drifted" : "clean";
    } catch (err) {
      status = "error";
      errorMessage =
        err instanceof Error ? err.message : "Unknown reconciliation error";
      logger.error("Reconciliation failed", { reportId, correlationId, userId, error: err });
    }

    const summary = {
      total: driftItems.length,
      critical: driftItems.filter((d) => d.severity === "critical").length,
      major: driftItems.filter((d) => d.severity === "major").length,
      minor: driftItems.filter((d) => d.severity === "minor").length,
      none: driftItems.filter((d) => d.severity === "none").length,
    };

    const report: ReconciliationReport = {
      id: reportId,
      userId,
      scope,
      startedAt,
      completedAt: new Date().toISOString(),
      driftItems,
      summary,
      status,
      errorMessage,
      invariantResults,
      invariantSummary,
    };

    await this.persistReport(report);
    logger.info("Reconciliation completed", { reportId, correlationId, status, summary });
    return report;
  }

  /**
   * Compare backend transaction records against Stellar Horizon.
   */
  private async reconcileTransactions(
    userId: string,
    scope: ReconciliationScope
  ): Promise<DriftItem[]> {
    const driftItems: DriftItem[] = [];
    const network = scope.network ?? "testnet";
    const lookback = scope.lookbackLedgers ?? 1000;

    try {
      const db = AppDataSource.isInitialized ? AppDataSource : null;
      if (!db) return driftItems;

      const backendTxs: Array<{
        txHash: string;
        status: string;
        amount: string;
      }> = await db.query(
        `SELECT tx_hash as "txHash", status, amount FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [userId]
      );

      if (!backendTxs.length) return driftItems;

      const server = new StellarSdk.Horizon.Server(STELLAR_HORIZON[network]);

      for (const backendTx of backendTxs) {
        try {
          const onChainTx = await server
            .transactions()
            .transaction(backendTx.txHash)
            .call();

          const onChainStatus = onChainTx.successful ? "confirmed" : "failed";
          if (backendTx.status !== onChainStatus) {
            driftItems.push({
              type: "transaction_status_mismatch",
              severity: "major",
              entityId: backendTx.txHash,
              backendValue: backendTx.status,
              onChainValue: onChainStatus,
              description: `Transaction ${backendTx.txHash} has status '${backendTx.status}' in DB but '${onChainStatus}' on-chain`,
              repairAction: `UPDATE transactions SET status = '${onChainStatus}' WHERE tx_hash = '${backendTx.txHash}'`,
              detectedAt: new Date().toISOString(),
            });
          }
        } catch {
          driftItems.push({
            type: "transaction_missing",
            severity: "critical",
            entityId: backendTx.txHash,
            backendValue: backendTx.status,
            onChainValue: null,
            description: `Transaction ${backendTx.txHash} exists in DB but not found on-chain within last ${lookback} ledgers`,
            repairAction: `Mark transaction ${backendTx.txHash} as 'not_found' and investigate`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      logger.warn("Transaction reconciliation partial failure", { userId, err });
    }

    return driftItems;
  }

  /**
   * Compare backend balance records against on-chain wallet balances.
   */
  private async reconcileBalances(
    userId: string,
    walletAddress: string,
    _scope: ReconciliationScope
  ): Promise<DriftItem[]> {
    const driftItems: DriftItem[] = [];

    try {
      const db = AppDataSource.isInitialized ? AppDataSource : null;
      if (!db) return driftItems;

      const cachedBalances: Array<{ token: string; balance: string }> =
        await db.query(
          `SELECT token, balance FROM wallet_balances WHERE user_id = $1`,
          [userId]
        );

      if (!cachedBalances.length) return driftItems;

      for (const cached of cachedBalances) {
        try {
          const contract = new Contract(
            [
              {
                name: "balanceOf",
                type: "function",
                inputs: [{ name: "account", type: "felt" }],
                outputs: [{ name: "balance", type: "Uint256" }],
                stateMutability: "view",
              },
            ],
            cached.token,
            this.starkProvider
          );

          const result = await contract.balanceOf(walletAddress);
          const onChainBalance = (
            Number(result.balance.toString()) /
            10 ** 18
          ).toFixed(6);
          const backendBalance = parseFloat(cached.balance).toFixed(6);

          if (
            Math.abs(parseFloat(onChainBalance) - parseFloat(backendBalance)) >
            0.000001
          ) {
            const diff = Math.abs(
              parseFloat(onChainBalance) - parseFloat(backendBalance)
            );
            const severity: DriftSeverity = diff > 1 ? "major" : "minor";

            driftItems.push({
              type: "balance_mismatch",
              severity,
              entityId: `${userId}:${cached.token}`,
              backendValue: backendBalance,
              onChainValue: onChainBalance,
              description: `Balance for token ${cached.token} differs: DB=${backendBalance}, on-chain=${onChainBalance} (diff=${diff.toFixed(6)})`,
              repairAction: `UPDATE wallet_balances SET balance = '${onChainBalance}' WHERE user_id = '${userId}' AND token = '${cached.token}'`,
              detectedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          logger.warn("Balance check failed for token", { token: cached.token, err });
        }
      }
    } catch (err) {
      logger.warn("Balance reconciliation partial failure", { userId, err });
    }

    return driftItems;
  }

  /**
   * Compare backend contract state snapshots against live Soroban contract state.
   */
  private async reconcileContractState(
    contractIds: string[],
    scope: ReconciliationScope
  ): Promise<DriftItem[]> {
    const driftItems: DriftItem[] = [];
    const network = scope.network ?? "testnet";

    try {
      const db = AppDataSource.isInitialized ? AppDataSource : null;
      if (!db) return driftItems;

      const server = buildRpcServer(SOROBAN_RPC[network]);

      for (const contractId of contractIds) {
        try {
          const cached: Array<{ state_key: string; state_value: string }> =
            await db.query(
              `SELECT state_key as "state_key", state_value as "state_value" FROM contract_state_snapshots WHERE contract_id = $1 ORDER BY created_at DESC LIMIT 1`,
              [contractId]
            );

          if (!cached.length) continue;

          const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(
            new StellarSdk.xdr.LedgerKeyContractData({
              contract: new StellarSdk.Address(contractId).toScAddress(),
              key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
              durability: StellarSdk.xdr.ContractDataDurability.persistent(),
            })
          );

          const response = await server.getLedgerEntries(ledgerKey);

          if (!response.entries?.length) {
            driftItems.push({
              type: "contract_state_mismatch",
              severity: "critical",
              entityId: contractId,
              backendValue: cached[0].state_value,
              onChainValue: null,
              description: `Contract ${contractId} state not found on-chain — contract may be expired or deleted`,
              repairAction: `Investigate contract ${contractId} expiry and refresh snapshot`,
              detectedAt: new Date().toISOString(),
            });
            continue;
          }

          const entry = response.entries[0];
          const onChainValue = entry.liveUntilLedgerSeq ?? null;
          const backendValue = cached[0].state_value;

          if (onChainValue === null) {
            driftItems.push({
              type: "contract_state_mismatch",
              severity: "major",
              entityId: contractId,
              backendValue,
              onChainValue: null,
              description: `Contract ${contractId} ledger entry missing liveUntilLedgerSeq`,
              repairAction: `Refresh contract state snapshot for ${contractId}`,
              detectedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          logger.warn("Contract state check failed", { contractId, err });
        }
      }
    } catch (err) {
      logger.warn("Contract state reconciliation partial failure", { userId: scope.contractIds?.join(","), err });
    }

    return driftItems;
  }

  /**
   * Build the invariant evaluation context from DB and on-chain data.
   *
   * This method aggregates backend records into the typed shapes that
   * the invariant engine expects. It does NOT fabricate data — if a
   * table or column doesn't exist, the corresponding array is empty.
   */
  private async buildInvariantContext(
    userId: string,
    scope: ReconciliationScope,
  ): Promise<InvariantEvaluationContext> {
    const db = AppDataSource.isInitialized ? AppDataSource : null;
    const now = Date.now();

    if (!db) {
      return {
        backendTransactions: [],
        onChainTransactions: [],
        backendBalances: [],
        onChainBalances: [],
        pendingOperations: [],
        dataAvailability: {
          backendTransactions: false,
          onChainTransactions: false,
          backendBalances: false,
          onChainBalances: false,
          pendingOperations: false,
        },
        snapshotTimestampMs: now,
        lastAuthoritativeRefreshMs: now,
        evaluationTimestampMs: now,
      };
    }

    // ── Backend transactions ───────────────────────────────────────────
    let backendTransactions: BackendTransactionRecord[] = [];
    let backendTxsOk = false;
    try {
      const rows: Array<{
        txHash: string;
        status: string;
        amount: string;
        assetCode: string;
        createdAt: string;
      }> = await db.query(
        `SELECT tx_hash as "txHash", status, amount,
                COALESCE(asset_code, 'UNKNOWN') as "assetCode",
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"
         FROM transactions WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 100`,
        [userId],
      );
      backendTransactions = rows.map((r) => ({
        txHash: r.txHash,
        status: r.status,
        amount: r.amount,
        assetCode: r.assetCode,
        createdAtMs: Number(r.createdAt),
      }));
      backendTxsOk = true;
    } catch {
      // Query failed — dataAvailability will reflect this
      logger.warn("Failed to query backend transactions for invariant context", { userId });
    }

    // ── On-chain transactions ──────────────────────────────────────────
    const onChainTransactions: OnChainTransactionRecord[] = [];
    let onChainTxsOk = false;
    if (scope.network) {
      const network = scope.network;
      try {
        const server = new StellarSdk.Horizon.Server(STELLAR_HORIZON[network]);
        if (backendTransactions.length > 0) {
          for (const bt of backendTransactions) {
            try {
              const tx = await server.transactions().transaction(bt.txHash).call();
              onChainTransactions.push({
                txHash: bt.txHash,
                successful: tx.successful,
                ledger: tx.ledger,
              });
            } catch {
              // Not found on-chain — omit from onChainTransactions
            }
          }
        }
        onChainTxsOk = true;
      } catch {
        logger.warn("Horizon unreachable for on-chain transaction query", { network });
      }
    }

    // ── Backend balances ───────────────────────────────────────────────
    let backendBalances: BackendBalanceRecord[] = [];
    let backendBalancesOk = false;
    try {
      const rows: Array<{
        token: string;
        balance: string;
        updated_at: string;
      }> = await db.query(
        `SELECT token, balance,
                COALESCE(EXTRACT(EPOCH FROM updated_at) * 1000, 0) as "updated_at"
         FROM wallet_balances WHERE user_id = $1`,
        [userId],
      );
      backendBalances = rows.map((r) => ({
        assetCode: r.token,
        balance: r.balance,
        lastUpdatedMs: Number(r.updated_at),
      }));
      backendBalancesOk = true;
    } catch {
      logger.warn("Failed to query wallet_balances for invariant context", { userId });
    }

    // ── On-chain balances ──────────────────────────────────────────────
    const onChainBalances: OnChainBalanceRecord[] = [];
    let onChainBalancesOk = false;
    if (scope.walletAddress && backendBalancesOk && backendBalances.length > 0) {
      try {
        for (const bb of backendBalances) {
          try {
            const contract = new Contract(
              [
                {
                  name: "balanceOf",
                  type: "function",
                  inputs: [{ name: "account", type: "felt" }],
                  outputs: [{ name: "balance", type: "Uint256" }],
                  stateMutability: "view",
                },
              ],
              bb.assetCode,
              this.starkProvider,
            );
            const result = await contract.balanceOf(scope.walletAddress);
            const balance = (
              Number(result.balance.toString()) / 10 ** 18
            ).toFixed(6);
            onChainBalances.push({
              assetCode: bb.assetCode,
              balance,
              fetchedAtMs: Date.now(),
            });
          } catch {
            // Individual token query failed
          }
        }
        onChainBalancesOk = true;
      } catch {
        logger.warn("StarkNet provider error during on-chain balance query");
      }
    }

    // ── Pending operations ─────────────────────────────────────────────
    let pendingOperations: PendingOperationRecord[] = [];
    let pendingOpsOk = false;
    try {
      const rows: Array<{
        id: string;
        category: string;
        status: string;
        created_at: string;
      }> = await db.query(
        `SELECT id, category, status,
                EXTRACT(EPOCH FROM created_at) * 1000 as "created_at"
         FROM durable_operation
         WHERE status IN ('pending', 'running')
         ORDER BY created_at DESC LIMIT 200`,
      );
      pendingOperations = rows.map((r) => ({
        id: r.id,
        category: r.category,
        status: r.status,
        createdAtMs: Number(r.created_at),
      }));
      pendingOpsOk = true;
    } catch {
      logger.warn("Failed to query durable_operation for invariant context");
    }

    const dataAvailability: DataAvailability = {
      backendTransactions: backendTxsOk,
      onChainTransactions: onChainTxsOk,
      backendBalances: backendBalancesOk,
      onChainBalances: onChainBalancesOk,
      pendingOperations: pendingOpsOk,
    };

    // Compute the earliest authoritative data refresh time
    const timestamps = [
      ...backendTransactions.map((t) => t.createdAtMs),
      ...backendBalances.map((b) => b.lastUpdatedMs),
      ...onChainBalances.map((b) => b.fetchedAtMs),
      ...onChainTransactions.map(() => now),
    ].filter((t) => t > 0);

    return {
      backendTransactions,
      onChainTransactions,
      backendBalances,
      onChainBalances,
      pendingOperations,
      dataAvailability,
      snapshotTimestampMs: now,
      lastAuthoritativeRefreshMs: timestamps.length > 0 ? Math.max(...timestamps) : now,
      evaluationTimestampMs: now,
    };
  }

  /**
   * Persist reconciliation report to DB.
   */
  private async persistReport(report: ReconciliationReport): Promise<void> {
    try {
      const db = AppDataSource.isInitialized ? AppDataSource : null;
      if (!db) return;

      await db.query(
        `INSERT INTO reconciliation_reports
          (id, user_id, scope, started_at, completed_at, drift_items, summary, status, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          report.id,
          report.userId,
          JSON.stringify(report.scope),
          report.startedAt,
          report.completedAt,
          JSON.stringify(report.driftItems),
          JSON.stringify(report.summary),
          report.status,
          report.errorMessage ?? null,
        ]
      );
    } catch (err) {
      logger.warn("Failed to persist reconciliation report", { reportId: report.id, err });
    }
  }

  /**
   * Fetch historical reconciliation reports for a user.
   */
  async getReports(
    userId: string,
    limit = 10
  ): Promise<ReconciliationReport[]> {
    try {
      const db = AppDataSource.isInitialized ? AppDataSource : null;
      if (!db) return [];

      const rows = await db.query(
        `SELECT id, user_id as "userId", scope, started_at as "startedAt",
                completed_at as "completedAt", drift_items as "driftItems",
                summary, status, error_message as "errorMessage"
         FROM reconciliation_reports
         WHERE user_id = $1
         ORDER BY started_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return rows.map(
        (r: {
          id: string;
          userId: string;
          scope: ReconciliationScope;
          startedAt: string;
          completedAt: string;
          driftItems: DriftItem[];
          summary: ReconciliationReport["summary"];
          status: ReconciliationReport["status"];
          errorMessage?: string;
        }) => ({
          ...r,
          scope: typeof r.scope === "string" ? JSON.parse(r.scope) : r.scope,
          driftItems:
            typeof r.driftItems === "string"
              ? JSON.parse(r.driftItems)
              : r.driftItems,
          summary:
            typeof r.summary === "string" ? JSON.parse(r.summary) : r.summary,
        })
      );
    } catch (err) {
      logger.error("Failed to fetch reconciliation reports", { userId, err });
      return [];
    }
  }
}

export const reconciliationService = new ReconciliationService();