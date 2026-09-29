/**
 * intervention.routes.ts
 *
 * REST API for operator interventions on stuck/failed durable executions.
 *
 * All routes require admin authentication.
 *
 * POST   /api/admin/interventions/submit           Submit a signed intervention
 * POST   /api/admin/interventions/dry-run          Submit a dry-run preview
 * GET    /api/admin/interventions/executions/:id   List interventions for an execution
 * GET    /api/admin/interventions/:id              Get a single intervention record
 * POST   /api/admin/interventions/sign-helper      Helper: compute canonical payload for signing
 *
 * Signature flow (callers must implement)
 * ────────────────────────────────────────
 * 1. Construct the canonical payload:
 *      JSON.stringify({command, executionId, stepNumber, payload, nonce, issuedAt})
 *    with those exact keys in that order.
 * 2. Compute HMAC-SHA256 over that string using INTERVENTION_SIGNING_SECRET.
 * 3. Submit the full SignedInterventionCommand via POST /submit.
 *
 * The /sign-helper endpoint returns the canonical string so operators can
 * verify their own signing logic without hardcoding it.
 */

import { Router, Request, Response } from "express";
import * as crypto from "crypto";
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireAdminAuth } from "../../Gateway/middleware/adminAuth";
import {
  interventionService,
  PreconditionViolationError,
} from "../planner/intervention.service";
import {
  InterventionCommand,
  SignedInterventionCommand,
} from "../planner/intervention.types";
import { auditLogService } from "../../AuditLog/auditLog.service";
import {
  AuditEventSeverity,
  EventCategory,
} from "../../AuditLog/auditEvent.types";
import logger from "../../config/logger";

const router = Router();

router.use(authenticateToken);

// ─── Validation helpers ───────────────────────────────────────────────────────

const VALID_COMMANDS = new Set<string>(Object.values(InterventionCommand));

function validateSignedCommand(
  body: unknown
): { ok: true; cmd: SignedInterventionCommand } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const b = body as Record<string, unknown>;

  if (!b.command || !VALID_COMMANDS.has(b.command as string)) {
    errors.push(
      `command must be one of: ${[...VALID_COMMANDS].join(", ")}`
    );
  }

  if (typeof b.executionId !== "string" || !b.executionId.trim()) {
    errors.push("executionId (string) is required");
  }

  if (typeof b.operatorId !== "string" || !b.operatorId.trim()) {
    errors.push("operatorId (string) is required");
  }

  if (typeof b.signature !== "string" || !b.signature.trim()) {
    errors.push("signature (hex string) is required");
  }

  if (typeof b.nonce !== "string" || !b.nonce.trim()) {
    errors.push("nonce (string) is required");
  }

  if (typeof b.issuedAt !== "string" || !b.issuedAt.trim()) {
    errors.push("issuedAt (ISO-8601 string) is required");
  }

  if (!b.payload || typeof b.payload !== "object" || Array.isArray(b.payload)) {
    errors.push("payload (object) is required");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    cmd: {
      command: b.command as InterventionCommand,
      executionId: b.executionId as string,
      stepNumber:
        typeof b.stepNumber === "number" ? b.stepNumber : undefined,
      payload: b.payload as SignedInterventionCommand["payload"],
      dryRun: Boolean(b.dryRun),
      operatorId: b.operatorId as string,
      signature: b.signature as string,
      nonce: b.nonce as string,
      issuedAt: b.issuedAt as string,
    },
  };
}

// ─── POST /submit ─────────────────────────────────────────────────────────────

/**
 * Submit a signed intervention command.
 *
 * Body: SignedInterventionCommand (with dryRun: false)
 *
 * Returns:
 *   201  — APPLIED or PENDING_APPROVAL
 *   400  — Validation error or precondition violation
 *   403  — Signature verification failed
 *   500  — Unexpected error
 */
router.post(
  "/submit",
  requireAdminAuth(),
  async (req: Request, res: Response) => {
    const validation = validateSignedCommand(req.body);
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        message: "Invalid request body",
        errors: validation.errors,
      });
    }

    const cmd = { ...validation.cmd, dryRun: false };

    try {
      const result = await interventionService.submit(cmd);

      await auditLogService.logEvent({
        action: "execution.intervention.submit" as never,
        category: EventCategory.EXECUTION,
        severity: AuditEventSeverity.WARNING,
        actor: { userId: req.user?.userId, roles: [req.user?.role] },
        resource: { type: "DurableExecution", id: cmd.executionId },
        metadata: {
          command: cmd.command,
          stepNumber: cmd.stepNumber,
          interventionId: result.interventionId,
          status: result.status,
        },
        success: true,
      });

      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unexpected error";

      if (err instanceof PreconditionViolationError) {
        return res.status(400).json({
          success: false,
          message,
          violations: err.violations,
        });
      }

      // Signature and signing-secret errors → 403
      if (
        message.includes("Signature verification failed") ||
        message.includes("INTERVENTION_SIGNING_SECRET") ||
        message.includes("expired")
      ) {
        return res.status(403).json({ success: false, message });
      }

      logger.error("Intervention submit failed", {
        error: err,
        executionId: cmd.executionId,
        command: cmd.command,
      });
      return res
        .status(500)
        .json({ success: false, message: "Failed to submit intervention" });
    }
  }
);

// ─── POST /dry-run ────────────────────────────────────────────────────────────

/**
 * Submit a signed intervention command in dry-run mode.
 * Returns a DryRunOutput preview — nothing is committed.
 *
 * Body: SignedInterventionCommand (dryRun is ignored; always set to true)
 *
 * Returns:
 *   200  — DryRunOutput
 *   400  — Validation error
 *   403  — Signature verification failed
 */
router.post(
  "/dry-run",
  requireAdminAuth(),
  async (req: Request, res: Response) => {
    const validation = validateSignedCommand(req.body);
    if (!validation.ok) {
      return res.status(400).json({
        success: false,
        message: "Invalid request body",
        errors: validation.errors,
      });
    }

    const cmd = { ...validation.cmd, dryRun: true };

    try {
      const result = await interventionService.submit(cmd);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unexpected error";

      if (err instanceof PreconditionViolationError) {
        return res.status(400).json({
          success: false,
          message,
          violations: err.violations,
        });
      }

      if (
        message.includes("Signature verification failed") ||
        message.includes("INTERVENTION_SIGNING_SECRET") ||
        message.includes("expired")
      ) {
        return res.status(403).json({ success: false, message });
      }

      logger.error("Intervention dry-run failed", { error: err });
      return res
        .status(500)
        .json({ success: false, message: "Failed to run dry-run" });
    }
  }
);

// ─── GET /executions/:executionId ─────────────────────────────────────────────

/**
 * List all intervention records for a specific execution, newest first.
 *
 * Returns:
 *   200  — InterventionRecord[]
 *   500  — Unexpected error
 */
router.get(
  "/executions/:executionId",
  requireAdminAuth(),
  async (req: Request, res: Response) => {
    try {
      const { executionId } = req.params;
      const records = await interventionService.listForExecution(executionId);
      return res.status(200).json({
        success: true,
        data: records,
        total: records.length,
      });
    } catch (err) {
      logger.error("Failed to list interventions for execution", { error: err });
      return res.status(500).json({
        success: false,
        message: "Failed to list interventions",
      });
    }
  }
);

// ─── GET /:id ─────────────────────────────────────────────────────────────────

/**
 * Get a single intervention record by ID.
 *
 * Returns:
 *   200  — InterventionRecord
 *   404  — Not found
 */
router.get(
  "/:id",
  requireAdminAuth(),
  async (req: Request, res: Response) => {
    try {
      const record = await interventionService.getRecord(req.params.id);
      if (!record) {
        return res.status(404).json({
          success: false,
          message: "Intervention record not found",
        });
      }
      return res.status(200).json({ success: true, data: record });
    } catch (err) {
      logger.error("Failed to get intervention record", { error: err });
      return res.status(500).json({
        success: false,
        message: "Failed to get intervention record",
      });
    }
  }
);

// ─── POST /sign-helper ────────────────────────────────────────────────────────

/**
 * Signing helper endpoint.
 *
 * Returns the canonical JSON string that must be HMAC-signed to produce a
 * valid signature.  The actual HMAC computation must be done by the caller
 * with INTERVENTION_SIGNING_SECRET — that secret is never exposed here.
 *
 * Body: { command, executionId, stepNumber?, payload, nonce, issuedAt }
 *
 * Returns:
 *   200  — { canonical: string, algorithm: "hmac-sha256", note: string }
 */
router.post(
  "/sign-helper",
  requireAdminAuth(),
  async (req: Request, res: Response) => {
    const {
      command,
      executionId,
      stepNumber,
      payload,
      nonce,
      issuedAt,
    } = req.body as {
      command?: string;
      executionId?: string;
      stepNumber?: number;
      payload?: unknown;
      nonce?: string;
      issuedAt?: string;
    };

    const errors: string[] = [];
    if (!command) errors.push("command is required");
    if (!executionId) errors.push("executionId is required");
    if (!payload) errors.push("payload is required");
    if (!nonce) errors.push("nonce is required");
    if (!issuedAt) errors.push("issuedAt is required");

    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const canonical = JSON.stringify({
      command,
      executionId,
      stepNumber: stepNumber ?? null,
      payload,
      nonce,
      issuedAt,
    });

    // Provide a test HMAC so operators can verify their signing library
    // Only generated in non-production so the secret is never leaked
    let testHmac: string | undefined;
    if (process.env.NODE_ENV !== "production") {
      const secret = process.env.INTERVENTION_SIGNING_SECRET;
      if (secret) {
        testHmac = crypto
          .createHmac("sha256", secret)
          .update(canonical)
          .digest("hex");
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        canonical,
        algorithm: "hmac-sha256",
        ...(testHmac ? { testHmac } : {}),
        note:
          "Compute HMAC-SHA256(canonical, INTERVENTION_SIGNING_SECRET) and submit as `signature`.",
      },
    });
  }
);

export default router;
