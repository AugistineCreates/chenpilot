/**
 * legalHold.ts
 *
 * Legal and audit hold service.
 *
 * Holds are explicitly placed, narrowly scoped to specific data classes,
 * and must be explicitly lifted. They block both time-based retention purges
 * and user erasure requests for the covered data classes.
 */

import { Repository, IsNull, Or, MoreThan } from "typeorm";
import AppDataSource from "../config/Datasource";
import { LegalHoldEntry } from "./legalHoldEntry.entity";
import { DataClass, getUserOwnedClasses } from "./classification";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";
import logger from "../config/logger";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PlaceHoldParams {
  holdId: string;
  subjectType: "user" | "tenant" | "transaction";
  subjectId: string;
  /** Narrow scope: only these data classes are held */
  dataClasses: DataClass[];
  reason: string;
  requestedBy: string;
  expiresAt?: Date;
}

export class HoldBlocksErasureError extends Error {
  constructor(
    public readonly userId: string,
    public readonly activeHolds: LegalHoldEntry[]
  ) {
    super(
      `Erasure of user ${userId} is blocked by ${activeHolds.length} active legal hold(s): ` +
        activeHolds.map((h) => h.holdId).join(", ")
    );
    this.name = "HoldBlocksErasureError";
  }
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class LegalHoldService {
  private get repo(): Repository<LegalHoldEntry> {
    return AppDataSource.getRepository(LegalHoldEntry);
  }

  /**
   * Places a new legal or audit hold on a subject for specific data classes.
   * Multiple data classes can be covered by one holdId.
   */
  async placeHold(params: PlaceHoldParams): Promise<LegalHoldEntry> {
    const entry = this.repo.create({
      holdId: params.holdId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      dataClasses: params.dataClasses,
      reason: params.reason,
      requestedBy: params.requestedBy,
      placedAt: new Date(),
      expiresAt: params.expiresAt,
    });

    const saved = await this.repo.save(entry);

    logger.info("Legal hold placed", {
      holdId: params.holdId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      dataClasses: params.dataClasses,
      requestedBy: params.requestedBy,
    });

    await auditLogService.log({
      action: AuditAction.SENSITIVE_DATA_ACCESS,
      severity: AuditSeverity.WARNING,
      resource: "legal_hold",
      metadata: {
        event: "hold_placed",
        holdId: params.holdId,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        dataClasses: params.dataClasses,
        reason: params.reason,
        requestedBy: params.requestedBy,
      },
    });

    return saved;
  }

  /**
   * Lifts all entries for a given holdId.
   */
  async liftHold(holdId: string, liftedBy: string): Promise<void> {
    const entries = await this.repo.find({ where: { holdId } });

    if (entries.length === 0) {
      throw new Error(`No hold entries found for holdId: ${holdId}`);
    }

    const now = new Date();
    for (const entry of entries) {
      entry.liftedAt = now;
      entry.liftedBy = liftedBy;
    }
    await this.repo.save(entries);

    logger.info("Legal hold lifted", {
      holdId,
      liftedBy,
      entriesLifted: entries.length,
    });

    await auditLogService.log({
      action: AuditAction.SENSITIVE_DATA_ACCESS,
      severity: AuditSeverity.INFO,
      resource: "legal_hold",
      metadata: {
        event: "hold_lifted",
        holdId,
        liftedBy,
        entriesLifted: entries.length,
      },
    });
  }

  /**
   * Returns true if there is an active hold on (subjectId, dataClass).
   * Active = liftedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now).
   */
  async isUnderHold(subjectId: string, dataClass: DataClass): Promise<boolean> {
    const now = new Date();

    const activeHolds = await this.repo
      .createQueryBuilder("h")
      .where("h.subjectId = :subjectId", { subjectId })
      .andWhere("h.liftedAt IS NULL")
      .andWhere("(h.expiresAt IS NULL OR h.expiresAt > :now)", { now })
      .getMany();

    return activeHolds.some((h) => h.dataClasses.includes(dataClass));
  }

  /**
   * Returns all active hold entries, optionally filtered by subjectId.
   */
  async getActiveHolds(subjectId?: string): Promise<LegalHoldEntry[]> {
    const now = new Date();
    const qb = this.repo
      .createQueryBuilder("h")
      .where("h.liftedAt IS NULL")
      .andWhere("(h.expiresAt IS NULL OR h.expiresAt > :now)", { now });

    if (subjectId) {
      qb.andWhere("h.subjectId = :subjectId", { subjectId });
    }

    return qb.orderBy("h.placedAt", "DESC").getMany();
  }

  /**
   * Returns true if erasure of the given userId is blocked by any active hold
   * covering any user-owned data class.
   */
  async isErasureBlocked(userId: string): Promise<boolean> {
    const activeHolds = await this.getActiveHolds(userId);
    if (activeHolds.length === 0) return false;

    const userOwnedClasses = new Set(getUserOwnedClasses());
    return activeHolds.some((hold) =>
      hold.dataClasses.some((dc) => userOwnedClasses.has(dc))
    );
  }

  /**
   * Returns the active holds blocking erasure, for inclusion in error messages.
   */
  async getErasureBlockingHolds(userId: string): Promise<LegalHoldEntry[]> {
    const activeHolds = await this.getActiveHolds(userId);
    const userOwnedClasses = new Set(getUserOwnedClasses());
    return activeHolds.filter((hold) =>
      hold.dataClasses.some((dc) => userOwnedClasses.has(dc))
    );
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const legalHoldService = new LegalHoldService();
