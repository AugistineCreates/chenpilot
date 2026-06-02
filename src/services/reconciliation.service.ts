import * as StellarSdk from "@stellar/stellar-sdk";
import { RpcProvider, Contract } from "starknet";
import AppDataSource from "../config/Datasource";
import config from "../config/config";
import logger from "../config/logger";

export type DriftSeverity = "none" | "minor" | "major" | "critical";
export type DriftType =
  | "transaction_missing"
  | "transaction_status_mismatch"
  | "balance_mismatch"
  | "contract_state_mismatch";

export interface DriftItem {
  type: DriftType;
  severity: DriftSeverity;
  entityId: string;
  backendValue: unknown;
  onChainValue: unknown;
  description: string;
  repairAction?: string;
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
}

export interface ReconciliationScope {
  transactions?: boolean;
  balances?: boolean;
  contractState?: boolean;
  walletAddress?: string;
  contractIds?: string[];
  network?: "testnet" | "mainnet";
  lookbackLedgers?: number;
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
    const startedAt = new Date().toISOString();
    const driftItems: DriftItem[] = [];
    let status: ReconciliationReport["status"] = "clean";
    let errorMessage: string | undefined;

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

      status = driftItems.length > 0 ? "drifted" : "clean";
    } catch (err) {
      status = "error";
      errorMessage =
        err instanceof Error ? err.message : "Unknown reconciliation error";
      logger.error("Reconciliation failed", { userId, error: err });
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
    };

    await this.persistReport(report);
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

    try {
      const db = AppDataSource.isInitialized ? AppDataSource : null;
      if (!db) return driftItems;

      // Fetch backend transaction records for this user
      const backendTxs: Array<{
        txHash: string;
        status: string;
        amount: string;
      }> = await db.query(
        `SELECT tx_hash as "txHash", status, amount FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
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
            });
          }
        } catch {
          // Transaction not found on-chain
          driftItems.push({
            type: "transaction_missing",
            severity: "critical",
            entityId: backendTx.txHash,
            backendValue: backendTx.status,
            onChainValue: null,
            description: `Transaction ${backendTx.txHash} exists in DB but not found on-chain`,
            repairAction: `Mark transaction ${backendTx.txHash} as 'not_found' and investigate`,
          });
        }
      }
    } catch (err) {
      logger.warn("Transaction reconciliation partial failure", { err });
    }

    return driftItems;
  }

  /**
   * Compare backend balance records against on-chain wallet balances (StarkNet).
   */
  private async reconcileBalances(
    userId: string,
    walletAddress: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _scope: ReconciliationScope
  ): Promise<DriftItem[]> {
    const driftItems: DriftItem[] = [];

    try {
      const db = AppDataSource.isInitialized ? AppDataSource : null;
      if (!db) return driftItems;

      // Fetch cached balances from DB
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
            });
          }
        } catch (err) {
          logger.warn("Balance check failed for token", {
            token: cached.token,
            err,
          });
        }
      }
    } catch (err) {
      logger.warn("Balance reconciliation partial failure", { err });
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

      const server = new StellarSdk.SorobanRpc.Server(SOROBAN_RPC[network]);

      for (const contractId of contractIds) {
        try {
          // Fetch cached contract state from DB
          const cached: Array<{ state_key: string; state_value: string }> =
            await db.query(
              `SELECT state_key as "state_key", state_value as "state_value" FROM contract_state_snapshots WHERE contract_id = $1 ORDER BY created_at DESC LIMIT 1`,
              [contractId]
            );

          if (!cached.length) continue;

          // Fetch live ledger entries for the contract
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
              repairAction: `Investigate contract ${contractId} expiry and update snapshot`,
            });
            continue;
          }

          const entry = response.entries[0];
          const onChainValue = entry.val.toXDR("base64");
          const backendValue = cached[0].state_value;

          if (onChainValue !== backendValue) {
            driftItems.push({
              type: "contract_state_mismatch",
              severity: "major",
              entityId: contractId,
              backendValue,
              onChainValue,
              description: `Contract ${contractId} state snapshot is stale`,
              repairAction: `Refresh contract state snapshot for ${contractId}`,
            });
          }
        } catch (err) {
          logger.warn("Contract state check failed", { contractId, err });
        }
      }
    } catch (err) {
      logger.warn("Contract state reconciliation partial failure", { err });
    }

    return driftItems;
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
      logger.warn("Failed to persist reconciliation report", { err });
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
      logger.error("Failed to fetch reconciliation reports", { err });
      return [];
    }
  }
}

export const reconciliationService = new ReconciliationService();
