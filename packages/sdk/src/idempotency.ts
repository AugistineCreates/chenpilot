import { createHash, randomUUID } from "crypto";
import {
  IdempotencyTrackerConfig,
  IdempotencyWorkflow,
  IdempotencyStep,
  StepRecoveryPlan,
  StepExecutor,
  StepExecutionOptions,
  StepRecoveryStrategyFn,
  VaultOperationRequest,
} from "./types";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const obj = value as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize(obj[key]);
      return acc;
    }, {});
}

export class IdempotencyTracker {
  private workflows: Map<string, IdempotencyWorkflow> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(private defaultTtl: number = 86_400_000) {
    this.startCleanup();
  }

  startWorkflow(config: IdempotencyTrackerConfig): IdempotencyWorkflow {
    const existing = this.findActiveWorkflow(
      config.namespace,
      config.workflowId
    );
    if (existing) {
      return existing;
    }

    const idempotencyKey = this.generateWorkflowKey(config);
    const workflow: IdempotencyWorkflow = {
      idempotencyKey,
      namespace: config.namespace,
      workflowId: config.workflowId,
      status: "active",
      steps: new Map(),
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      ttl: config.ttl ?? this.defaultTtl,
    };

    this.workflows.set(idempotencyKey, workflow);
    return workflow;
  }

  registerStep(
    workflowKey: string,
    stepId: string,
    stepName: string
  ): IdempotencyStep {
    const workflow = this.workflows.get(workflowKey);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowKey}`);
    }

    const existing = workflow.steps.get(stepId);
    if (existing) {
      return existing;
    }

    const step: IdempotencyStep = {
      stepId,
      stepName,
      status: "pending",
      idempotencyKey: this.generateStepKey(workflowKey, stepId),
      lastUpdated: Date.now(),
      retryCount: 0,
    };

    workflow.steps.set(stepId, step);
    workflow.lastUpdated = Date.now();
    return step;
  }

  registerSteps(
    workflowKey: string,
    steps: Array<{ stepId: string; stepName: string }>
  ): IdempotencyStep[] {
    return steps.map((s) =>
      this.registerStep(workflowKey, s.stepId, s.stepName)
    );
  }

  startStep(
    workflowKey: string,
    stepId: string
  ): { shouldExecute: boolean; step: IdempotencyStep } {
    const workflow = this.workflows.get(workflowKey);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowKey}`);
    }

    const step = workflow.steps.get(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId} in workflow ${workflowKey}`);
    }

    if (step.status === "completed") {
      return { shouldExecute: false, step };
    }

    if (step.status === "in_progress") {
      step.retryCount += 1;
    } else {
      step.status = "in_progress";
    }

    step.lastUpdated = Date.now();
    workflow.lastUpdated = Date.now();
    return { shouldExecute: true, step };
  }

  completeStep(
    workflowKey: string,
    stepId: string,
    result?: unknown
  ): IdempotencyStep {
    const workflow = this.workflows.get(workflowKey);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowKey}`);
    }

    const step = workflow.steps.get(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId} in workflow ${workflowKey}`);
    }

    step.status = "completed";
    step.result = result;
    step.lastUpdated = Date.now();
    workflow.lastUpdated = Date.now();

    this.checkWorkflowCompletion(workflow);
    return step;
  }

  failStep(
    workflowKey: string,
    stepId: string,
    error: string
  ): IdempotencyStep {
    const workflow = this.workflows.get(workflowKey);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowKey}`);
    }

    const step = workflow.steps.get(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId} in workflow ${workflowKey}`);
    }

    step.status = "failed";
    step.error = error;
    step.lastUpdated = Date.now();
    workflow.lastUpdated = Date.now();

    this.checkWorkflowCompletion(workflow);
    return step;
  }

  skipStep(workflowKey: string, stepId: string): IdempotencyStep {
    const workflow = this.workflows.get(workflowKey);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowKey}`);
    }

    const step = workflow.steps.get(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId} in workflow ${workflowKey}`);
    }

    step.status = "skipped";
    step.lastUpdated = Date.now();
    workflow.lastUpdated = Date.now();

    this.checkWorkflowCompletion(workflow);
    return step;
  }

  getWorkflow(workflowKey: string): IdempotencyWorkflow | undefined {
    return this.workflows.get(workflowKey);
  }

  findActiveWorkflow(
    namespace: string,
    workflowId: string
  ): IdempotencyWorkflow | undefined {
    for (const workflow of this.workflows.values()) {
      if (
        workflow.namespace === namespace &&
        workflow.workflowId === workflowId &&
        workflow.status === "active"
      ) {
        return workflow;
      }
    }
    return undefined;
  }

  isStepCompleted(workflowKey: string, stepId: string): boolean {
    const workflow = this.workflows.get(workflowKey);
    if (!workflow) return false;
    const step = workflow.steps.get(stepId);
    return step?.status === "completed" || step?.status === "skipped";
  }

  getCompletedSteps(workflowKey: string): IdempotencyStep[] {
    const workflow = this.workflows.get(workflowKey);
    if (!workflow) return [];
    return Array.from(workflow.steps.values()).filter(
      (s) => s.status === "completed" || s.status === "skipped"
    );
  }

  getPendingSteps(workflowKey: string): IdempotencyStep[] {
    const workflow = this.workflows.get(workflowKey);
    if (!workflow) return [];
    return Array.from(workflow.steps.values()).filter(
      (s) => s.status === "pending" || s.status === "failed"
    );
  }

  getFailedSteps(workflowKey: string): IdempotencyStep[] {
    const workflow = this.workflows.get(workflowKey);
    if (!workflow) return [];
    return Array.from(workflow.steps.values()).filter(
      (s) => s.status === "failed"
    );
  }

  getStep(workflowKey: string, stepId: string): IdempotencyStep | undefined {
    const workflow = this.workflows.get(workflowKey);
    return workflow?.steps.get(stepId);
  }

  resetStep(workflowKey: string, stepId: string): IdempotencyStep {
    const workflow = this.workflows.get(workflowKey);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowKey}`);
    }

    const step = workflow.steps.get(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId} in workflow ${workflowKey}`);
    }

    step.status = "pending";
    step.error = undefined;
    step.result = undefined;
    step.lastUpdated = Date.now();
    workflow.lastUpdated = Date.now();

    if (workflow.status === "failed") {
      workflow.status = "active";
    }

    return step;
  }

  resetFailedSteps(workflowKey: string): IdempotencyStep[] {
    const failedSteps = this.getFailedSteps(workflowKey);
    return failedSteps.map((s) => this.resetStep(workflowKey, s.stepId));
  }

  removeWorkflow(workflowKey: string): boolean {
    return this.workflows.delete(workflowKey);
  }

  clearExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, workflow] of this.workflows.entries()) {
      if (now - workflow.lastUpdated > workflow.ttl) {
        this.workflows.delete(key);
        removed++;
      }
    }
    return removed;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.workflows.clear();
  }

  private generateWorkflowKey(config: IdempotencyTrackerConfig): string {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify(
          canonicalize({
            namespace: config.namespace,
            workflowId: config.workflowId,
          })
        )
      )
      .digest("hex")
      .slice(0, 16);
    const requestId = config.clientRequestId ?? randomUUID();
    return `wf:${config.namespace}:${fingerprint}:${requestId}`;
  }

  private generateStepKey(workflowKey: string, stepId: string): string {
    return `${workflowKey}:step:${stepId}`;
  }

  private checkWorkflowCompletion(workflow: IdempotencyWorkflow): void {
    const allSteps = Array.from(workflow.steps.values());
    if (allSteps.length === 0) return;

    const allTerminal = allSteps.every(
      (s) =>
        s.status === "completed" ||
        s.status === "skipped" ||
        s.status === "failed"
    );

    if (allTerminal) {
      const hasFailed = allSteps.some((s) => s.status === "failed");
      workflow.status = hasFailed ? "failed" : "completed";
      workflow.lastUpdated = Date.now();
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.clearExpired();
    }, 60_000);
    if (this.cleanupTimer && typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }
}

export class StepRecoveryManager {
  private recoveryStrategies: Map<string, StepRecoveryStrategyFn> = new Map();

  setRecoveryStrategy(stepId: string, strategy: StepRecoveryStrategyFn): void {
    this.recoveryStrategies.set(stepId, strategy);
  }

  removeRecoveryStrategy(stepId: string): void {
    this.recoveryStrategies.delete(stepId);
  }

  getRecoveryPlan(workflow: IdempotencyWorkflow): StepRecoveryPlan {
    const stepsToRetry: string[] = [];
    const stepsToSkip: string[] = [];

    for (const [, step] of workflow.steps) {
      if (step.status === "failed") {
        stepsToRetry.push(step.stepId);
      } else if (step.status === "completed" || step.status === "skipped") {
        stepsToSkip.push(step.stepId);
      }
    }

    const hasFailedSteps = stepsToRetry.length > 0;
    const hasPendingSteps = this.hasPendingSteps(workflow);

    let canContinue: boolean;
    let recommendation: string;

    if (!hasFailedSteps && !hasPendingSteps) {
      canContinue = false;
      recommendation = "All steps are completed or skipped. Workflow is done.";
    } else if (hasFailedSteps && !hasPendingSteps) {
      const retryable = stepsToRetry.filter((s) =>
        this.canRetryStep(workflow, s)
      );
      if (retryable.length > 0) {
        canContinue = true;
        recommendation = `Retry failed steps: ${retryable.join(", ")}`;
      } else {
        canContinue = false;
        recommendation = `Failed steps cannot be retried: ${stepsToRetry.join(", ")}. Manual intervention required.`;
      }
    } else if (hasPendingSteps && !hasFailedSteps) {
      canContinue = true;
      recommendation = "Continue with pending steps.";
    } else {
      canContinue = true;
      recommendation = "Retry failed steps and continue with pending steps.";
    }

    return {
      stepsToRetry,
      stepsToSkip,
      canContinue,
      recommendation,
    };
  }

  async continueWorkflow(
    workflow: IdempotencyWorkflow,
    stepExecutor: StepExecutor,
    tracker: IdempotencyTracker,
    options?: StepExecutionOptions
  ): Promise<{ success: boolean; failedStep?: string; error?: string }> {
    const plan = this.getRecoveryPlan(workflow);

    if (!plan.canContinue) {
      return { success: false, error: plan.recommendation };
    }

    for (const stepId of plan.stepsToRetry) {
      tracker.resetStep(workflow.idempotencyKey, stepId);
    }

    const allStepIds = Array.from(workflow.steps.keys());
    for (const stepId of allStepIds) {
      const step = workflow.steps.get(stepId)!;

      if (step.status === "completed" || step.status === "skipped") {
        continue;
      }

      const { shouldExecute } = tracker.startStep(
        workflow.idempotencyKey,
        stepId
      );
      if (!shouldExecute) continue;

      try {
        const strategy = this.recoveryStrategies.get(stepId);
        const maxRetries = strategy?.maxRetries ?? options?.maxRetries ?? 3;
        const retryDelay =
          strategy?.retryDelayMs ?? options?.retryDelayMs ?? 1000;

        let lastError: Error | undefined;
        let success = false;
        let result: unknown;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (attempt > 0) {
            await this.delay(retryDelay * attempt);
          }

          try {
            result = await stepExecutor(stepId, step, attempt);
            success = true;
            break;
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (!this.shouldRetry(stepId, lastError, attempt, maxRetries)) {
              break;
            }
          }
        }

        if (success) {
          tracker.completeStep(workflow.idempotencyKey, stepId, result);
        } else {
          const errorMsg = lastError?.message ?? "Step execution failed";
          tracker.failStep(workflow.idempotencyKey, stepId, errorMsg);
          if (strategy?.onFailure) {
            await strategy.onFailure(step, lastError!);
          }
          return { success: false, failedStep: stepId, error: errorMsg };
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        tracker.failStep(workflow.idempotencyKey, stepId, errorMsg);
        return { success: false, failedStep: stepId, error: errorMsg };
      }
    }

    return { success: true };
  }

  private hasPendingSteps(workflow: IdempotencyWorkflow): boolean {
    return Array.from(workflow.steps.values()).some(
      (s) => s.status === "pending" || s.status === "in_progress"
    );
  }

  private canRetryStep(workflow: IdempotencyWorkflow, stepId: string): boolean {
    const strategy = this.recoveryStrategies.get(stepId);
    if (!strategy) return true;
    return strategy.canRetry !== false;
  }

  private shouldRetry(
    stepId: string,
    error: Error,
    attempt: number,
    maxRetries: number
  ): boolean {
    if (attempt >= maxRetries) return false;
    const strategy = this.recoveryStrategies.get(stepId);
    if (strategy?.shouldRetry) {
      return strategy.shouldRetry(error, attempt);
    }
    return true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createIdempotencyTracker(ttlMs?: number): IdempotencyTracker {
  return new IdempotencyTracker(ttlMs);
}

export function createStepRecoveryManager(): StepRecoveryManager {
  return new StepRecoveryManager();
}

export function generateVaultOperationKey(
  request: VaultOperationRequest
): string {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        canonicalize({
          vaultId: request.vaultId,
          operationType: request.operationType,
          asset: request.asset,
          amount: request.amount,
          destination: request.destination,
        })
      )
    )
    .digest("hex")
    .slice(0, 24);

  return `vault:${request.operationType}:${fingerprint}`;
}

export function createVaultOperationIdempotencyKey(
  request: VaultOperationRequest,
  clientRequestId?: string
): string {
  const key = generateVaultOperationKey(request);
  return clientRequestId ? `${key}:${clientRequestId}` : key;
}
