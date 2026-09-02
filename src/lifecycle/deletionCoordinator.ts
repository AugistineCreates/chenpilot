/**
 * deletionCoordinator.ts
 *
 * Fan-out erasure coordinator.
 * When a user requests deletion, this service propagates the erasure to
 * every store that holds user-owned data: DB tables, Redis caches, and the
 * disk-based agent memory file.
 *
 * Steps are executed in dependency order (derived data first, identity last).
 * Individual step failures are collected without aborting the remaining steps,
 * ensuring maximum erasure even under partial failures.
 */

import { DataSource } from "typeorm";
import AppDataSource from "../config/Datasource";
import { getRedisClient } from "../services/redis/client";
import { memoryStore } from "../Agents/memory/memory";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";
import { keyManagementService } from "./keyManagement";
import { legalHoldService, HoldBlocksErasureError } from "./legalHold";
import logger from "../config/logger";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ErasureOptions {
  reason?: string;
  requestedBy?: string;
  /** Skip the legal-hold check (admin override — use with care) */
  skipHoldCheck?: boolean;
}

export interface ErasureResult {
  userId: string;
  startedAt: Date;
  completedAt: Date;
  stepsCompleted: string[];
  stepsFailed: Array<{ step: string; error: string }>;
  cryptoErasurePerformed: boolean;
}

// ─── Coordinator ───────────────────────────────────────────────────────────────

export class DeletionCoordinator {
  private get ds(): DataSource {
    return AppDataSource;
  }

  /**
   * Erases all user-owned data for the given userId.
   *
   * Order:
   *   1. Check for active legal holds (throws HoldBlocksErasureError if blocked)
   *   2. Erase derived data (sessions, caches, memory)
   *   3. Nullify financial records (preserve audit trail)
   *   4. Cryptographic erasure (DEK tombstone)
   *   5. Delete identity (user row, last step)
   */
  async eraseUser(
    userId: string,
    options: ErasureOptions = {}
  ): Promise<ErasureResult> {
    const startedAt = new Date();
    const stepsCompleted: string[] = [];
    const stepsFailed: Array<{ step: string; error: string }> = [];
    let cryptoErasurePerformed = false;

    const reason = options.reason ?? "user_request";
    const requestedBy = options.requestedBy ?? userId;

    // ── 1. Legal hold check ──────────────────────────────────────────────────
    if (!options.skipHoldCheck) {
      const blocked = await legalHoldService.isErasureBlocked(userId);
      if (blocked) {
        const activeHolds = await legalHoldService.getErasureBlockingHolds(userId);
        throw new HoldBlocksErasureError(userId, activeHolds);
      }
    }

    // ── Helper: run a step safely ────────────────────────────────────────────
    const run = async (name: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
        stepsCompleted.push(name);
        logger.info(`Erasure step completed`, { userId, step: name });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stepsFailed.push({ step: name, error: message });
        logger.error(`Erasure step failed`, { userId, step: name, error: message });
      }
    };

    // ── 2. Refresh tokens ────────────────────────────────────────────────────
    await run("db.refresh_tokens", async () => {
      await this.ds
        .createQueryBuilder()
        .delete()
        .from("refresh_token")
        .where("userId = :userId", { userId })
        .execute();
    });

    // ── 3. Bot sessions ──────────────────────────────────────────────────────
    await run("db.bot_sessions", async () => {
      await this.ds
        .createQueryBuilder()
        .delete()
        .from("bot_session")
        .where("userId = :userId", { userId })
        .execute();
    });

    // ── 4. Bot identities ────────────────────────────────────────────────────
    await run("db.bot_identities", async () => {
      await this.ds
        .createQueryBuilder()
        .delete()
        .from("bot_identity")
        .where("userId = :userId", { userId })
        .execute();
    });

    // ── 5. User preferences ──────────────────────────────────────────────────
    await run("db.user_preferences", async () => {
      await this.ds
        .createQueryBuilder()
        .delete()
        .from("user_preferences")
        .where("userId = :userId", { userId })
        .execute();
    });

    // ── 6. Contacts (nullify userId FK; contacts may remain in the system) ───
    await run("db.contacts", async () => {
      await this.ds
        .createQueryBuilder()
        .update("contact")
        .set({ userId: undefined })
        .where("userId = :userId", { userId })
        .execute();
    });

    // ── 7. Queue jobs (non-leased) ───────────────────────────────────────────
    await run("db.queue_jobs", async () => {
      await this.ds
        .createQueryBuilder()
        .delete()
        .from("job_queue")
        .where("userId = :userId", { userId })
        .andWhere("status NOT IN (:...active)", {
          active: ["leased"],
        })
        .execute();
    });

    // ── 8. Transaction lifecycle (nullify userId, preserve tx hash) ──────────
    await run("db.transaction_lifecycle", async () => {
      await this.ds
        .createQueryBuilder()
        .update("transaction_lifecycle")
        .set({
          userId: undefined,
          metadata: { erased: true, erasedAt: new Date().toISOString() },
        })
        .where("userId = :userId", { userId })
        .execute();
    });

    // ── 9. Agent execution metrics (nullify userId) ──────────────────────────
    await run("db.agent_execution_metrics", async () => {
      await this.ds
        .createQueryBuilder()
        .update("agent_execution_metrics")
        .set({ userId: undefined })
        .where("userId = :userId", { userId })
        .execute();
    });

    // ── 10. Disk conversation memory ─────────────────────────────────────────
    await run("disk.conversation_memory", async () => {
      memoryStore.clear(userId);
    });

    // ── 11. Cryptographic erasure (DEK tombstone) ────────────────────────────
    await run("crypto.key_tombstone", async () => {
      await keyManagementService.tombstoneKey(userId, reason);
      cryptoErasurePerformed = true;
    });

    // ── 12. Identity (user row) — last step ──────────────────────────────────
    await run("db.user", async () => {
      await this.ds
        .createQueryBuilder()
        .delete()
        .from("user")
        .where("id = :userId", { userId })
        .execute();
    });

    // ── 13. Redis session cache ──────────────────────────────────────────────
    await run("cache.redis_session", async () => {
      const redis = getRedisClient();
      const patterns = [
        `session:${userId}:*`,
        `user:${userId}:*`,
        `bot:${userId}:*`,
      ];

      for (const pattern of patterns) {
        let cursor = "0";
        do {
          const [nextCursor, keys] = await redis.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            "100"
          );
          cursor = nextCursor;
          if (keys.length > 0) {
            await redis.del(...keys);
          }
        } while (cursor !== "0");
      }
    });

    const completedAt = new Date();

    // ── Audit the erasure ────────────────────────────────────────────────────
    // Note: audit log entry uses a hash of the userId so the audit trail
    // survives without exposing the deleted subject's identity.
    const { createHash } = await import("crypto");
    const subjectIdHash = createHash("sha256")
      .update(userId)
      .digest("hex");

    await auditLogService.log({
      action: AuditAction.USER_DELETED,
      severity:
        stepsFailed.length > 0 ? AuditSeverity.WARNING : AuditSeverity.INFO,
      resource: "user_erasure",
      metadata: {
        subjectIdHash,
        reason,
        requestedBy,
        stepsCompleted: stepsCompleted.length,
        stepsFailed: stepsFailed.length,
        cryptoErasurePerformed,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    });

    const result: ErasureResult = {
      userId,
      startedAt,
      completedAt,
      stepsCompleted,
      stepsFailed,
      cryptoErasurePerformed,
    };

    logger.info("User erasure completed", {
      userId,
      stepsCompleted: stepsCompleted.length,
      stepsFailed: stepsFailed.length,
      cryptoErasurePerformed,
    });

    return result;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const deletionCoordinator = new DeletionCoordinator();
