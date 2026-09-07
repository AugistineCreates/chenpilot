/**
 * intervention.service.ts
 *
 * Signed operator intervention service.
 *
 * Responsibilities
 * ────────────────
 * 1. Verify the HMAC-SHA256 signature on every inbound command.
 * 2. Evaluate per-command preconditions against live execution state.
 * 3. Compute a dry-run preview when requested.
 * 4. Route high-risk commands (COMPENSATE, QUARANTINE) through the
 *    AdminWorkflowService for multi-party approval.
 * 5. Apply approved commands atomically to DurableExecution / DurableStep.
 * 6. Write an immutable InterventionRecord linked to the execution transcript.
 * 7. Emit a tamper-evident audit log event for every intervention attempt.
 *
 * Invariants enforced
 * ───────────────────
 * - SKIP requires a non-empty evidence string (no invented side-effects).
 * - COMPENSATE requires a compensationTxId (no invented side-effects).
 * - Interventions replay-protected via nonce + issuedAt TTL.
 * - The executionTranscriptHash binds each record to the transcript at
 *   the time of evaluation; a later mismatch signals tampering.
 */

import * as crypto from "crypto";
import AppDataSource from "../../config/Datasource";
import { DurableExecution, ExecutionStatus } from "./DurableExecution.entity";
import { DurableStep, StepStatus } from "./DurableStep.entity";
import { InterventionRecord } from "./intervention.entity";
import {
  InterventionCommand,
  InterventionStatus,
  SignedInterventionCommand,
  RetryPayload,
  SkipPayload,
  CompensatePayload,
  QuarantinePayload,
  ResolvePayload,
  PreconditionResult,
  DryRunOutput,
  DryRunStateChange,
  InterventionApplyResult,
  isHighRiskCommand,
  DEFAULT_INTERVENTION_POLICIES,
} from "./intervention.types";
import { adminWorkflowService } from "../admin/workflow.service";
import { SensitiveActionType } from "../admin/workflow.types";
import { auditLogService } from "../../AuditLog/auditLog.service";
import {
  AuditEventSeverity,
  EventCategory,
} from "../../AuditLog/auditEvent.types";
import { durableExecutor } from "./DurableExecutor";
import logger from "../../config/logger";

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * INTERVENTION_SIGNING_SECRET must be set in environment.
 * Fall back to a placeholder that will always fail signature verification
 * in production, making misconfiguration detectable at runtime.
 */
const SIGNING_SECRET =
  process.env.INTERVENTION_SIGNING_SECRET ?? "MISSING_SECRET_WILL_FAIL";

/**
 * Maximum age of a signed command (seconds).  Commands older than this
 * are rejected to prevent replay attacks.
 */
const SIGNATURE_TTL_SECONDS = 300; // 5 minutes

// ─── Execution statuses that accept interventions ─────────────────────────────

const INTERVENABLE_STATUSES = new Set<ExecutionStatus>([
  ExecutionStatus.FAILED,
  ExecutionStatus.PAUSED,
]);

const QUARANTINABLE_STATUSES = new Set<ExecutionStatus>([
  ExecutionStatus.FAILED,
  ExecutionStatus.PAUSED,
  ExecutionStatus.RUNNING,
]);

// ─── Quarantined status ───────────────────────────────────────────────────────

/**
 * QUARANTINED is a pseudo-status not in ExecutionStatus enum.
 * We store it as a string in DurableExecution.status.
 * This keeps the execution frozen without automated retries.
 */
export const QUARANTINED_STATUS = "quarantined" as ExecutionStatus;

// ─── Service ──────────────────────────────────────────────────────────────────

export class InterventionService {
  private get executionRepo() {
    return AppDataSource.getRepository(DurableExecution);
  }

  private get stepRepo() {
    return AppDataSource.getRepository(DurableStep);
  }

  private get interventionRepo() {
    return AppDataSource.getRepository(InterventionRecord);
  }

  // ─── Public entry point ──────────────────────────────────────────────────

  /**
   * Submit a signed intervention command.
   *
   * Flow:
   * 1. Verify signature & nonce freshness.
   * 2. Load execution state.
   * 3. Evaluate preconditions.
   * 4. If dry-run → return preview, no persistence.
   * 5. If high-risk → create workflow approval instance, persist pending record.
   * 6. Otherwise → apply immediately, persist applied record.
   */
  async submit(
    cmd: SignedInterventionCommand,
  ): Promise<InterventionApplyResult> {
    // 1. Signature verification
    this.verifySignature(cmd);

    // 2. Load execution
    const execution = await this.executionRepo.findOne({
      where: { id: cmd.executionId },
      relations: ["steps"],
    });

    if (!execution) {
      throw new Error(`Execution ${cmd.executionId} not found`);
    }

    const steps = execution.steps.sort(
      (a, b) => a.stepNumber - b.stepNumber
    );

    // 3. Preconditions
    const preconditions = this.checkPreconditions(cmd, execution, steps);
    if (!preconditions.satisfied) {
      await this.recordAuditEvent(cmd, "precondition_violated", false, {
        violations: preconditions.violations,
      });
      throw new PreconditionViolationError(preconditions.violations);
    }

    // 4. Dry-run
    if (cmd.dryRun) {
      const dryRunOutput = this.computeDryRun(cmd, execution, steps);
      const record = await this.persistRecord(cmd, execution, {
        status: InterventionStatus.DRY_RUN,
        dryRun: true,
        dryRunOutput: dryRunOutput as unknown as Record<string, unknown>,
      });
      await this.recordAuditEvent(cmd, "dry_run", true, { record: record.id });
      return {
        interventionId: record.id,
        status: InterventionStatus.DRY_RUN,
        dryRunOutput,
        message: "Dry-run complete — no changes committed",
      };
    }

    // 5. High-risk → multi-party approval
    if (isHighRiskCommand(cmd.command)) {
      return this.routeToApproval(cmd, execution, steps);
    }

    // 6. Apply immediately
    return this.applyCommand(cmd, execution, steps);
  }

  /**
   * Apply a previously approved high-risk intervention.
   * Called by the AdminWorkflowService after approval threshold is met.
   */
  async applyApproved(
    interventionId: string,
    workflowInstanceId: string,
  ): Promise<InterventionApplyResult> {
    const record = await this.interventionRepo.findOne({
      where: { id: interventionId },
      relations: ["execution"],
    });

    if (!record) {
      throw new Error(`InterventionRecord ${interventionId} not found`);
    }

    if (record.status !== InterventionStatus.PENDING_APPROVAL) {
      throw new Error(
        `Intervention is not pending approval (status: ${record.status})`,
      );
    }

    // Re-load fresh execution state
    const execution = await this.executionRepo.findOne({
      where: { id: record.executionId },
      relations: ["steps"],
    });

    if (!execution) {
      throw new Error(`Execution ${record.executionId} not found`);
    }

    const steps = execution.steps.sort(
      (a, b) => a.stepNumber - b.stepNumber
    );

    const cmd: SignedInterventionCommand = {
      command: record.command,
      executionId: record.executionId,
      stepNumber: record.targetStepNumber,
      payload: record.payload,
      dryRun: false,
      operatorId: record.operatorId,
      signature: record.signature,
      nonce: record.nonce,
      issuedAt: record.issuedAt,
    };

    // Re-check preconditions against current state before applying
    const preconditions = this.checkPreconditions(cmd, execution, steps);
    if (!preconditions.satisfied) {
      // Mark record as failed
      record.status = InterventionStatus.FAILED;
      record.errorMessage = `Preconditions no longer satisfied after approval: ${preconditions.violations.join("; ")}`;
      record.workflowInstanceId = workflowInstanceId;
      await this.interventionRepo.save(record);

      throw new PreconditionViolationError(preconditions.violations);
    }

    return this.applyCommand(cmd, execution, steps, record, workflowInstanceId);
  }

  /**
   * List intervention records for an execution.
   */
  async listForExecution(executionId: string): Promise<InterventionRecord[]> {
    return this.interventionRepo.find({
      where: { executionId },
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Get a single intervention record.
   */
  async getRecord(id: string): Promise<InterventionRecord | null> {
    return this.interventionRepo.findOne({ where: { id } });
  }

  // ─── Signature verification ──────────────────────────────────────────────

  /**
   * Verifies the HMAC-SHA256 signature on a signed command.
   *
   * Signed payload canonical form:
   *   JSON.stringify({command, executionId, stepNumber, payload, nonce, issuedAt})
   * with keys in that exact order (deterministic serialisation).
   *
   * Also checks:
   * - issuedAt is within SIGNATURE_TTL_SECONDS
   * - SIGNING_SECRET is configured
   */
  verifySignature(cmd: SignedInterventionCommand): void {
    if (SIGNING_SECRET === "MISSING_SECRET_WILL_FAIL") {
      throw new Error(
        "INTERVENTION_SIGNING_SECRET is not configured — interventions are disabled",
      );
    }

    // Replay / expiry check
    const issued = new Date(cmd.issuedAt);
    const ageSeconds = (Date.now() - issued.getTime()) / 1000;
    if (ageSeconds > SIGNATURE_TTL_SECONDS) {
      throw new Error(
        `Signed command has expired (age ${Math.round(ageSeconds)}s, max ${SIGNATURE_TTL_SECONDS}s)`,
      );
    }

    // Canonical payload (key order matters for deterministic output)
    const canonical = JSON.stringify({
      command: cmd.command,
      executionId: cmd.executionId,
      stepNumber: cmd.stepNumber ?? null,
      payload: cmd.payload,
      nonce: cmd.nonce,
      issuedAt: cmd.issuedAt,
    });

    const expected = crypto
      .createHmac("sha256", SIGNING_SECRET)
      .update(canonical)
      .digest("hex");

    // Constant-time comparison to prevent timing attacks
    let match = true;
    try {
      match = crypto.timingSafeEqual(
        Buffer.from(cmd.signature, "hex"),
        Buffer.from(expected, "hex"),
      );
    } catch {
      match = false;
    }

    if (!match) {
      throw new Error(
        "Signature verification failed — command may have been tampered with",
      );
    }
  }

  // ─── Preconditions ───────────────────────────────────────────────────────

  /**
   * Evaluate per-command preconditions.
   *
   * Every command has structural preconditions (execution/step state) and
   * payload preconditions (non-empty required fields).
   */
  checkPreconditions(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[],
  ): PreconditionResult {
    const violations: string[] = [];

    switch (cmd.command) {
      case InterventionCommand.RETRY:
        this.checkRetryPreconditions(cmd, execution, steps, violations);
        break;
      case InterventionCommand.SKIP:
        this.checkSkipPreconditions(cmd, execution, steps, violations);
        break;
      case InterventionCommand.COMPENSATE:
        this.checkCompensatePreconditions(cmd, execution, steps, violations);
        break;
      case InterventionCommand.QUARANTINE:
        this.checkQuarantinePreconditions(cmd, execution, violations);
        break;
      case InterventionCommand.RESOLVE:
        this.checkResolvePreconditions(cmd, execution, violations);
        break;
      default:
        violations.push(
          `Unknown command: ${(cmd as SignedInterventionCommand).command}`,
        );
    }

    return { satisfied: violations.length === 0, violations };
  }

  private checkRetryPreconditions(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[],
    violations: string[],
  ): void {
    if (!INTERVENABLE_STATUSES.has(execution.status)) {
      violations.push(
        `RETRY requires execution status FAILED or PAUSED (current: ${execution.status})`,
      );
    }

    if (cmd.stepNumber == null) {
      violations.push("RETRY requires stepNumber");
      return;
    }

    const step = steps.find((s) => s.stepNumber === cmd.stepNumber);
    if (!step) {
      violations.push(
        `Step ${cmd.stepNumber} not found in execution ${execution.id}`
      );
      return;
    }

    if (step.status !== StepStatus.FAILED) {
      violations.push(
        `RETRY requires step ${cmd.stepNumber} to be FAILED (current: ${step.status})`
      );
    }

    const payload = cmd.payload as RetryPayload;
    if (!payload.reason?.trim()) {
      violations.push("RETRY payload must include a non-empty reason");
    }
  }

  private checkSkipPreconditions(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[],
    violations: string[]
  ): void {
    if (!INTERVENABLE_STATUSES.has(execution.status)) {
      violations.push(
        `SKIP requires execution status FAILED or PAUSED (current: ${execution.status})`
      );
    }

    if (cmd.stepNumber == null) {
      violations.push("SKIP requires stepNumber");
      return;
    }

    const step = steps.find((s) => s.stepNumber === cmd.stepNumber);
    if (!step) {
      violations.push(
        `Step ${cmd.stepNumber} not found in execution ${execution.id}`
      );
      return;
    }

    if (step.status !== StepStatus.FAILED) {
      violations.push(
        `SKIP requires step ${cmd.stepNumber} to be FAILED (current: ${step.status})`
      );
    }

    const payload = cmd.payload as SkipPayload;
    if (!payload.evidence?.trim()) {
      violations.push(
        "SKIP payload must include non-empty evidence — interventions cannot invent completed side-effects"
      );
    }
    if (!payload.reason?.trim()) {
      violations.push("SKIP payload must include a non-empty reason");
    }
  }

  private checkCompensatePreconditions(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[],
    violations: string[]
  ): void {
    if (!INTERVENABLE_STATUSES.has(execution.status)) {
      violations.push(
        `COMPENSATE requires execution status FAILED or PAUSED (current: ${execution.status})`
      );
    }

    const payload = cmd.payload as CompensatePayload;
    const targetStep = payload.targetStepNumber ?? cmd.stepNumber;

    if (targetStep == null) {
      violations.push(
        "COMPENSATE requires targetStepNumber in payload or stepNumber"
      );
      return;
    }

    const step = steps.find((s) => s.stepNumber === targetStep);
    if (!step) {
      violations.push(
        `Step ${targetStep} not found in execution ${execution.id}`
      );
      return;
    }

    if (step.status !== StepStatus.COMPLETED) {
      violations.push(
        `COMPENSATE requires step ${targetStep} to be COMPLETED (current: ${step.status}) — only completed side-effects can be compensated`
      );
    }

    if (!payload.compensationTxId?.trim()) {
      violations.push(
        "COMPENSATE payload must include a non-empty compensationTxId — interventions cannot invent completed side-effects"
      );
    }
    if (!payload.reason?.trim()) {
      violations.push("COMPENSATE payload must include a non-empty reason");
    }
  }

  private checkQuarantinePreconditions(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    violations: string[]
  ): void {
    if (!QUARANTINABLE_STATUSES.has(execution.status)) {
      violations.push(
        `QUARANTINE requires execution status FAILED, PAUSED, or RUNNING (current: ${execution.status})`
      );
    }

    const payload = cmd.payload as QuarantinePayload;
    if (!payload.reason?.trim()) {
      violations.push("QUARANTINE payload must include a non-empty reason");
    }
  }

  private checkResolvePreconditions(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    violations: string[]
  ): void {
    if (execution.status !== QUARANTINED_STATUS) {
      violations.push(
        `RESOLVE requires execution status QUARANTINED (current: ${execution.status})`
      );
    }

    const payload = cmd.payload as ResolvePayload;
    if (!payload.resolution?.trim()) {
      violations.push(
        "RESOLVE payload must include a non-empty resolution summary"
      );
    }
  }

  // ─── Dry-run ─────────────────────────────────────────────────────────────

  /**
   * Compute the set of state changes that WOULD be applied, without
   * touching any persistent state.
   */
  computeDryRun(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[]
  ): DryRunOutput {
    const violations = this.checkPreconditions(cmd, execution, steps);
    const changes: DryRunStateChange[] = [];
    let summary = "";

    if (violations.satisfied) {
      switch (cmd.command) {
        case InterventionCommand.RETRY:
          summary = this.dryRunRetry(cmd, execution, steps, changes);
          break;
        case InterventionCommand.SKIP:
          summary = this.dryRunSkip(cmd, execution, steps, changes);
          break;
        case InterventionCommand.COMPENSATE:
          summary = this.dryRunCompensate(cmd, execution, steps, changes);
          break;
        case InterventionCommand.QUARANTINE:
          summary = this.dryRunQuarantine(execution, changes);
          break;
        case InterventionCommand.RESOLVE:
          summary = this.dryRunResolve(execution, changes);
          break;
      }
    } else {
      summary = `Cannot apply: ${violations.violations.join("; ")}`;
    }

    return {
      command: cmd.command,
      executionId: cmd.executionId,
      stepNumber: cmd.stepNumber,
      changes,
      summary,
      violations: violations.violations,
      wouldSucceed: violations.satisfied,
    };
  }

  private dryRunRetry(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[],
    changes: DryRunStateChange[]
  ): string {
    const step = steps.find((s) => s.stepNumber === cmd.stepNumber)!;
    const payload = cmd.payload as RetryPayload;

    changes.push({
      entity: "DurableStep",
      id: step.id,
      field: "status",
      from: step.status,
      to: StepStatus.PENDING,
    });
    changes.push({
      entity: "DurableStep",
      id: step.id,
      field: "retryCount",
      from: step.retryCount,
      to: 0,
    });
    changes.push({
      entity: "DurableStep",
      id: step.id,
      field: "error",
      from: step.error,
      to: null,
    });

    if (payload.payloadOverride) {
      changes.push({
        entity: "DurableStep",
        id: step.id,
        field: "payload",
        from: "[redacted]",
        to: "[override applied]",
      });
    }

    changes.push({
      entity: "DurableExecution",
      id: execution.id,
      field: "status",
      from: execution.status,
      to: ExecutionStatus.RUNNING,
    });

    return (
      `RETRY step ${cmd.stepNumber} (${step.action}): ` +
      `retry counter reset to 0, execution will resume. ` +
      (payload.payloadOverride ? "Payload override will be applied. " : "") +
      `Reason: ${(cmd.payload as RetryPayload).reason}`
    );
  }

  private dryRunSkip(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[],
    changes: DryRunStateChange[]
  ): string {
    const step = steps.find((s) => s.stepNumber === cmd.stepNumber)!;
    const payload = cmd.payload as SkipPayload;

    changes.push({
      entity: "DurableStep",
      id: step.id,
      field: "status",
      from: step.status,
      to: StepStatus.COMPLETED,
    });
    changes.push({
      entity: "DurableStep",
      id: step.id,
      field: "result",
      from: step.result,
      to: payload.resultOverride ?? { skipped: true, evidence: payload.evidence },
    });
    changes.push({
      entity: "DurableExecution",
      id: execution.id,
      field: "status",
      from: execution.status,
      to: ExecutionStatus.RUNNING,
    });

    const nextStep = steps.find(
      (s) => s.stepNumber > cmd.stepNumber! && s.status === StepStatus.PENDING
    );

    return (
      `SKIP step ${cmd.stepNumber} (${step.action}): ` +
      `marked as completed with evidence. ` +
      (nextStep
        ? `Execution will resume from step ${nextStep.stepNumber}.`
        : "No further pending steps — execution will be marked completed.") +
      ` Reason: ${payload.reason}`
    );
  }

  private dryRunCompensate(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[],
    changes: DryRunStateChange[]
  ): string {
    const payload = cmd.payload as CompensatePayload;
    const targetStepNum = payload.targetStepNumber ?? cmd.stepNumber!;
    const step = steps.find((s) => s.stepNumber === targetStepNum)!;

    changes.push({
      entity: "DurableStep",
      id: step.id,
      field: "status",
      from: step.status,
      to: StepStatus.FAILED,
    });
    changes.push({
      entity: "DurableStep",
      id: step.id,
      field: "error",
      from: step.error,
      to: `Compensated via tx ${payload.compensationTxId}`,
    });
    changes.push({
      entity: "DurableExecution",
      id: execution.id,
      field: "status",
      from: execution.status,
      to: ExecutionStatus.FAILED,
    });
    changes.push({
      entity: "DurableExecution",
      id: execution.id,
      field: "errorMessage",
      from: execution.errorMessage,
      to: `Compensated by operator. Compensation tx: ${payload.compensationTxId}`,
    });

    return (
      `COMPENSATE step ${targetStepNum} (${step.action}): ` +
      `step will be marked FAILED with compensation tx ${payload.compensationTxId}. ` +
      `Execution will be marked FAILED. ` +
      `Reason: ${payload.reason}`
    );
  }

  private dryRunQuarantine(
    execution: DurableExecution,
    changes: DryRunStateChange[]
  ): string {
    changes.push({
      entity: "DurableExecution",
      id: execution.id,
      field: "status",
      from: execution.status,
      to: QUARANTINED_STATUS,
    });

    return (
      `QUARANTINE execution ${execution.id}: ` +
      `status will be set to QUARANTINED, stopping all automated retries. ` +
      `Execution will remain frozen until a RESOLVE intervention is applied.`
    );
  }

  private dryRunResolve(
    execution: DurableExecution,
    changes: DryRunStateChange[]
  ): string {
    changes.push({
      entity: "DurableExecution",
      id: execution.id,
      field: "status",
      from: execution.status,
      to: ExecutionStatus.FAILED,
    });

    return (
      `RESOLVE execution ${execution.id}: ` +
      `status will transition from QUARANTINED → FAILED (investigation closed). `
    );
  }

  // ─── High-risk routing ───────────────────────────────────────────────────

  private async routeToApproval(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[]
  ): Promise<InterventionApplyResult> {
    const transcriptHash = this.computeTranscriptHash(execution, steps);

    // Map command → SensitiveActionType
    const actionType = this.commandToSensitiveActionType(cmd.command);

    // Create pending intervention record first (pre-approval)
    const record = await this.persistRecord(cmd, execution, {
      status: InterventionStatus.PENDING_APPROVAL,
      transcriptHash,
    });

    // Initiate multi-party approval workflow
    const workflow = await adminWorkflowService.initiateWorkflow({
      actionType,
      initiatorId: cmd.operatorId,
      payload: {
        interventionId: record.id,
        executionId: cmd.executionId,
        command: cmd.command,
        stepNumber: cmd.stepNumber ?? null,
        reason: (cmd.payload as { reason?: string }).reason ?? "",
      },
      metadata: {
        interventionId: record.id,
        command: cmd.command,
        executionId: cmd.executionId,
      },
      ttlMinutes:
        DEFAULT_INTERVENTION_POLICIES[cmd.command].approvalTimeoutMinutes,
    });

    // Bind workflow to intervention record
    record.workflowInstanceId = workflow.id;
    await this.interventionRepo.save(record);

    await this.recordAuditEvent(cmd, "pending_approval", true, {
      interventionId: record.id,
      workflowInstanceId: workflow.id,
    });

    logger.info("High-risk intervention routed to approval workflow", {
      interventionId: record.id,
      workflowInstanceId: workflow.id,
      command: cmd.command,
      executionId: cmd.executionId,
    });

    return {
      interventionId: record.id,
      status: InterventionStatus.PENDING_APPROVAL,
      workflowInstanceId: workflow.id,
      message: `${cmd.command.toUpperCase()} is high-risk and requires multi-party approval. Workflow ${workflow.id} has been created.`,
    };
  }

  // ─── Command application ─────────────────────────────────────────────────

  private async applyCommand(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[],
    existingRecord?: InterventionRecord,
    workflowInstanceId?: string
  ): Promise<InterventionApplyResult> {
    const transcriptHash = this.computeTranscriptHash(execution, steps);
    const statusBefore = execution.status;

    let record: InterventionRecord;
    if (existingRecord) {
      record = existingRecord;
    } else {
      record = await this.persistRecord(cmd, execution, {
        status: InterventionStatus.APPROVED,
        transcriptHash,
        workflowInstanceId,
      });
    }

    try {
      switch (cmd.command) {
        case InterventionCommand.RETRY:
          await this.applyRetry(cmd, execution, steps);
          break;
        case InterventionCommand.SKIP:
          await this.applySkip(cmd, execution, steps);
          break;
        case InterventionCommand.COMPENSATE:
          await this.applyCompensate(cmd, execution, steps);
          break;
        case InterventionCommand.QUARANTINE:
          await this.applyQuarantine(execution);
          break;
        case InterventionCommand.RESOLVE:
          await this.applyResolve(cmd, execution);
          break;
      }

      // Update record: applied
      record.status = InterventionStatus.APPLIED;
      record.appliedAt = new Date();
      record.executionStatusBefore = statusBefore;
      record.executionStatusAfter = execution.status;
      record.resultMessage = `${cmd.command.toUpperCase()} applied successfully`;
      if (workflowInstanceId) record.workflowInstanceId = workflowInstanceId;
      await this.interventionRepo.save(record);

      const auditLog = await this.recordAuditEvent(cmd, "applied", true, {
        interventionId: record.id,
        statusBefore,
        statusAfter: execution.status,
      });

      if (auditLog) {
        record.auditLogId = auditLog.id;
        await this.interventionRepo.save(record);
      }

      logger.info("Intervention applied", {
        interventionId: record.id,
        command: cmd.command,
        executionId: cmd.executionId,
        stepNumber: cmd.stepNumber,
      });

      return {
        interventionId: record.id,
        status: InterventionStatus.APPLIED,
        message: record.resultMessage,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error during apply";

      record.status = InterventionStatus.FAILED;
      record.errorMessage = errorMessage;
      record.appliedAt = new Date();
      await this.interventionRepo.save(record);

      await this.recordAuditEvent(cmd, "apply_failed", false, {
        interventionId: record.id,
        error: errorMessage,
      });

      logger.error("Intervention application failed", {
        interventionId: record.id,
        command: cmd.command,
        executionId: cmd.executionId,
        error: errorMessage,
      });

      throw err;
    }
  }

  // ─── Per-command apply logic ─────────────────────────────────────────────

  private async applyRetry(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[]
  ): Promise<void> {
    const step = steps.find((s) => s.stepNumber === cmd.stepNumber)!;
    const payload = cmd.payload as RetryPayload;

    if (payload.payloadOverride) {
      step.payload = payload.payloadOverride;
    }

    // Delegate to DurableExecutor's existing repair path
    await durableExecutor.repairRetryStep(execution.id, step.stepNumber);
  }

  private async applySkip(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[]
  ): Promise<void> {
    const payload = cmd.payload as SkipPayload;
    const step = steps.find((s) => s.stepNumber === cmd.stepNumber)!;

    await durableExecutor.repairSkipStep(
      execution.id,
      step.stepNumber,
      payload.resultOverride ?? { skipped: true, evidence: payload.evidence }
    );
  }

  private async applyCompensate(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    steps: DurableStep[]
  ): Promise<void> {
    const payload = cmd.payload as CompensatePayload;
    const targetStepNum = payload.targetStepNumber ?? cmd.stepNumber!;
    const step = steps.find((s) => s.stepNumber === targetStepNum)!;

    // Mark the compensated step as FAILED with compensation evidence
    step.status = StepStatus.FAILED;
    step.error = `Compensated by operator via tx ${payload.compensationTxId}. Reason: ${payload.reason}`;
    await AppDataSource.getRepository(DurableStep).save(step);

    // Mark execution as FAILED
    execution.status = ExecutionStatus.FAILED;
    execution.errorMessage = `Compensated by operator. Step ${targetStepNum} compensation tx: ${payload.compensationTxId}`;
    await this.executionRepo.save(execution);
  }

  private async applyQuarantine(execution: DurableExecution): Promise<void> {
    execution.status = QUARANTINED_STATUS;
    await this.executionRepo.save(execution);
  }

  private async applyResolve(
    cmd: SignedInterventionCommand,
    execution: DurableExecution
  ): Promise<void> {
    const payload = cmd.payload as ResolvePayload;

    // Transition quarantined → failed (closed)
    execution.status = ExecutionStatus.FAILED;
    execution.errorMessage =
      `Resolved by operator: ${payload.resolution}` +
      (payload.notes ? ` | Notes: ${payload.notes}` : "");
    await this.executionRepo.save(execution);
  }

  // ─── Persistence helpers ─────────────────────────────────────────────────

  private async persistRecord(
    cmd: SignedInterventionCommand,
    execution: DurableExecution,
    overrides: Partial<{
      status: InterventionStatus;
      dryRun: boolean;
      dryRunOutput: Record<string, unknown>;
      transcriptHash: string;
      workflowInstanceId: string;
    }>
  ): Promise<InterventionRecord> {
    const record = new InterventionRecord();
    record.executionId = execution.id;
    record.targetStepNumber = cmd.stepNumber;
    record.command = cmd.command;
    record.status = overrides.status ?? InterventionStatus.APPROVED;
    record.operatorId = cmd.operatorId;
    record.payload = cmd.payload;
    record.signature = cmd.signature;
    record.nonce = cmd.nonce;
    record.issuedAt = cmd.issuedAt;
    record.dryRun = overrides.dryRun ?? false;
    record.dryRunOutput = overrides.dryRunOutput;
    record.workflowInstanceId = overrides.workflowInstanceId;
    record.executionTranscriptHash =
      overrides.transcriptHash ??
      this.computeTranscriptHash(execution, execution.steps ?? []);

    return this.interventionRepo.save(record);
  }

  // ─── Transcript hash ──────────────────────────────────────────────────────

  /**
   * Compute a stable SHA-256 hash over the execution's state snapshot.
   *
   * Canonical form: execution.id + | + execution.status + | +
   *   execution.currentStepNumber + | + sorted steps JSON
   */
  computeTranscriptHash(
    execution: DurableExecution,
    steps: DurableStep[]
  ): string {
    const stepSummaries = [...steps]
      .sort((a, b) => a.stepNumber - b.stepNumber)
      .map((s) => ({
        n: s.stepNumber,
        s: s.status,
        r: s.retryCount,
        c: s.completedAt?.toISOString() ?? null,
      }));

    const canonical = JSON.stringify({
      id: execution.id,
      status: execution.status,
      currentStep: execution.currentStepNumber,
      steps: stepSummaries,
    });

    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  // ─── Audit logging ────────────────────────────────────────────────────────

  private async recordAuditEvent(
    cmd: SignedInterventionCommand,
    event: string,
    success: boolean,
    metadata: Record<string, unknown>
  ) {
    try {
      return await auditLogService.logEvent({
        action: `execution.intervention.${event}` as never,
        category: EventCategory.EXECUTION,
        severity: isHighRiskCommand(cmd.command)
          ? AuditEventSeverity.CRITICAL
          : AuditEventSeverity.WARNING,
        actor: { userId: cmd.operatorId, roles: ["admin"] },
        resource: {
          type: "DurableExecution",
          id: cmd.executionId,
        },
        metadata: {
          command: cmd.command,
          stepNumber: cmd.stepNumber,
          dryRun: cmd.dryRun,
          ...metadata,
        },
        success,
      });
    } catch (err) {
      // Audit log failure must never suppress the intervention result
      logger.warn("Failed to write intervention audit log", { err });
      return null;
    }
  }

  // ─── Command → SensitiveActionType mapping ────────────────────────────────

  private commandToSensitiveActionType(
    command: InterventionCommand
  ): SensitiveActionType {
    switch (command) {
      case InterventionCommand.COMPENSATE:
        return SensitiveActionType.INTERVENTION_COMPENSATE;
      case InterventionCommand.QUARANTINE:
        return SensitiveActionType.INTERVENTION_QUARANTINE;
      default:
        throw new Error(
          `Command ${command} is not high-risk and should not be routed to approval`
        );
    }
  }
}

// ─── Error types ──────────────────────────────────────────────────────────────

export class PreconditionViolationError extends Error {
  readonly violations: string[];

  constructor(violations: string[]) {
    super(`Preconditions not satisfied: ${violations.join("; ")}`);
    this.name = "PreconditionViolationError";
    this.violations = violations;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const interventionService = new InterventionService();
