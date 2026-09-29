import crypto from "node:crypto";
import logger from "../config/logger";
import { DriftItem, DriftSeverity } from "./reconciliation.service";
import {
  OperatorActor,
  ReconciliationCase,
  ReconciliationWorkspaceService,
} from "./reconciliationWorkspace.service";

/**
 * Supported external wallet activity ingestion sources.
 */
export type WalletHistorySource =
  | "horizon"
  | "starknet_rpc"
  | "external_export"
  | "manual_batch"
  | "indexer";

export type NetworkType = "mainnet" | "testnet";

export type ActivityStatus = "confirmed" | "failed";

export type ReconciliationLinkStatus =
  | "unmatched"
  | "matched"
  | "quarantined"
  | "dismissed";

export type QuarantineReason =
  | "MULTIPLE_CANDIDATE_MATCHES"
  | "AMBIGUOUS_UNHASHED_CANDIDATE"
  | "AMOUNT_MISMATCH"
  | "ASSET_MISMATCH"
  | "PARTICIPANT_MISMATCH"
  | "STATUS_CONFLICT";

/**
 * Audit provenance record capturing origin metadata and cryptographic payload checksum.
 */
export interface ImportProvenance {
  importId: string;
  source: WalletHistorySource;
  importedAt: Date;
  importedBy: string;
  network: NetworkType;
  rawPayloadChecksum: string;
  metadata?: Record<string, unknown>;
}

/**
 * Raw external transaction input from wallet history, Horizon, RPC or CSV.
 */
export interface RawExternalTransaction {
  txHash: string;
  operationIndex?: number;
  sourceAddress: string;
  targetAddress?: string;
  amount: string | number;
  asset?: string;
  timestamp?: string | number | Date;
  status?: string;
  memo?: string;
  operationType?: string;
  chainId?: string;
  extra?: Record<string, unknown>;
}

/**
 * Fully normalized external transaction representation ready for deduplication and reconciliation.
 */
export interface NormalizedExternalActivity {
  chainIdentity: string;
  network: NetworkType;
  chainId: string;
  txHash: string;
  operationIndex: number;
  sourceAddress: string;
  targetAddress: string;
  amount: string;
  asset: string;
  timestamp: Date;
  status: ActivityStatus;
  memo?: string;
  operationType: string;
  provenance: ImportProvenance;
  linkStatus: ReconciliationLinkStatus;
  linkedInternalRecordId?: string;
  quarantineReason?: QuarantineReason;
  quarantineDetails?: Record<string, unknown>;
  lastReconciledAt?: Date;
}

/**
 * Internal Chen Pilot transaction record to reconcile against.
 */
export interface InternalTransactionRecord {
  id: string;
  txHash?: string;
  userId: string;
  walletAddress?: string;
  amount: string;
  asset: string;
  status: string;
  sourceAddress?: string;
  targetAddress?: string;
  createdAt: Date;
}

/**
 * Configuration options for external wallet activity ingestion and reconciliation.
 */
export interface IngestOptions {
  source: WalletHistorySource;
  network: NetworkType;
  chainId?: string;
  importedBy: string;
  rawTransactions: RawExternalTransaction[];
  internalRecords?: InternalTransactionRecord[];
  timeToleranceMs?: number;
  amountToleranceEpsilon?: number;
  importId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Itemized ingestion and reconciliation batch result.
 */
export interface ImportBatchResult {
  importId: string;
  totalIngested: number;
  newlyImported: number;
  deduplicated: number;
  matched: number;
  quarantined: number;
  unmatched: number;
  errors: Array<{
    itemIndex: number;
    error: string;
    rawItem: unknown;
  }>;
  activities: NormalizedExternalActivity[];
}

/**
 * Notification payload emitted for quarantined or notable reconciliation events.
 */
export interface ExternalReconciliationNotification {
  type: "quarantine_alert" | "unmatched_external_activity";
  chainIdentity: string;
  txHash: string;
  amount: string;
  asset: string;
  quarantineReason?: QuarantineReason;
  importedBy: string;
  occurredAt: Date;
}

export type ReconciliationNotificationHandler = (
  notification: ExternalReconciliationNotification
) => void | Promise<void>;

/**
 * Service for ingesting external wallet activity, enforcing provenance, stable deduplication,
 * ambiguous match quarantining, and idempotent reconciliation against internal records.
 */
export class ExternalWalletReconciliationService {
  private activities = new Map<string, NormalizedExternalActivity>();
  private notificationHandlers: ReconciliationNotificationHandler[] = [];

  /**
   * Register a notification handler for alerts.
   */
  public onNotification(handler: ReconciliationNotificationHandler): void {
    this.notificationHandlers.push(handler);
  }

  /**
   * Derive a stable, deterministic chain identity across networks and multi-op transactions.
   */
  public buildChainIdentity(
    network: NetworkType,
    chainId: string,
    txHash: string,
    operationIndex: number = 0
  ): string {
    const cleanHash = txHash.trim().toLowerCase();
    const cleanChainId = (chainId || "stellar").trim().toLowerCase();
    return `${network}:${cleanChainId}:${cleanHash}:${operationIndex}`;
  }

  /**
   * Ingest and normalize wallet-history sources, deduplicating via stable chain identities
   * and linking matching transactions against internal records.
   */
  public async ingestAndReconcile(
    options: IngestOptions
  ): Promise<ImportBatchResult> {
    const importId = options.importId || crypto.randomUUID();
    const timeToleranceMs = options.timeToleranceMs ?? 10 * 60 * 1000; // 10 minutes
    const amountEpsilon = options.amountToleranceEpsilon ?? 1e-6;
    const chainId = options.chainId || (options.network === "mainnet" ? "stellar-mainnet" : "stellar-testnet");

    const result: ImportBatchResult = {
      importId,
      totalIngested: options.rawTransactions.length,
      newlyImported: 0,
      deduplicated: 0,
      matched: 0,
      quarantined: 0,
      unmatched: 0,
      errors: [],
      activities: [],
    };

    const internalRecords = options.internalRecords || [];

    for (let i = 0; i < options.rawTransactions.length; i++) {
      const raw = options.rawTransactions[i];

      // Validate mandatory fields
      if (!raw || typeof raw !== "object") {
        result.errors.push({
          itemIndex: i,
          error: "Transaction record must be a non-null object",
          rawItem: raw,
        });
        continue;
      }

      if (!raw.txHash || typeof raw.txHash !== "string" || !raw.txHash.trim()) {
        result.errors.push({
          itemIndex: i,
          error: "Missing required txHash",
          rawItem: raw,
        });
        continue;
      }

      const parsedAmount = parseFloat(String(raw.amount));
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        result.errors.push({
          itemIndex: i,
          error: `Invalid transaction amount: ${raw.amount}`,
          rawItem: raw,
        });
        continue;
      }

      const opIndex = raw.operationIndex ?? 0;
      const chainIdentity = this.buildChainIdentity(
        options.network,
        raw.chainId || chainId,
        raw.txHash,
        opIndex
      );

      // Provenance calculation
      const payloadString = JSON.stringify(raw);
      const rawPayloadChecksum = crypto
        .createHash("sha256")
        .update(payloadString)
        .digest("hex");

      const provenance: ImportProvenance = {
        importId,
        source: options.source,
        importedAt: new Date(),
        importedBy: options.importedBy,
        network: options.network,
        rawPayloadChecksum,
        metadata: options.metadata,
      };

      const existing = this.activities.get(chainIdentity);

      if (existing) {
        // Idempotent re-import handling
        result.deduplicated++;

        // If previously unmatched, attempt reconciliation linkage if internal records are now present
        if (existing.linkStatus === "unmatched" && internalRecords.length > 0) {
          const matchResult = this.evaluateLinkage(
            existing,
            internalRecords,
            timeToleranceMs,
            amountEpsilon
          );
          existing.linkStatus = matchResult.linkStatus;
          existing.linkedInternalRecordId = matchResult.linkedInternalRecordId;
          existing.quarantineReason = matchResult.quarantineReason;
          existing.quarantineDetails = matchResult.quarantineDetails;
          existing.lastReconciledAt = new Date();
          this.activities.set(chainIdentity, existing);

          if (existing.linkStatus === "matched") result.matched++;
          else if (existing.linkStatus === "quarantined") {
            result.quarantined++;
            this.emitNotification({
              type: "quarantine_alert",
              chainIdentity: existing.chainIdentity,
              txHash: existing.txHash,
              amount: existing.amount,
              asset: existing.asset,
              quarantineReason: existing.quarantineReason,
              importedBy: options.importedBy,
              occurredAt: new Date(),
            });
          } else {
            result.unmatched++;
          }
        } else {
          if (existing.linkStatus === "matched") result.matched++;
          else if (existing.linkStatus === "quarantined") result.quarantined++;
          else result.unmatched++;
        }

        result.activities.push(this.cloneActivity(existing));
        continue;
      }

      // New activity normalization
      const normalizedStatus: ActivityStatus =
        String(raw.status).toLowerCase() === "failed" ? "failed" : "confirmed";

      const normalizedTimestamp = raw.timestamp
        ? new Date(raw.timestamp)
        : new Date();

      const normalized: NormalizedExternalActivity = {
        chainIdentity,
        network: options.network,
        chainId: raw.chainId || chainId,
        txHash: raw.txHash.trim(),
        operationIndex: opIndex,
        sourceAddress: raw.sourceAddress || "unknown",
        targetAddress: raw.targetAddress || "unknown",
        amount: parsedAmount.toString(),
        asset: (raw.asset || "XLM").trim().toUpperCase(),
        timestamp: isNaN(normalizedTimestamp.getTime())
          ? new Date()
          : normalizedTimestamp,
        status: normalizedStatus,
        memo: raw.memo,
        operationType: raw.operationType || "payment",
        provenance,
        linkStatus: "unmatched",
      };

      // Perform reconciliation linkage
      const matchResult = this.evaluateLinkage(
        normalized,
        internalRecords,
        timeToleranceMs,
        amountEpsilon
      );

      normalized.linkStatus = matchResult.linkStatus;
      normalized.linkedInternalRecordId = matchResult.linkedInternalRecordId;
      normalized.quarantineReason = matchResult.quarantineReason;
      normalized.quarantineDetails = matchResult.quarantineDetails;
      normalized.lastReconciledAt = new Date();

      this.activities.set(chainIdentity, normalized);
      result.newlyImported++;

      if (normalized.linkStatus === "matched") {
        result.matched++;
      } else if (normalized.linkStatus === "quarantined") {
        result.quarantined++;
        this.emitNotification({
          type: "quarantine_alert",
          chainIdentity: normalized.chainIdentity,
          txHash: normalized.txHash,
          amount: normalized.amount,
          asset: normalized.asset,
          quarantineReason: normalized.quarantineReason,
          importedBy: options.importedBy,
          occurredAt: new Date(),
        });
      } else {
        result.unmatched++;
      }

      result.activities.push(this.cloneActivity(normalized));
    }

    logger.info("External wallet activity ingestion completed", {
      importId,
      total: result.totalIngested,
      newlyImported: result.newlyImported,
      deduplicated: result.deduplicated,
      matched: result.matched,
      quarantined: result.quarantined,
      unmatched: result.unmatched,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * Evaluate matching rules between normalized external activity and internal records.
   * Quarantines ambiguous matches or discrepancies.
   */
  private evaluateLinkage(
    activity: NormalizedExternalActivity,
    internalRecords: InternalTransactionRecord[],
    timeToleranceMs: number,
    amountEpsilon: number
  ): {
    linkStatus: ReconciliationLinkStatus;
    linkedInternalRecordId?: string;
    quarantineReason?: QuarantineReason;
    quarantineDetails?: Record<string, unknown>;
  } {
    if (!internalRecords.length) {
      return { linkStatus: "unmatched" };
    }

    const cleanTxHash = activity.txHash.toLowerCase();
    const parsedExtAmount = parseFloat(activity.amount);

    // 1. Direct txHash exact matches
    const exactHashMatches = internalRecords.filter(
      (rec) => rec.txHash && rec.txHash.trim().toLowerCase() === cleanTxHash
    );

    if (exactHashMatches.length === 1) {
      const match = exactHashMatches[0];
      const parsedIntAmount = parseFloat(match.amount);

      // Verify amount consistency
      if (Math.abs(parsedExtAmount - parsedIntAmount) > amountEpsilon) {
        return {
          linkStatus: "quarantined",
          quarantineReason: "AMOUNT_MISMATCH",
          quarantineDetails: {
            internalRecordId: match.id,
            externalAmount: activity.amount,
            internalAmount: match.amount,
            delta: Math.abs(parsedExtAmount - parsedIntAmount),
          },
        };
      }

      // Verify asset consistency
      if (
        match.asset &&
        match.asset.trim().toUpperCase() !== activity.asset.trim().toUpperCase()
      ) {
        return {
          linkStatus: "quarantined",
          quarantineReason: "ASSET_MISMATCH",
          quarantineDetails: {
            internalRecordId: match.id,
            externalAsset: activity.asset,
            internalAsset: match.asset,
          },
        };
      }

      // Verify status consistency
      const internalFailed =
        match.status.toLowerCase() === "failed" ||
        match.status.toLowerCase() === "cancelled";
      const externalFailed = activity.status === "failed";
      if (internalFailed !== externalFailed) {
        return {
          linkStatus: "quarantined",
          quarantineReason: "STATUS_CONFLICT",
          quarantineDetails: {
            internalRecordId: match.id,
            externalStatus: activity.status,
            internalStatus: match.status,
          },
        };
      }

      // Verify participant consistency if specified
      if (
        (match.sourceAddress &&
          match.sourceAddress.toLowerCase() !== activity.sourceAddress.toLowerCase()) ||
        (match.targetAddress &&
          match.targetAddress.toLowerCase() !== activity.targetAddress.toLowerCase())
      ) {
        return {
          linkStatus: "quarantined",
          quarantineReason: "PARTICIPANT_MISMATCH",
          quarantineDetails: {
            internalRecordId: match.id,
            externalSource: activity.sourceAddress,
            internalSource: match.sourceAddress,
            externalTarget: activity.targetAddress,
            internalTarget: match.targetAddress,
          },
        };
      }

      return {
        linkStatus: "matched",
        linkedInternalRecordId: match.id,
      };
    } else if (exactHashMatches.length > 1) {
      // Multiple internal records claim the exact same txHash
      return {
        linkStatus: "quarantined",
        quarantineReason: "MULTIPLE_CANDIDATE_MATCHES",
        quarantineDetails: {
          candidateInternalIds: exactHashMatches.map((m) => m.id),
          count: exactHashMatches.length,
          explanation: "Multiple internal transaction records mapped to single txHash",
        },
      };
    }

    // 2. Fuzzy / Inexact candidates lookup (by wallet address, amount, asset, within time window)
    const fuzzyCandidates = internalRecords.filter((rec) => {
      // Must match asset
      if (
        rec.asset &&
        rec.asset.trim().toUpperCase() !== activity.asset.trim().toUpperCase()
      ) {
        return false;
      }

      // Must match amount within epsilon
      const parsedIntAmount = parseFloat(rec.amount);
      if (Math.abs(parsedExtAmount - parsedIntAmount) > amountEpsilon) {
        return false;
      }

      // Wallet address check (source, target, or general wallet address)
      const walletMatches =
        (rec.walletAddress &&
          (rec.walletAddress.toLowerCase() === activity.sourceAddress.toLowerCase() ||
            rec.walletAddress.toLowerCase() === activity.targetAddress.toLowerCase())) ||
        (rec.sourceAddress &&
          rec.sourceAddress.toLowerCase() === activity.sourceAddress.toLowerCase()) ||
        (rec.targetAddress &&
          rec.targetAddress.toLowerCase() === activity.targetAddress.toLowerCase());

      if (!walletMatches) {
        return false;
      }

      // Time proximity window check
      if (rec.createdAt) {
        const deltaMs = Math.abs(
          new Date(rec.createdAt).getTime() - activity.timestamp.getTime()
        );
        if (deltaMs > timeToleranceMs) {
          return false;
        }
      }

      return true;
    });

    if (fuzzyCandidates.length > 1) {
      return {
        linkStatus: "quarantined",
        quarantineReason: "MULTIPLE_CANDIDATE_MATCHES",
        quarantineDetails: {
          candidateInternalIds: fuzzyCandidates.map((c) => c.id),
          count: fuzzyCandidates.length,
          explanation:
            "Multiple candidate internal transactions match amount, asset, and timeframe without distinct txHash",
        },
      };
    } else if (fuzzyCandidates.length === 1) {
      // Single candidate found by amount & wallet, but lacks cryptographic txHash confirmation
      // Quarantine to protect ledger invariants and require operator review
      return {
        linkStatus: "quarantined",
        quarantineReason: "AMBIGUOUS_UNHASHED_CANDIDATE",
        quarantineDetails: {
          candidateInternalId: fuzzyCandidates[0].id,
          explanation:
            "Candidate internal transaction matches amount and time window but lacks on-chain txHash link",
        },
      };
    }

    return { linkStatus: "unmatched" };
  }

  /**
   * Retrieve unmatched external activities, exposing them for review.
   */
  public getUnmatchedActivities(filters: {
    walletAddress?: string;
    network?: NetworkType;
    source?: WalletHistorySource;
    importId?: string;
  } = {}): NormalizedExternalActivity[] {
    return [...this.activities.values()]
      .filter((act) => act.linkStatus === "unmatched")
      .filter(
        (act) =>
          !filters.walletAddress ||
          act.sourceAddress.toLowerCase() === filters.walletAddress.toLowerCase() ||
          act.targetAddress.toLowerCase() === filters.walletAddress.toLowerCase()
      )
      .filter((act) => !filters.network || act.network === filters.network)
      .filter((act) => !filters.source || act.provenance.source === filters.source)
      .filter((act) => !filters.importId || act.provenance.importId === filters.importId)
      .map((act) => this.cloneActivity(act));
  }

  /**
   * Retrieve quarantined activities for operator triage.
   */
  public getQuarantinedMatches(filters: {
    walletAddress?: string;
    reason?: QuarantineReason;
    importId?: string;
  } = {}): NormalizedExternalActivity[] {
    return [...this.activities.values()]
      .filter((act) => act.linkStatus === "quarantined")
      .filter(
        (act) =>
          !filters.walletAddress ||
          act.sourceAddress.toLowerCase() === filters.walletAddress.toLowerCase() ||
          act.targetAddress.toLowerCase() === filters.walletAddress.toLowerCase()
      )
      .filter((act) => !filters.reason || act.quarantineReason === filters.reason)
      .filter((act) => !filters.importId || act.provenance.importId === filters.importId)
      .map((act) => this.cloneActivity(act));
  }

  /**
   * Retrieve all activities for a given stable chain identity.
   */
  public getActivity(chainIdentity: string): NormalizedExternalActivity | undefined {
    const act = this.activities.get(chainIdentity);
    return act ? this.cloneActivity(act) : undefined;
  }

  /**
   * Operator resolution of quarantined activity.
   */
  public resolveQuarantinedMatch(
    chainIdentity: string,
    resolution: "link" | "dismiss" | "keep_unmatched",
    targetInternalRecordId?: string,
    actor?: OperatorActor
  ): NormalizedExternalActivity {
    if (actor) {
      this.assertOperator(actor);
    }

    const activity = this.activities.get(chainIdentity);
    if (!activity) {
      throw new Error(`Activity with chain identity '${chainIdentity}' not found`);
    }

    if (activity.linkStatus !== "quarantined") {
      throw new Error(`Activity '${chainIdentity}' is not currently in quarantined status`);
    }

    if (resolution === "link") {
      if (!targetInternalRecordId) {
        throw new Error("Target internal record ID required to link quarantined activity");
      }
      activity.linkStatus = "matched";
      activity.linkedInternalRecordId = targetInternalRecordId;
      activity.quarantineReason = undefined;
      activity.quarantineDetails = {
        resolvedBy: actor?.id ?? "operator",
        resolvedAt: new Date().toISOString(),
        action: "manual_link",
      };
    } else if (resolution === "dismiss") {
      activity.linkStatus = "dismissed";
      activity.quarantineDetails = {
        resolvedBy: actor?.id ?? "operator",
        resolvedAt: new Date().toISOString(),
        action: "dismissed",
      };
    } else {
      activity.linkStatus = "unmatched";
      activity.quarantineReason = undefined;
      activity.quarantineDetails = {
        resolvedBy: actor?.id ?? "operator",
        resolvedAt: new Date().toISOString(),
        action: "marked_unmatched",
      };
    }

    activity.lastReconciledAt = new Date();
    this.activities.set(chainIdentity, activity);
    return this.cloneActivity(activity);
  }

  /**
   * Convert unmatched and quarantined activities into standard DriftItems for reconciliation reports.
   */
  public toDriftItems(): DriftItem[] {
    const driftItems: DriftItem[] = [];

    for (const act of this.activities.values()) {
      if (act.linkStatus === "unmatched") {
        driftItems.push({
          type: "external_activity_unmatched",
          severity: "major" as DriftSeverity,
          entityId: act.chainIdentity,
          backendValue: null,
          onChainValue: {
            txHash: act.txHash,
            amount: act.amount,
            asset: act.asset,
            sourceAddress: act.sourceAddress,
            targetAddress: act.targetAddress,
            provenance: act.provenance,
          },
          description: `External on-chain transaction ${act.txHash} has no internal Chen Pilot matching record (source: ${act.provenance.source})`,
          repairAction: `Review external activity ${act.chainIdentity} and link or acknowledge as third-party transaction`,
          detectedAt: act.timestamp.toISOString(),
        });
      } else if (act.linkStatus === "quarantined") {
        driftItems.push({
          type: "external_activity_quarantined",
          severity: "critical" as DriftSeverity,
          entityId: act.chainIdentity,
          backendValue: act.quarantineDetails ?? null,
          onChainValue: {
            txHash: act.txHash,
            amount: act.amount,
            asset: act.asset,
            status: act.status,
          },
          description: `External transaction ${act.txHash} quarantined during reconciliation: ${act.quarantineReason}`,
          repairAction: `Investigate reconciliation quarantine for ${act.chainIdentity} (${act.quarantineReason})`,
          detectedAt: act.timestamp.toISOString(),
        });
      }
    }

    return driftItems;
  }

  /**
   * Export unmatched and quarantined items directly into ReconciliationCases
   * within ReconciliationWorkspaceService for formal operator investigations.
   */
  public exportToReconciliationCases(
    workspaceService: ReconciliationWorkspaceService,
    reportId: string = crypto.randomUUID()
  ): ReconciliationCase[] {
    const driftItems = this.toDriftItems();
    const syntheticReport = {
      id: reportId,
      userId: "system",
      scope: { transactions: true },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: driftItems.length > 0 ? ("drifted" as const) : ("clean" as const),
      summary: {
        total: driftItems.length,
        critical: driftItems.filter((d) => d.severity === "critical").length,
        major: driftItems.filter((d) => d.severity === "major").length,
        minor: 0,
        none: 0,
      },
      driftItems,
    };

    return workspaceService.createCasesFromReport(syntheticReport);
  }

  /**
   * Emit notification to registered subscribers.
   */
  private emitNotification(notification: ExternalReconciliationNotification): void {
    for (const handler of this.notificationHandlers) {
      try {
        handler(notification);
      } catch (err) {
        logger.warn("Notification handler threw an error", { err });
      }
    }
  }

  private assertOperator(actor: OperatorActor): void {
    if (!actor.roles.includes("operator") && !actor.roles.includes("admin")) {
      throw new Error("Operator permission required");
    }
  }

  private cloneActivity(
    act: NormalizedExternalActivity
  ): NormalizedExternalActivity {
    return {
      ...act,
      timestamp: new Date(act.timestamp),
      lastReconciledAt: act.lastReconciledAt
        ? new Date(act.lastReconciledAt)
        : undefined,
      provenance: {
        ...act.provenance,
        importedAt: new Date(act.provenance.importedAt),
        metadata: act.provenance.metadata
          ? { ...act.provenance.metadata }
          : undefined,
      },
      quarantineDetails: act.quarantineDetails
        ? { ...act.quarantineDetails }
        : undefined,
    };
  }
}

export const externalWalletReconciliationService =
  new ExternalWalletReconciliationService();
