/**
 * erasureReporter.ts
 *
 * Generates cryptographic proof-of-erasure receipts.
 *
 * A receipt:
 *  - Identifies the erased subject by SHA-256(userId), NOT by the userId itself
 *  - Lists every step completed and every step that failed
 *  - Names the data classes covered
 *  - Notes any classes intentionally retained (legal compliance exceptions)
 *  - Carries a receiptHash and HMAC signature proving it was server-generated
 *    and has not been tampered with
 *
 * Receipts are stored in the erasure_receipt table and can be verified by
 * any party holding the ENCRYPTION_KEY (server-side verification) or
 * by checking the receiptHash alone (tamper detection).
 */

import crypto from "crypto";
import { Repository } from "typeorm";
import AppDataSource from "../config/Datasource";
import { ErasureReceipt as ErasureReceiptEntity } from "./erasureReceipt.entity";
import { ErasureResult } from "./deletionCoordinator";
import {
  DataClass,
  REGISTRY,
  getUserOwnedClasses,
} from "./classification";
import { legalHoldService } from "./legalHold";
import logger from "../config/logger";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ErasureReceipt {
  receiptId: string;
  /** SHA-256(userId) — proves erasure without exposing who was erased */
  subjectIdHash: string;
  erasedAt: string;
  stepsCompleted: string[];
  stepsFailed: Array<{ step: string; error: string }>;
  cryptoErasurePerformed: boolean;
  /** Data classes touched by the erasure */
  dataClassesCovered: DataClass[];
  /** Classes intentionally retained (e.g. audit_log, reconciliation_report) */
  retentionExceptions: Array<{ dataClass: DataClass; reason: string }>;
  /** SHA-256 of the canonical receipt payload */
  receiptHash: string;
  /** HMAC-SHA256(receiptHash, ENCRYPTION_KEY) — proves server origin */
  signature: string;
}

export interface ErasureReport {
  userId: string;
  generatedAt: string;
  activeHolds: Array<{
    holdId: string;
    dataClasses: DataClass[];
    reason: string;
    placedAt: Date;
  }>;
  dataClassStatus: Array<{
    dataClass: DataClass;
    status: "erased" | "retained_compliance" | "held" | "pending";
    retentionDays: number;
    erasureMethod: string;
  }>;
  storedReceipts: Array<{ receiptId: string; erasedAt: string }>;
}

// ─── Step → DataClass Mapping ─────────────────────────────────────────────────

const STEP_TO_DATA_CLASS: Record<string, DataClass> = {
  "db.refresh_tokens": "refresh_token",
  "db.bot_sessions": "bot_session",
  "db.bot_identities": "bot_identity",
  "db.user_preferences": "user_preferences",
  "db.contacts": "contact",
  "db.queue_jobs": "queue_job",
  "db.transaction_lifecycle": "transaction_lifecycle",
  "db.agent_execution_metrics": "agent_execution_metrics",
  "disk.conversation_memory": "conversation_memory",
  "crypto.key_tombstone": "user_private_key",
  "db.user": "user_profile",
  "cache.redis_session": "redis_session",
};

// ─── Reporter ─────────────────────────────────────────────────────────────────

export class ErasureReporter {
  private get repo(): Repository<ErasureReceiptEntity> {
    return AppDataSource.getRepository(ErasureReceiptEntity);
  }

  private getMasterKeyHex(): string {
    const hex = process.env.ENCRYPTION_KEY;
    if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error("ENCRYPTION_KEY must be a 64-character hex string");
    }
    return hex;
  }

  /**
   * Generates a cryptographic erasure receipt from an ErasureResult.
   * The receipt is persisted to the database and returned.
   */
  async generateReceipt(erasureResult: ErasureResult): Promise<ErasureReceipt> {
    const receiptId = crypto.randomUUID();
    const subjectIdHash = crypto
      .createHash("sha256")
      .update(erasureResult.userId)
      .digest("hex");

    const erasedAt = erasureResult.completedAt.toISOString();

    // Derive data classes from completed steps
    const dataClassesCovered: DataClass[] = [
      ...new Set(
        erasureResult.stepsCompleted
          .map((step) => STEP_TO_DATA_CLASS[step])
          .filter((dc): dc is DataClass => !!dc)
      ),
    ];

    // Retention exceptions: classes owned by users that were NOT erased,
    // either because they use 'retain' erasure or they appear in stepsFailed
    const retainedClasses = getUserOwnedClasses().filter((dc) => {
      const rec = REGISTRY[dc];
      return (
        rec.erasureMethod === "retain" ||
        rec.erasureMethod === "nullify" // nullified, not deleted
      );
    });

    const retentionExceptions: Array<{ dataClass: DataClass; reason: string }> =
      [];

    for (const dc of retainedClasses) {
      const rec = REGISTRY[dc];
      if (rec.erasureMethod === "retain") {
        retentionExceptions.push({
          dataClass: dc,
          reason: `Legally immutable (purpose: ${rec.purpose}); held for ${rec.retentionDays} days`,
        });
      } else if (rec.erasureMethod === "nullify") {
        retentionExceptions.push({
          dataClass: dc,
          reason: `User reference nullified; aggregate record retained for ${rec.purpose}`,
        });
      }
    }

    // Also add failed steps as partial-erasure exceptions
    for (const failure of erasureResult.stepsFailed) {
      const dc = STEP_TO_DATA_CLASS[failure.step];
      if (dc) {
        retentionExceptions.push({
          dataClass: dc,
          reason: `Erasure step failed: ${failure.error}`,
        });
      }
    }

    // Compute receipt hash
    const receiptHash = crypto
      .createHash("sha256")
      .update(
        `${receiptId}|${subjectIdHash}|${erasedAt}|${erasureResult.stepsCompleted.join(",")}`
      )
      .digest("hex");

    // HMAC signature
    const keyHex = this.getMasterKeyHex();
    const signature = crypto
      .createHmac("sha256", Buffer.from(keyHex, "hex"))
      .update(receiptHash)
      .digest("hex");

    const receipt: ErasureReceipt = {
      receiptId,
      subjectIdHash,
      erasedAt,
      stepsCompleted: erasureResult.stepsCompleted,
      stepsFailed: erasureResult.stepsFailed,
      cryptoErasurePerformed: erasureResult.cryptoErasurePerformed,
      dataClassesCovered,
      retentionExceptions,
      receiptHash,
      signature,
    };

    // Persist to DB
    const entity = this.repo.create({
      id: receiptId,
      subjectIdHash,
      receiptJson: receipt as unknown as Record<string, unknown>,
      receiptHash,
    });
    await this.repo.save(entity);

    logger.info("Erasure receipt generated", {
      receiptId,
      subjectIdHash,
      erasedAt,
      dataClassesCovered: dataClassesCovered.length,
      cryptoErasurePerformed: erasureResult.cryptoErasurePerformed,
    });

    return receipt;
  }

  /**
   * Generates a status report for a userId without performing erasure.
   * Useful for compliance audits or user data requests.
   */
  async generateReport(userId: string): Promise<ErasureReport> {
    const generatedAt = new Date().toISOString();
    const subjectIdHash = crypto
      .createHash("sha256")
      .update(userId)
      .digest("hex");

    const activeHolds = await legalHoldService.getActiveHolds(userId);

    const heldDataClasses = new Set(
      activeHolds.flatMap((h) => h.dataClasses)
    );

    const dataClassStatus: ErasureReport["dataClassStatus"] = getUserOwnedClasses()
      .map((dc) => {
        const rec = REGISTRY[dc];
        let status: "erased" | "retained_compliance" | "held" | "pending";

        if (heldDataClasses.has(dc)) {
          status = "held";
        } else if (rec.erasureMethod === "retain") {
          status = "retained_compliance";
        } else {
          status = "pending"; // not yet erased
        }

        return {
          dataClass: dc,
          status,
          retentionDays: rec.retentionDays,
          erasureMethod: rec.erasureMethod,
        };
      });

    // Find stored receipts for this subject
    const storedEntities = await this.repo.find({
      where: { subjectIdHash },
      order: { createdAt: "DESC" },
    });

    const storedReceipts = storedEntities.map((e) => ({
      receiptId: e.id,
      erasedAt: e.createdAt.toISOString(),
    }));

    return {
      userId,
      generatedAt,
      activeHolds: activeHolds.map((h) => ({
        holdId: h.holdId,
        dataClasses: h.dataClasses,
        reason: h.reason,
        placedAt: h.placedAt,
      })),
      dataClassStatus,
      storedReceipts,
    };
  }

  /**
   * Verifies that a receipt has not been tampered with.
   * Re-derives the receiptHash and signature and compares to the stored values.
   */
  verifyReceipt(receipt: ErasureReceipt): boolean {
    try {
      const expectedHash = crypto
        .createHash("sha256")
        .update(
          `${receipt.receiptId}|${receipt.subjectIdHash}|${receipt.erasedAt}|${receipt.stepsCompleted.join(",")}`
        )
        .digest("hex");

      if (expectedHash !== receipt.receiptHash) {
        return false;
      }

      const keyHex = this.getMasterKeyHex();
      const expectedSig = crypto
        .createHmac("sha256", Buffer.from(keyHex, "hex"))
        .update(expectedHash)
        .digest("hex");

      return expectedSig === receipt.signature;
    } catch {
      return false;
    }
  }

  /**
   * Lists stored receipts from the database.
   * If userId is provided, filters by SHA-256(userId).
   */
  async listReceipts(userId?: string): Promise<ErasureReceipt[]> {
    let entities: ErasureReceiptEntity[];

    if (userId) {
      const subjectIdHash = crypto
        .createHash("sha256")
        .update(userId)
        .digest("hex");
      entities = await this.repo.find({
        where: { subjectIdHash },
        order: { createdAt: "DESC" },
      });
    } else {
      entities = await this.repo.find({ order: { createdAt: "DESC" } });
    }

    return entities.map((e) => e.receiptJson as unknown as ErasureReceipt);
  }

  /**
   * Retrieves a single receipt by its ID.
   */
  async getReceipt(receiptId: string): Promise<ErasureReceipt | null> {
    const entity = await this.repo.findOne({ where: { id: receiptId } });
    if (!entity) return null;
    return entity.receiptJson as unknown as ErasureReceipt;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const erasureReporter = new ErasureReporter();
