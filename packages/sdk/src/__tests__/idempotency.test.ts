import {
  IdempotencyTracker,
  StepRecoveryManager,
  createIdempotencyTracker,
  createStepRecoveryManager,
  generateVaultOperationKey,
  createVaultOperationIdempotencyKey,
} from "../idempotency";
import { IdempotencyWorkflow, VaultOperationRequest } from "../types";

describe("IdempotencyTracker", () => {
  let tracker: IdempotencyTracker;

  beforeEach(() => {
    tracker = createIdempotencyTracker();
  });

  afterEach(() => {
    tracker.destroy();
  });

  it("starts a new workflow", () => {
    const wf = tracker.startWorkflow({
      namespace: "swap",
      workflowId: "wf-001",
    });

    expect(wf.idempotencyKey).toMatch(/^wf:swap:/);
    expect(wf.namespace).toBe("swap");
    expect(wf.workflowId).toBe("wf-001");
    expect(wf.status).toBe("active");
    expect(wf.steps.size).toBe(0);
  });

  it("returns existing workflow on duplicate start", () => {
    const wf1 = tracker.startWorkflow({
      namespace: "swap",
      workflowId: "wf-001",
      clientRequestId: "req-1",
    });

    const wf2 = tracker.startWorkflow({
      namespace: "swap",
      workflowId: "wf-001",
      clientRequestId: "req-1",
    });

    expect(wf1.idempotencyKey).toBe(wf2.idempotencyKey);
  });

  it("registers steps on a workflow", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-002",
    });
    tracker.registerSteps(wf.idempotencyKey, [
      { stepId: "plan", stepName: "Planning" },
      { stepId: "exec", stepName: "Execution" },
    ]);

    expect(wf.steps.size).toBe(2);

    const planStep = wf.steps.get("plan")!;
    expect(planStep.stepName).toBe("Planning");
    expect(planStep.status).toBe("pending");
    expect(planStep.idempotencyKey).toContain(":step:plan");
  });

  it("returns existing step on duplicate register", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-003",
    });
    const s1 = tracker.registerStep(wf.idempotencyKey, "step1", "Step One");
    const s2 = tracker.registerStep(wf.idempotencyKey, "step1", "Step One");

    expect(s1.idempotencyKey).toBe(s2.idempotencyKey);
    expect(s1.stepId).toBe(s2.stepId);
  });

  it("marks step as in_progress and tracks retry count", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-004",
    });
    tracker.registerStep(wf.idempotencyKey, "step1", "Step One");

    const { shouldExecute, step } = tracker.startStep(
      wf.idempotencyKey,
      "step1"
    );
    expect(shouldExecute).toBe(true);
    expect(step.status).toBe("in_progress");

    const { shouldExecute: shouldExecute2, step: step2 } = tracker.startStep(
      wf.idempotencyKey,
      "step1"
    );
    expect(shouldExecute2).toBe(true);
    expect(step2.retryCount).toBe(1);
  });

  it("does not re-execute completed steps", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-005",
    });
    tracker.registerStep(wf.idempotencyKey, "step1", "Step One");
    tracker.startStep(wf.idempotencyKey, "step1");
    tracker.completeStep(wf.idempotencyKey, "step1", { done: true });

    const { shouldExecute } = tracker.startStep(wf.idempotencyKey, "step1");
    expect(shouldExecute).toBe(false);
  });

  it("marks step as completed with result", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-006",
    });
    tracker.registerStep(wf.idempotencyKey, "step1", "Step One");
    tracker.startStep(wf.idempotencyKey, "step1");

    const result = { txHash: "abc123" };
    const completed = tracker.completeStep(wf.idempotencyKey, "step1", result);

    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual(result);
  });

  it("marks step as failed with error", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-007",
    });
    tracker.registerStep(wf.idempotencyKey, "step1", "Step One");
    tracker.startStep(wf.idempotencyKey, "step1");

    const failed = tracker.failStep(
      wf.idempotencyKey,
      "step1",
      "Network error"
    );

    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Network error");
  });

  it("marks step as skipped", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-008",
    });
    tracker.registerStep(wf.idempotencyKey, "step1", "Step One");

    const skipped = tracker.skipStep(wf.idempotencyKey, "step1");
    expect(skipped.status).toBe("skipped");
  });

  it("detects completed workflow", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-009",
    });
    tracker.registerSteps(wf.idempotencyKey, [
      { stepId: "a", stepName: "A" },
      { stepId: "b", stepName: "B" },
    ]);

    tracker.startStep(wf.idempotencyKey, "a");
    tracker.completeStep(wf.idempotencyKey, "a");

    expect(wf.status).toBe("active");

    tracker.startStep(wf.idempotencyKey, "b");
    tracker.completeStep(wf.idempotencyKey, "b");

    expect(wf.status).toBe("completed");
  });

  it("detects failed workflow when step fails", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-010",
    });
    tracker.registerStep(wf.idempotencyKey, "a", "A");
    tracker.startStep(wf.idempotencyKey, "a");
    tracker.failStep(wf.idempotencyKey, "a", "error");

    expect(wf.status).toBe("failed");
  });

  it("resets a failed step to pending", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-011",
    });
    tracker.registerStep(wf.idempotencyKey, "a", "A");
    tracker.startStep(wf.idempotencyKey, "a");
    tracker.failStep(wf.idempotencyKey, "a", "error");

    tracker.resetStep(wf.idempotencyKey, "a");

    const step = wf.steps.get("a")!;
    expect(step.status).toBe("pending");
    expect(step.error).toBeUndefined();
    expect(wf.status).toBe("active");
  });

  it("resets all failed steps", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-012",
    });
    tracker.registerSteps(wf.idempotencyKey, [
      { stepId: "a", stepName: "A" },
      { stepId: "b", stepName: "B" },
    ]);

    tracker.startStep(wf.idempotencyKey, "a");
    tracker.failStep(wf.idempotencyKey, "a", "err-a");
    tracker.startStep(wf.idempotencyKey, "b");
    tracker.completeStep(wf.idempotencyKey, "b");

    const reset = tracker.resetFailedSteps(wf.idempotencyKey);
    expect(reset).toHaveLength(1);
    expect(reset[0].stepId).toBe("a");
    expect(reset[0].status).toBe("pending");
  });

  it("checks step completion", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-013",
    });
    tracker.registerStep(wf.idempotencyKey, "a", "A");
    tracker.startStep(wf.idempotencyKey, "a");
    tracker.completeStep(wf.idempotencyKey, "a");

    expect(tracker.isStepCompleted(wf.idempotencyKey, "a")).toBe(true);
    expect(tracker.isStepCompleted(wf.idempotencyKey, "nonexistent")).toBe(
      false
    );
  });

  it("retrieves completed, pending, and failed steps", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-014",
    });
    tracker.registerSteps(wf.idempotencyKey, [
      { stepId: "a", stepName: "A" },
      { stepId: "b", stepName: "B" },
    ]);

    tracker.startStep(wf.idempotencyKey, "a");
    tracker.completeStep(wf.idempotencyKey, "a");
    tracker.startStep(wf.idempotencyKey, "b");
    tracker.failStep(wf.idempotencyKey, "b", "err");

    expect(tracker.getCompletedSteps(wf.idempotencyKey)).toHaveLength(1);
    expect(tracker.getFailedSteps(wf.idempotencyKey)).toHaveLength(1);
  });

  it("removes a workflow", () => {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "wf-015",
    });
    expect(tracker.removeWorkflow(wf.idempotencyKey)).toBe(true);
    expect(tracker.getWorkflow(wf.idempotencyKey)).toBeUndefined();
  });

  it("clears expired workflows", () => {
    const shortTracker = new IdempotencyTracker(-1);
    shortTracker.startWorkflow({ namespace: "test", workflowId: "wf-expired" });
    const count = shortTracker.clearExpired();
    expect(count).toBe(1);
    shortTracker.destroy();
  });

  it("finds an active workflow", () => {
    tracker.startWorkflow({ namespace: "swap", workflowId: "wf-016" });

    const found = tracker.findActiveWorkflow("swap", "wf-016");
    expect(found).toBeDefined();
    expect(found!.namespace).toBe("swap");

    const notFound = tracker.findActiveWorkflow("swap", "wf-999");
    expect(notFound).toBeUndefined();
  });
});

describe("StepRecoveryManager", () => {
  let tracker: IdempotencyTracker;
  let manager: StepRecoveryManager;

  beforeEach(() => {
    tracker = createIdempotencyTracker();
    manager = createStepRecoveryManager();
  });

  afterEach(() => {
    tracker.destroy();
  });

  function createWorkflowWithSteps(): IdempotencyWorkflow {
    const wf = tracker.startWorkflow({
      namespace: "test",
      workflowId: "recovery-test",
    });
    tracker.registerSteps(wf.idempotencyKey, [
      { stepId: "plan", stepName: "Planning" },
      { stepId: "exec", stepName: "Execution" },
      { stepId: "settle", stepName: "Settlement" },
    ]);
    return wf;
  }

  it("returns a plan to continue when steps are pending", () => {
    const wf = createWorkflowWithSteps();
    const plan = manager.getRecoveryPlan(wf);

    expect(plan.canContinue).toBe(true);
    expect(plan.stepsToRetry).toEqual([]);
    expect(plan.recommendation).toBe("Continue with pending steps.");
  });

  it("returns a plan to retry failed steps", () => {
    const wf = createWorkflowWithSteps();
    tracker.startStep(wf.idempotencyKey, "plan");
    tracker.completeStep(wf.idempotencyKey, "plan");
    tracker.startStep(wf.idempotencyKey, "exec");
    tracker.failStep(wf.idempotencyKey, "exec", "timeout");

    const plan = manager.getRecoveryPlan(wf);
    expect(plan.canContinue).toBe(true);
    expect(plan.stepsToRetry).toContain("exec");
    expect(plan.stepsToSkip).toContain("plan");
  });

  it("returns cannot continue when all steps complete", () => {
    const wf = createWorkflowWithSteps();
    for (const s of ["plan", "exec", "settle"]) {
      tracker.startStep(wf.idempotencyKey, s);
      tracker.completeStep(wf.idempotencyKey, s);
    }

    const plan = manager.getRecoveryPlan(wf);
    expect(plan.canContinue).toBe(false);
    expect(plan.recommendation).toContain("done");
  });

  it("returns cannot continue when non-retryable steps fail", () => {
    const wf = createWorkflowWithSteps();
    manager.setRecoveryStrategy("exec", { canRetry: false });

    tracker.startStep(wf.idempotencyKey, "plan");
    tracker.completeStep(wf.idempotencyKey, "plan");
    tracker.startStep(wf.idempotencyKey, "exec");
    tracker.failStep(wf.idempotencyKey, "exec", "fatal");
    tracker.startStep(wf.idempotencyKey, "settle");
    tracker.completeStep(wf.idempotencyKey, "settle");

    const plan = manager.getRecoveryPlan(wf);
    expect(plan.canContinue).toBe(false);
    expect(plan.recommendation).toContain("Manual intervention");
  });

  it("continues workflow from pending steps", async () => {
    const wf = createWorkflowWithSteps();

    const result = await manager.continueWorkflow(
      wf,
      async (stepId) => ({ completed: stepId }),
      tracker,
      { maxRetries: 1, retryDelayMs: 1 }
    );

    expect(result.success).toBe(true);
    expect(tracker.getCompletedSteps(wf.idempotencyKey)).toHaveLength(3);
  });

  it("skips completed steps during continuation", async () => {
    const wf = createWorkflowWithSteps();
    tracker.startStep(wf.idempotencyKey, "plan");
    tracker.completeStep(wf.idempotencyKey, "plan", { done: true });

    const executedSteps: string[] = [];
    const result = await manager.continueWorkflow(
      wf,
      async (stepId) => {
        executedSteps.push(stepId);
        return { completed: stepId };
      },
      tracker,
      { maxRetries: 1, retryDelayMs: 1 }
    );

    expect(result.success).toBe(true);
    expect(executedSteps).not.toContain("plan");
    expect(executedSteps).toContain("exec");
    expect(executedSteps).toContain("settle");
  });

  it("retries failed steps during continuation", async () => {
    const wf = createWorkflowWithSteps();
    tracker.startStep(wf.idempotencyKey, "plan");
    tracker.completeStep(wf.idempotencyKey, "plan");
    tracker.startStep(wf.idempotencyKey, "exec");
    tracker.failStep(wf.idempotencyKey, "exec", "first attempt failed");
    tracker.startStep(wf.idempotencyKey, "settle");
    tracker.completeStep(wf.idempotencyKey, "settle");

    const result = await manager.continueWorkflow(
      wf,
      async (stepId) => ({ completed: stepId }),
      tracker,
      { maxRetries: 1, retryDelayMs: 1 }
    );

    expect(result.success).toBe(true);
    const step = tracker.getStep(wf.idempotencyKey, "exec")!;
    expect(step.status).toBe("completed");
  });

  it("reports failure when step executor throws", async () => {
    const wf = createWorkflowWithSteps();
    tracker.startStep(wf.idempotencyKey, "plan");
    tracker.completeStep(wf.idempotencyKey, "plan");
    tracker.startStep(wf.idempotencyKey, "settle");
    tracker.completeStep(wf.idempotencyKey, "settle");

    const result = await manager.continueWorkflow(
      wf,
      async (stepId) => {
        if (stepId === "exec") {
          throw new Error("execution failure");
        }
        return { ok: true };
      },
      tracker,
      { maxRetries: 1, retryDelayMs: 1 }
    );

    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("exec");
    expect(result.error).toBe("execution failure");
  });

  it("respects maxRetries per strategy", async () => {
    const wf = createWorkflowWithSteps();
    let attemptCount = 0;

    tracker.startStep(wf.idempotencyKey, "plan");
    tracker.completeStep(wf.idempotencyKey, "plan");
    tracker.startStep(wf.idempotencyKey, "settle");
    tracker.completeStep(wf.idempotencyKey, "settle");

    manager.setRecoveryStrategy("exec", {
      maxRetries: 2,
      retryDelayMs: 1,
    });

    const result = await manager.continueWorkflow(
      wf,
      async (stepId) => {
        attemptCount++;
        if (stepId === "exec") {
          throw new Error("always fails");
        }
        return { ok: true };
      },
      tracker
    );

    expect(result.success).toBe(false);
    expect(attemptCount).toBe(3);
  });

  it("invokes onFailure callback when step fails", async () => {
    const wf = createWorkflowWithSteps();
    let failureCalled = false;

    tracker.startStep(wf.idempotencyKey, "plan");
    tracker.completeStep(wf.idempotencyKey, "plan");
    tracker.startStep(wf.idempotencyKey, "settle");
    tracker.completeStep(wf.idempotencyKey, "settle");

    manager.setRecoveryStrategy("exec", {
      maxRetries: 0,
      retryDelayMs: 1,
      onFailure: async () => {
        failureCalled = true;
      },
    });

    await manager.continueWorkflow(
      wf,
      async (stepId) => {
        if (stepId === "exec") {
          throw new Error("fail");
        }
        return { ok: true };
      },
      tracker
    );

    expect(failureCalled).toBe(true);
  });

  it("uses custom shouldRetry to decide retry eligibility", async () => {
    const wf = createWorkflowWithSteps();
    let attemptCount = 0;

    tracker.startStep(wf.idempotencyKey, "plan");
    tracker.completeStep(wf.idempotencyKey, "plan");
    tracker.startStep(wf.idempotencyKey, "settle");
    tracker.completeStep(wf.idempotencyKey, "settle");

    manager.setRecoveryStrategy("exec", {
      maxRetries: 5,
      retryDelayMs: 1,
      shouldRetry: () => false,
    });

    const result = await manager.continueWorkflow(
      wf,
      async (stepId) => {
        attemptCount++;
        if (stepId === "exec") {
          throw new Error("no retry");
        }
        return { ok: true };
      },
      tracker
    );

    expect(result.success).toBe(false);
    expect(attemptCount).toBe(1);
  });
});

describe("Vault idempotency keys", () => {
  const vaultRequest: VaultOperationRequest = {
    vaultId: "vault-main",
    operationType: "deposit",
    asset: "USDC",
    amount: "1000",
    destination: "GDVAULT",
  };

  it("generates deterministic vault operation keys", () => {
    const key1 = generateVaultOperationKey(vaultRequest);
    const key2 = generateVaultOperationKey({ ...vaultRequest });

    expect(key1).toBe(key2);
    expect(key1).toMatch(/^vault:deposit:/);
  });

  it("generates different keys for different operations", () => {
    const depositKey = generateVaultOperationKey(vaultRequest);
    const withdrawKey = generateVaultOperationKey({
      ...vaultRequest,
      operationType: "withdraw",
    });

    expect(depositKey).not.toBe(withdrawKey);
  });

  it("creates vault idempotency key with client request ID", () => {
    const key = createVaultOperationIdempotencyKey(vaultRequest, "client-abc");
    expect(key).toContain(":client-abc");
  });

  it("creates vault idempotency key without client request ID", () => {
    const key = createVaultOperationIdempotencyKey(vaultRequest);
    expect(key).toMatch(/^vault:deposit:/);
    expect(key.split(":")).toHaveLength(3);
  });
});
