import { Repository } from "typeorm";
import * as StellarSdk from "@stellar/stellar-sdk";
import AppDataSource from "../../config/Datasource";
import logger from "../../config/logger";
import { SequenceLease } from "./SequenceLease.entity";

// ── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_LEASE_TTL_MS = 60_000; // 1 minute
const HORIZON_RETRY_DELAY_MS = 500;
const HORIZON_MAX_RETRIES = 3;

// ── Errors ───────────────────────────────────────────────────────────────────

export class LeaseAcquisitionError extends Error {
  constructor(
    message: string,
    public readonly accountPublicKey: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "LeaseAcquisitionError";
  }
}

export class LeaseValidationError extends Error {
  constructor(
    message: string,
    public readonly leaseId: string,
    public readonly reason:
      | "not_found"
      | "not_reserved"
      | "expired"
      | "superseded"
      | "owner_mismatch"
  ) {
    super(message);
    this.name = "LeaseValidationError";
  }
}

export class LeaseConsumeError extends Error {
  constructor(
    message: string,
    public readonly leaseId: string,
    public readonly reason:
      | "not_found"
      | "not_reserved"
      | "expired"
      | "superseded"
  ) {
    super(message);
    this.name = "LeaseConsumeError";
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface LeaseAcquisitionResult {
  lease: SequenceLease;
  sequenceNumber: number;
  fencingToken: number;
}

export interface ReconciliationResult {
  accountPublicKey: string;
  onChainSequence: number;
  highestConsumedLocal: number | null;
  highestReservedLocal: number | null;
  gapSize: number;
  reclaimedLeases: number;
  /** Leases that were reserved but whose sequence was never consumed on-chain. */
  staleLeases: SequenceLease[];
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Durable sequence lease service for Stellar account sequence management.
 *
 * Provides linearizable sequence allocation across instances with:
 * - PostgreSQL as the durable source of truth
 * - Fencing tokens to detect superseded leases
 * - Crash recovery via expiry/reclaim and on-chain reconciliation
 *
 * Invariants:
 * 1. For a given account, `acquireLease` produces a monotonically increasing
 *    sequence number (no duplicates, no gaps except from crash-recovered leases).
 * 2. Once a lease is superseded (a newer lease exists for the same account),
 *    the old lease can never be successfully consumed.
 * 3. `consumeLease` is atomic: only one caller can consume a given lease.
 */
export class SequenceLeaseService {
  private get repo(): Repository<SequenceLease> {
    return AppDataSource.getRepository(SequenceLease);
  }

  /**
   * Acquire a sequence lease for the given Stellar account.
   *
   * This is the core allocation operation.  It:
   * 1. Queries Horizon for the current on-chain sequence (authoritative).
   * 2. Finds the highest locally reserved or consumed sequence.
   * 3. Allocates `max(onChain, local) + 1`.
   * 4. Persists the lease to PostgreSQL (durable source of truth).
   *
   * The unique constraint on (accountPublicKey, leasedSequence) ensures
   * linearizability: concurrent allocators will serialize at the DB level.
   *
   * @param accountPublicKey - Stellar account to allocate a sequence for
   * @param ownerId - Worker/instance identifier
   * @param ttlMs - Lease time-to-live in milliseconds
   * @param horizonServer - Horizon server for on-chain sequence lookup
   * @returns The allocated lease with sequence number and fencing token
   */
  async acquireLease(
    accountPublicKey: string,
    ownerId: string,
    ttlMs: number = DEFAULT_LEASE_TTL_MS,
    horizonServer?: StellarSdk.Horizon.Server,
    maxRetries: number = 3
  ): Promise<LeaseAcquisitionResult> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.doAcquireLease(
          accountPublicKey,
          ownerId,
          ttlMs,
          horizonServer
        );
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Retry on unique constraint violations (concurrent allocation race)
        const isConstraintViolation =
          err instanceof Error &&
          (err.message.includes("unique") ||
            err.message.includes("duplicate") ||
            err.message.includes("23505"));

        if (!isConstraintViolation || attempt === maxRetries) {
          throw lastError;
        }

        logger.warn("Sequence lease allocation conflict, retrying", {
          accountPublicKey,
          attempt,
          maxRetries,
          error: lastError.message,
        });

        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
      }
    }

    throw lastError!;
  }

  private async doAcquireLease(
    accountPublicKey: string,
    ownerId: string,
    ttlMs: number,
    horizonServer?: StellarSdk.Horizon.Server
  ): Promise<LeaseAcquisitionResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    // Use a transaction to ensure atomic allocation
    return AppDataSource.transaction(async (manager) => {
      // Step 1: Get the current on-chain sequence from Horizon
      let onChainSequence = 0;
      if (horizonServer) {
        try {
          const account = await this.loadAccountWithRetry(
            horizonServer,
            accountPublicKey
          );
          onChainSequence = Number(account.sequenceNumber());
        } catch (err) {
          logger.warn("Failed to load account from Horizon, using local max", {
            accountPublicKey,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      // Step 2: Find the highest sequence already tracked locally
      const result = await manager
        .createQueryBuilder(SequenceLease, "sl")
        .select("MAX(sl.leasedSequence)", "maxSeq")
        .where("sl.accountPublicKey = :accountPublicKey", { accountPublicKey })
        .getRawOne();

      const localMax = result?.maxSeq ? Number(result.maxSeq) : 0;

      // Step 3: Allocate the next sequence
      const nextSequence = Math.max(onChainSequence, localMax) + 1;

      // Step 4: Get the next fencing token
      const tokenResult = await manager
        .createQueryBuilder(SequenceLease, "sl")
        .select("MAX(sl.fencingToken)", "maxToken")
        .where("sl.accountPublicKey = :accountPublicKey", { accountPublicKey })
        .getRawOne();

      const nextFencingToken = tokenResult?.maxToken
        ? Number(tokenResult.maxToken) + 1
        : 1;

      // Step 5: Insert the lease (unique constraint ensures no duplicates)
      const lease = manager.create(SequenceLease, {
        accountPublicKey,
        leasedSequence: nextSequence,
        fencingToken: nextFencingToken,
        ownerId,
        status: "reserved",
        reservedAt: now,
        expiresAt,
      });

      const saved = await manager.save(lease);

      logger.info("Sequence lease acquired", {
        leaseId: saved.id,
        accountPublicKey,
        sequenceNumber: nextSequence,
        fencingToken: nextFencingToken,
        ownerId,
        expiresAt: expiresAt.toISOString(),
      });

      return {
        lease: saved,
        sequenceNumber: nextSequence,
        fencingToken: nextFencingToken,
      };
    });
  }

  /**
   * Atomically validate a lease and mark it consumed.
   *
   * This operation is the fencing gate: it verifies that:
   * 1. The lease exists and is in `reserved` status
   * 2. The lease has not expired
   * 3. No newer lease exists for this account (fencing check)
   * 4. The caller owns the lease
   *
   * All checks and the status update happen in a single DB transaction,
   * making it atomic at the database level.
   *
   * @param leaseId - The lease to consume
   * @param ownerId - The caller's worker ID (must match the lease owner)
   * @param txHash - Transaction hash from Horizon after successful submission
   * @returns The updated lease
   * @throws LeaseConsumeError if the lease cannot be consumed
   */
  async consumeLease(
    leaseId: string,
    ownerId: string,
    txHash: string
  ): Promise<SequenceLease> {
    return AppDataSource.transaction(async (manager) => {
      // Load the lease within the transaction
      const lease = await manager.findOne(SequenceLease, {
        where: { id: leaseId },
      });

      if (!lease) {
        throw new LeaseConsumeError(
          `Lease ${leaseId} not found`,
          leaseId,
          "not_found"
        );
      }

      if (lease.status !== "reserved") {
        throw new LeaseConsumeError(
          `Lease ${leaseId} is not in reserved status (current: ${lease.status})`,
          leaseId,
          lease.status === "consumed" ? "superseded" : lease.status as "not_reserved"
        );
      }

      if (new Date() > lease.expiresAt) {
        // Mark as expired within the same transaction
        lease.status = "expired";
        await manager.save(lease);
        throw new LeaseConsumeError(
          `Lease ${leaseId} has expired`,
          leaseId,
          "expired"
        );
      }

      if (lease.ownerId !== ownerId) {
        throw new LeaseConsumeError(
          `Lease ${leaseId} is owned by ${lease.ownerId}, not ${ownerId}`,
          leaseId,
          "owner_mismatch" as "not_found"
        );
      }

      // Fencing check: verify no newer lease exists for this account
      const newerLease = await manager
        .createQueryBuilder(SequenceLease, "sl")
        .where("sl.accountPublicKey = :accountPublicKey", {
          accountPublicKey: lease.accountPublicKey,
        })
        .andWhere("sl.fencingToken > :fencingToken", {
          fencingToken: lease.fencingToken,
        })
        .andWhere("sl.id != :leaseId", { leaseId })
        .getOne();

      if (newerLease) {
        // Superseded — mark this lease as expired
        lease.status = "expired";
        await manager.save(lease);
        throw new LeaseConsumeError(
          `Lease ${leaseId} has been superseded by lease ${newerLease.id} (fencing token ${newerLease.fencingToken} > ${lease.fencingToken})`,
          leaseId,
          "superseded"
        );
      }

      // All checks passed — consume the lease atomically
      lease.status = "consumed";
      lease.consumedAt = new Date();
      lease.txHash = txHash;
      const saved = await manager.save(lease);

      logger.info("Sequence lease consumed", {
        leaseId: saved.id,
        accountPublicKey: saved.accountPublicKey,
        sequenceNumber: saved.leasedSequence,
        fencingToken: saved.fencingToken,
        txHash,
      });

      return saved;
    });
  }

  /**
   * Pre-flight lease validation before submission.
   *
   * Unlike `consumeLease`, this does NOT mark the lease as consumed.
   * It validates that the lease is still current, allowing the caller
   * to build the transaction before consuming.
   *
   * The caller MUST call `consumeLease` after successful submission.
   *
   * @param leaseId - The lease to validate
   * @param fencingToken - The fencing token the caller holds
   * @returns The lease if valid
   * @throws LeaseValidationError if the lease is invalid
   */
  async validateLease(
    leaseId: string,
    fencingToken: number
  ): Promise<SequenceLease> {
    const lease = await this.repo.findOne({ where: { id: leaseId } });

    if (!lease) {
      throw new LeaseValidationError(
        `Lease ${leaseId} not found`,
        leaseId,
        "not_found"
      );
    }

    if (lease.status !== "reserved") {
      throw new LeaseValidationError(
        `Lease ${leaseId} is not reserved (current: ${lease.status})`,
        leaseId,
        lease.status as "not_reserved"
      );
    }

    if (new Date() > lease.expiresAt) {
      throw new LeaseValidationError(
        `Lease ${leaseId} has expired`,
        leaseId,
        "expired"
      );
    }

    if (lease.fencingToken !== fencingToken) {
      throw new LeaseValidationError(
        `Lease ${leaseId} fencing token mismatch (expected ${fencingToken}, got ${lease.fencingToken})`,
        leaseId,
        "superseded"
      );
    }

    // Check if a newer lease exists (superseded)
    const newerLease = await this.repo
      .createQueryBuilder("sl")
      .where("sl.accountPublicKey = :accountPublicKey", {
        accountPublicKey: lease.accountPublicKey,
      })
      .andWhere("sl.fencingToken > :fencingToken", { fencingToken })
      .andWhere("sl.id != :leaseId", { leaseId })
      .getOne();

    if (newerLease) {
      throw new LeaseValidationError(
        `Lease ${leaseId} has been superseded by lease ${newerLease.id}`,
        leaseId,
        "superseded"
      );
    }

    return lease;
  }

  /**
   * Expire and reclaim abandoned leases.
   *
   * Finds all leases that are past their expiry time and still in
   * `reserved` status, then marks them as `reclaimed`.  This is the
   * crash recovery mechanism: if a worker crashes after acquiring a
   * lease but before consuming it, this method reclaims the sequence.
   *
   * @param batchSize - Maximum number of leases to reclaim per call
   * @returns Array of reclaimed leases
   */
  async expireAndReclaim(batchSize: number = 100): Promise<SequenceLease[]> {
    const now = new Date();

    const staleLeases = await this.repo
      .createQueryBuilder("sl")
      .where("sl.status = :status", { status: "reserved" })
      .andWhere("sl.expiresAt < :now", { now })
      .orderBy("sl.expiresAt", "ASC")
      .limit(batchSize)
      .getMany();

    if (staleLeases.length === 0) {
      return [];
    }

    const reclaimed: SequenceLease[] = [];
    for (const lease of staleLeases) {
      lease.status = "reclaimed";
      const saved = await this.repo.save(lease);
      reclaimed.push(saved);

      logger.info("Sequence lease reclaimed (expired)", {
        leaseId: saved.id,
        accountPublicKey: saved.accountPublicKey,
        sequenceNumber: saved.leasedSequence,
        ownerId: saved.ownerId,
        expiredAt: saved.expiresAt.toISOString(),
      });
    }

    logger.info("Batch lease reclamation completed", {
      reclaimedCount: reclaimed.length,
    });

    return reclaimed;
  }

  /**
   * Reconcile local lease state with Horizon's on-chain sequence.
   *
   * This detects:
   * - Gaps where a leased sequence was never consumed on-chain
   * - Stale reserved leases whose sequence was skipped on-chain
   *
   * @param accountPublicKey - The Stellar account to reconcile
   * @param horizonServer - Horizon server for on-chain lookup
   * @returns Reconciliation result with gap details
   */
  async reconcileWithOnChain(
    accountPublicKey: string,
    horizonServer: StellarSdk.Horizon.Server
  ): Promise<ReconciliationResult> {
    // Get on-chain sequence
    let onChainSequence: number;
    try {
      const account = await this.loadAccountWithRetry(
        horizonServer,
        accountPublicKey
      );
      onChainSequence = Number(account.sequenceNumber());
    } catch (err) {
      throw new Error(
        `Failed to load account from Horizon for reconciliation: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }

    // Get highest consumed sequence locally
    const consumedResult = await this.repo
      .createQueryBuilder("sl")
      .select("MAX(sl.leasedSequence)", "maxSeq")
      .where("sl.accountPublicKey = :accountPublicKey", { accountPublicKey })
      .andWhere("sl.status = :status", { status: "consumed" })
      .getRawOne();

    const highestConsumedLocal = consumedResult?.maxSeq
      ? Number(consumedResult.maxSeq)
      : null;

    // Get highest reserved sequence locally
    const reservedResult = await this.repo
      .createQueryBuilder("sl")
      .select("MAX(sl.leasedSequence)", "maxSeq")
      .where("sl.accountPublicKey = :accountPublicKey", { accountPublicKey })
      .andWhere("sl.status = :status", { status: "reserved" })
      .getRawOne();

    const highestReservedLocal = reservedResult?.maxSeq
      ? Number(reservedResult.maxSeq)
      : null;

    // Find stale reserved leases (sequences that are below on-chain)
    const staleLeases = await this.repo
      .createQueryBuilder("sl")
      .where("sl.accountPublicKey = :accountPublicKey", { accountPublicKey })
      .andWhere("sl.status = :status", { status: "reserved" })
      .andWhere("sl.leasedSequence <= :onChainSequence", { onChainSequence })
      .getMany();

    // Reclaim stale leases
    let reclaimedLeases = 0;
    for (const lease of staleLeases) {
      lease.status = "reclaimed";
      await this.repo.save(lease);
      reclaimedLeases++;

      logger.info("Stale lease reclaimed during reconciliation", {
        leaseId: lease.id,
        accountPublicKey,
        sequenceNumber: lease.leasedSequence,
        onChainSequence,
      });
    }

    // Calculate gap: difference between on-chain and highest consumed locally
    const gapSize = highestConsumedLocal
      ? Math.max(0, onChainSequence - highestConsumedLocal)
      : onChainSequence;

    const result: ReconciliationResult = {
      accountPublicKey,
      onChainSequence,
      highestConsumedLocal,
      highestReservedLocal,
      gapSize,
      reclaimedLeases,
      staleLeases,
    };

    if (gapSize > 0 || reclaimedLeases > 0) {
      logger.info("Reconciliation completed with findings", result);
    } else {
      logger.debug("Reconciliation completed — clean", {
        accountPublicKey,
        onChainSequence,
      });
    }

    return result;
  }

  /**
   * Get the latest active (reserved) lease for an account.
   */
  async getActiveLease(
    accountPublicKey: string
  ): Promise<SequenceLease | null> {
    return this.repo.findOne({
      where: { accountPublicKey, status: "reserved" },
      order: { fencingToken: "DESC" },
    });
  }

  /**
   * Get the current fencing token for an account.
   * Returns 0 if no leases exist.
   */
  async getCurrentFencingToken(accountPublicKey: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder("sl")
      .select("MAX(sl.fencingToken)", "maxToken")
      .where("sl.accountPublicKey = :accountPublicKey", { accountPublicKey })
      .getRawOne();

    return result?.maxToken ? Number(result.maxToken) : 0;
  }

  /**
   * Load a Stellar account from Horizon with retry logic.
   */
  private async loadAccountWithRetry(
    server: StellarSdk.Horizon.Server,
    publicKey: string
  ): Promise<StellarSdk.Horizon.Account> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= HORIZON_MAX_RETRIES; attempt++) {
      try {
        return await server.loadAccount(publicKey);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error("Unknown error");
        if (attempt < HORIZON_MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, HORIZON_RETRY_DELAY_MS * attempt)
          );
        }
      }
    }

    throw lastError;
  }
}

export const sequenceLeaseService = new SequenceLeaseService();
