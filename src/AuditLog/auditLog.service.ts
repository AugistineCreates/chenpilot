/**
 * auditLog.service.ts  (Issue #344 — Security-Grade Audit Ledger)
 *
 * AuditService responsibilities:
 *   1. Ingest events via the typed CreateAuditEventParams interface
 *   2. Infer EventCategory from action prefix when not supplied
 *   3. Scrub payloads for PII before persistence (redactPayload)
 *   4. Compute SHA-256 event hash and chain to previous event hash
 *   5. Provide SecOps-grade query methods (by category, correlation, actor)
 *   6. Expose legacy log/logFromRequest API for backward-compat
 */

import crypto from "crypto";
import { Repository } from "typeorm";
import { Request } from "express";
import AppDataSource from "../config/Datasource";
import { AuditLog, AuditAction, AuditSeverity } from "./auditLog.entity";
import {
  EventCategory,
  AuditEventSeverity,
  AuditEventAction,
  CreateAuditEventParams,
  AuditEventQuery,
} from "./auditEvent.types";
import { redactPayload, generateCorrelationId } from "./auditLog.redaction";
import logger from "../config/logger";

// ─── Category Inference ───────────────────────────────────────────────────────

const ACTION_PREFIX_MAP: Record<string, EventCategory> = {
  "auth.": EventCategory.AUTH,
  "admin.": EventCategory.ADMIN,
  "execution.": EventCategory.EXECUTION,
  "policy.": EventCategory.POLICY,
  "integration.": EventCategory.INTEGRATION,
};

/** Derive EventCategory from a typed action string prefix. */
function inferCategory(action: string): EventCategory {
  for (const [prefix, category] of Object.entries(ACTION_PREFIX_MAP)) {
    if (action.startsWith(prefix)) return category;
  }
  // Legacy flat action names — map to best-guess bucket
  if (
    action.includes("login") ||
    action.includes("logout") ||
    action.includes("token") ||
    action.includes("password") ||
    action.includes("email_verification")
  )
    return EventCategory.AUTH;

  if (
    action.includes("trade") ||
    action.includes("swap") ||
    action.includes("transfer") ||
    action.includes("wallet")
  )
    return EventCategory.EXECUTION;

  if (
    action.includes("unauthorized") ||
    action.includes("permission") ||
    action.includes("suspicious") ||
    action.includes("data_export") ||
    action.includes("sensitive")
  )
    return EventCategory.POLICY;

  if (
    action.includes("user_created") ||
    action.includes("user_updated") ||
    action.includes("user_deleted") ||
    action.includes("bot_command")
  )
    return EventCategory.ADMIN;

  return EventCategory.POLICY; // safe default
}

// ─── Hash Chain ───────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 event hash over the event's immutable canonical fields.
 * Any mutation of these fields after insertion will break hash verification.
 */
function computeEventHash(fields: {
  id: string;
  correlationId?: string;
  action: string;
  category?: EventCategory;
  actorId?: string;
  userId?: string;
  success: boolean;
  createdAt: string;
  previousHash?: string;
}): string {
  const canonical = JSON.stringify(fields, Object.keys(fields).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// ─── Legacy Interface (backward-compat) ───────────────────────────────────────

export interface CreateAuditLogParams {
  userId?: string;
  action: AuditAction | string;
  severity?: AuditSeverity | AuditEventSeverity;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
  success?: boolean;
  correlationId?: string;
}

export interface AuditLogQuery {
  userId?: string;
  action?: AuditAction | AuditEventAction;
  severity?: AuditSeverity | AuditEventSeverity;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  limit?: number;
  offset?: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class AuditLogService {
  private repo: Repository<AuditLog>;

  constructor() {
    this.repo = AppDataSource.getRepository(AuditLog);
  }

  // ── Core Ingestion ─────────────────────────────────────────────────────────

  /**
   * Primary ingestion method — accepts the full typed CreateAuditEventParams.
   *
   * Pipeline:
   *   1. Resolve correlation ID
   *   2. Infer category if not supplied
   *   3. Redact metadata for PII/secrets
   *   4. Fetch previous event hash for chain integrity
   *   5. Compute this event's hash
   *   6. Persist to DB
   */
  async logEvent(params: CreateAuditEventParams): Promise<AuditLog> {
    try {
      const correlationId = params.correlationId ?? generateCorrelationId();
      const category = params.category ?? inferCategory(String(params.action));
      const severity =
        params.severity ??
        (params.success === false
          ? AuditEventSeverity.WARNING
          : AuditEventSeverity.INFO);

      // Scrub metadata before persistence
      const cleanMetadata = params.metadata
        ? (redactPayload(params.metadata) as Record<string, unknown>)
        : undefined;

      const actorId =
        params.actor?.userId ?? params.actor?.serviceId ?? undefined;

      // Fetch the most recent event hash to build the chain
      const previousEvent = await this.repo.findOne({
        where: {},
        order: { createdAt: "DESC" },
        select: ["eventHash"],
      });
      const previousHash = previousEvent?.eventHash ?? undefined;

      // Build a temporary record to derive the hash
      const now = new Date();
      const tempId = crypto.randomUUID();

      const eventHash = computeEventHash({
        id: tempId,
        correlationId,
        action: String(params.action),
        category,
        actorId,
        userId: params.actor?.userId,
        success: params.success ?? true,
        createdAt: now.toISOString(),
        previousHash,
      });

      const entry = this.repo.create({
        id: tempId,
        correlationId,
        action: String(params.action),
        category,
        severity: severity as AuditSeverity,
        actorId,
        userId: params.actor?.userId,
        actorServiceId: params.actor?.serviceId,
        actorRoles: params.actor?.roles,
        ipAddress: params.actor?.ipAddress,
        userAgent: params.actor?.userAgent,
        resource: params.resource?.endpoint,
        metadata: cleanMetadata,
        errorMessage: params.errorMessage,
        success: params.success ?? true,
        eventHash,
        previousHash,
      });

      const saved = await this.repo.save(entry);

      logger.info("Audit event ingested", {
        auditEventId: saved.id,
        correlationId,
        action: params.action,
        category,
        severity,
        actorId,
      });

      return saved;
    } catch (error) {
      logger.error("Failed to ingest audit event", { error, params });
      throw error;
    }
  }

  /**
   * Legacy compatibility shim — accepts the old CreateAuditLogParams shape
   * and delegates to logEvent.
   */
  async log(params: CreateAuditLogParams): Promise<AuditLog> {
    return this.logEvent({
      correlationId: params.correlationId,
      action: params.action as AuditEventAction,
      severity: params.severity as AuditEventSeverity,
      actor: {
        userId: params.userId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
      resource: params.resource ? { endpoint: params.resource } : undefined,
      metadata: params.metadata,
      errorMessage: params.errorMessage,
      success: params.success,
    });
  }

  /**
   * Log from Express request context (legacy compat).
   */
  async logFromRequest(
    req: Request,
    action: AuditAction | string,
    options: Partial<CreateAuditLogParams> = {}
  ): Promise<AuditLog> {
    const ipAddress =
      ((req.headers["x-forwarded-for"] as string) ?? "")
        .split(",")[0]
        ?.trim() ||
      (req.headers["x-real-ip"] as string) ||
      req.socket.remoteAddress ||
      "unknown";

    const correlationId =
      (req as Request & { correlationId?: string }).correlationId ??
      (req.headers["x-correlation-id"] as string | undefined) ??
      generateCorrelationId();

    return this.log({
      userId: req.user?.userId,
      action,
      ipAddress,
      userAgent: req.headers["user-agent"],
      correlationId,
      ...options,
    });
  }

  // ── SecOps Query Methods ───────────────────────────────────────────────────

  /**
   * General-purpose query with full filter support (new fields included).
   */
  async queryEvents(params: AuditEventQuery): Promise<{
    events: AuditLog[];
    total: number;
  }> {
    const qb = this.repo.createQueryBuilder("audit");

    if (params.correlationId) {
      qb.andWhere("audit.correlationId = :correlationId", {
        correlationId: params.correlationId,
      });
    }
    if (params.userId) {
      qb.andWhere("audit.userId = :userId", { userId: params.userId });
    }
    if (params.action) {
      qb.andWhere("audit.action = :action", { action: params.action });
    }
    if (params.category) {
      qb.andWhere("audit.category = :category", {
        category: params.category,
      });
    }
    if (params.severity) {
      qb.andWhere("audit.severity = :severity", {
        severity: params.severity,
      });
    }
    if (params.success !== undefined) {
      qb.andWhere("audit.success = :success", { success: params.success });
    }
    if (params.startDate) {
      qb.andWhere("audit.createdAt >= :startDate", {
        startDate: params.startDate,
      });
    }
    if (params.endDate) {
      qb.andWhere("audit.createdAt <= :endDate", {
        endDate: params.endDate,
      });
    }

    const total = await qb.getCount();
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    qb.orderBy("audit.createdAt", "DESC").skip(offset).take(limit);
    const events = await qb.getMany();

    return { events, total };
  }

  /**
   * Retrieve the full distributed trace for a given correlation ID —
   * every event across all service boundaries for one user request.
   */
  async getByCorrelationId(correlationId: string): Promise<AuditLog[]> {
    return this.repo.find({
      where: { correlationId },
      order: { createdAt: "ASC" },
    });
  }

  /**
   * Retrieve all events in a taxonomy category over a time window.
   */
  async getByCategory(
    category: EventCategory,
    hours = 24,
    limit = 100
  ): Promise<AuditLog[]> {
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);

    return this.repo
      .createQueryBuilder("audit")
      .where("audit.category = :category", { category })
      .andWhere("audit.createdAt >= :startDate", { startDate })
      .orderBy("audit.createdAt", "DESC")
      .limit(limit)
      .getMany();
  }

  /**
   * Retrieve the full timeline for a specific actor (user or service).
   */
  async getActorTimeline(
    actorId: string,
    limit = 50,
    offset = 0
  ): Promise<{ events: AuditLog[]; total: number }> {
    const qb = this.repo
      .createQueryBuilder("audit")
      .where("audit.actorId = :actorId", { actorId })
      .orderBy("audit.createdAt", "DESC");

    const total = await qb.getCount();
    qb.skip(offset).take(limit);
    const events = await qb.getMany();
    return { events, total };
  }

  /**
   * Verify the integrity of the hash chain.
   * Returns the first broken link found, or null if the chain is intact.
   */
  async verifyChainIntegrity(limit = 1000): Promise<{
    intact: boolean;
    brokenAt?: string;
    checkedCount: number;
  }> {
    const events = await this.repo.find({
      order: { createdAt: "ASC" },
      take: limit,
      select: [
        "id",
        "correlationId",
        "action",
        "category",
        "actorId",
        "userId",
        "success",
        "createdAt",
        "eventHash",
        "previousHash",
      ],
    });

    let checkedCount = 0;
    for (const event of events) {
      if (!event.eventHash) continue;

      const expected = computeEventHash({
        id: event.id,
        correlationId: event.correlationId,
        action: event.action,
        category: event.category,
        actorId: event.actorId,
        userId: event.userId,
        success: event.success,
        createdAt: event.createdAt.toISOString(),
        previousHash: event.previousHash,
      });

      if (expected !== event.eventHash) {
        return { intact: false, brokenAt: event.id, checkedCount };
      }
      checkedCount++;
    }

    return { intact: true, checkedCount };
  }

  // ── Legacy Query Shims ─────────────────────────────────────────────────────

  async query(params: AuditLogQuery): Promise<{
    logs: AuditLog[];
    total: number;
  }> {
    const { events, total } = await this.queryEvents({
      userId: params.userId,
      action: params.action as AuditEventAction,
      severity: params.severity as AuditEventSeverity,
      success: params.success,
      startDate: params.startDate,
      endDate: params.endDate,
      limit: params.limit,
      offset: params.offset,
    });
    return { logs: events, total };
  }

  async getUserAuditLogs(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<{ logs: AuditLog[]; total: number }> {
    return this.query({ userId, limit, offset });
  }

  async getFailedAuthAttempts(
    userId?: string,
    hours = 24
  ): Promise<AuditLog[]> {
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);
    const { logs } = await this.query({
      userId,
      action: AuditAction.LOGIN_FAILED,
      startDate,
      success: false,
    });
    return logs;
  }

  async getSecurityEvents(hours = 24, limit = 100): Promise<AuditLog[]> {
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);
    return this.repo
      .createQueryBuilder("audit")
      .where("audit.createdAt >= :startDate", { startDate })
      .andWhere("audit.severity IN (:...severities)", {
        severities: [AuditSeverity.WARNING, AuditSeverity.CRITICAL],
      })
      .orderBy("audit.createdAt", "DESC")
      .limit(limit)
      .getMany();
  }

  async deleteOldLogs(daysToKeep = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where("createdAt < :cutoffDate", { cutoffDate })
      .execute();

    logger.info("Deleted old audit logs", {
      deletedCount: result.affected,
      cutoffDate,
    });
    return result.affected ?? 0;
  }
}

export const auditLogService = new AuditLogService();
