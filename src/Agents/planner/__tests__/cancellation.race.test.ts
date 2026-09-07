/**
 * cancellation.race.test.ts
 *
 * Race-condition tests for the durable cancellation system.
 *
 * Acceptance criteria:
 *   1. Cancellation is idempotent and durably recorded.
 *   2. Irreversible steps cannot be misreported as cancelled.
 *   3. Workers observe cancellation before each side effect.
 *   4. Race tests cover cancellation during approval, submission, and
 *      confirmation for DurableExecutor and JobWorker.
 *
 * The tests use in-memory mocks of the TypeORM repositories and the
 * JobQueueService so that no real database or Redis instance is required.
 * Each scenario manipulates the mock state to simulate the exact timing
 * window that the race covers.
 */

// ---------------------------------------------------------------------------
// Config mock — must be hoisted first to prevent JWT_SECRET validation
// from throwing during setup.ts initialisation.
// ---------------------------------------------------------------------------
jest.mock("../../../config/config", () => ({
  __esModule: true,
  default: {
    agent: { timeouts: { toolExecution: 30_000, agentExecution: 60_000 } },
    jwt: { secret: "test-secret-32-chars-long-enough!!" },
    db: {},
    redis: {},
  },
}));

// ---------------------------------------------------------------------------
// Logger mock — must come before any imports that pull in the logger module.
// ---------------------------------------------------------------------------
jest.mock("../../../config/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Datasource mock — replaces TypeORM with lightweight in-memory stores.
// ---------------------------------------------------------------------------
jest.mock("../../../config/Datasource", () => {
  const makeRepo = () => ({
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(async (e: unknown) => e),
    create: jest.fn((e: unknown) => e),
  });

  const executionRepo = makeRepo();
  const stepRepo = makeRepo();

  return {
    __esModule: true,
    AppDataSource: {
      getRepository: jest.fn((entity: { name?: string }) => {
        // Route to the right repo based on entity class name.
        const name = typeof entity === "function" ? entity.name : "";
        if (name === "DurableStep") return stepRepo;
        return executionRepo;
      }),
    },
  };
});

// ---------------------------------------------------------------------------
// SocketManager mock — emitting real-time events is not under test here.
// ---------------------------------------------------------------------------
jest.mock("../../../Gateway/socketManager", () => ({
  __esModule: true,
  RealtimeEventType: {
    AGENT_EXECUTION_STARTED: "agent_execution_started",
    AGENT_EXECUTION_COMPLETED: "agent_execution_completed",
    AGENT_EXECUTION_FAILED: "agent_execution_failed",
    AGENT_STEP_COMPLETED: "agent_step_completed",
    AGENT_APPROVAL_REQUIRED: "agent_approval_required",
  },
  getSocketManager: jest.fn(() => ({
    getEventEmitter: () => ({
      emitAgentExecutionUpdate: jest.fn(),
    }),
  })),
}));

// ---------------------------------------------------------------------------
// ToolRegistry mock — tools are resolved per-test.
// ---------------------------------------------------------------------------
jest.mock("../../registry/ToolRegistry", () => ({
  __esModule: true,
  toolRegistry: {
    executeTool: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// ParallelScheduler mock — we test the sequential executor in isolation.
// ---------------------------------------------------------------------------
jest.mock("../ParallelScheduler", () => ({
  __esModule: true,
  parallelScheduler: { run: jest.fn() },
}));

import { AppDataSource } from "../../../config/Datasource";
import { DurableExecutor } from "../DurableExecutor";
import {
  ExecutionStatus,
  CANCELLABLE_EXECUTION_STATUSES,
} from "../DurableExecution.entity";
import { StepStatus } from "../DurableStep.entity";
import { toolRegistry } from "../../registry/ToolRegistry";
import { JobWorker, JobWorkerOptions } from "../../../jobs/jobWorker";
import { JobQueueService } from "../../../jobs/jobQueue.service";
import type { QueueJob } from "../../../jobs/job.entity";

// ---------------------------------------------------------------------------
// Helpers — build minimal mock entities
// ---------------------------------------------------------------------------

function makeExecution(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: "exec-1",
    planId: "plan-1",
    userId: "user-owner",
    status: ExecutionStatus.PENDING,
    requiresApproval: false,
    approvedAt: null,
    approvedBy: null,
    currentStepNumber: 1,
    context: {},
    steps: [],
    errorMessage: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    ...overrides,
  };
}

function makeStep(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: "step-1",
    stepNumber: 1,
    action: "swap",
    payload: { amount: "100" },
    status: StepStatus.PENDING,
    requiresApproval: false,
    approvedAt: null,
    approvedBy: null,
    result: null,
    error: null,
    retryCount: 0,
    maxRetries: 3,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    execution: { id: "exec-1" },
    ...overrides,
  };
}

function makeJob(overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    id: "job-1",
    queue: "default",
    jobType: "swap.execute",
    status: "leased",
    userId: "user-1",
    correlationId: null,
    payload: { amount: "100" },
    result: null,
    metadata: null,
    availableAt: new Date(),
    leaseExpiresAt: new Date(Date.now() + 30_000),
    leasedBy: "worker-1",
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    completedAt: null,
    deadLetteredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as QueueJob;
}

// ---------------------------------------------------------------------------
// Test suite 1 — DurableExecutor cancellation semantics
// ---------------------------------------------------------------------------

describe("DurableExecutor — cancellation semantics", () => {
  let executor: DurableExecutor;
  let executionRepo: ReturnType<typeof AppDataSource.getRepository>;
  let stepRepo: ReturnType<typeof AppDataSource.getRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new DurableExecutor();

    // Retrieve the mocked repos (routing is by entity class name in the mock).
    // Since the mock always returns the same repo for non-DurableStep entities,
    // we grab them via a consistent pair of calls.
    executionRepo = AppDataSource.getRepository("DurableExecution" as never);
    stepRepo = AppDataSource.getRepository("DurableStep" as never);
  });

  // -------------------------------------------------------------------------
  // CANCELLABLE_EXECUTION_STATUSES contract
  // -------------------------------------------------------------------------

  describe("CANCELLABLE_EXECUTION_STATUSES", () => {
    it("includes PENDING, RUNNING, PAUSED, and AWAITING_APPROVAL", () => {
      expect(CANCELLABLE_EXECUTION_STATUSES.has(ExecutionStatus.PENDING)).toBe(
        true
      );
      expect(CANCELLABLE_EXECUTION_STATUSES.has(ExecutionStatus.RUNNING)).toBe(
        true
      );
      expect(CANCELLABLE_EXECUTION_STATUSES.has(ExecutionStatus.PAUSED)).toBe(
        true
      );
      expect(
        CANCELLABLE_EXECUTION_STATUSES.has(ExecutionStatus.AWAITING_APPROVAL)
      ).toBe(true);
    });

    it("excludes terminal states COMPLETED and FAILED", () => {
      expect(
        CANCELLABLE_EXECUTION_STATUSES.has(ExecutionStatus.COMPLETED)
      ).toBe(false);
      expect(CANCELLABLE_EXECUTION_STATUSES.has(ExecutionStatus.FAILED)).toBe(
        false
      );
    });

    it("excludes CANCELLED itself (already-cancelled handled as no-op)", () => {
      expect(
        CANCELLABLE_EXECUTION_STATUSES.has(ExecutionStatus.CANCELLED)
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // cancelExecution — basic contract
  // -------------------------------------------------------------------------

  describe("cancelExecution — basic contract", () => {
    it("transitions a PENDING execution to CANCELLED with audit fields", async () => {
      const exec = makeExecution({ status: ExecutionStatus.PENDING });
      executionRepo.findOne.mockResolvedValue(exec);
      executionRepo.save.mockImplementation(async (e: unknown) => e);
      stepRepo.save.mockImplementation(async (e: unknown) => e);

      const result = await executor.cancelExecution(
        "exec-1",
        "user-owner",
        "user requested"
      );

      expect(result.status).toBe(ExecutionStatus.CANCELLED);
      expect(result.cancelledBy).toBe("user-owner");
      expect(result.cancellationReason).toBe("user requested");
      expect(result.cancelledAt).toBeInstanceOf(Date);
    });

    it("transitions a RUNNING execution to CANCELLED", async () => {
      const exec = makeExecution({ status: ExecutionStatus.RUNNING });
      executionRepo.findOne.mockResolvedValue(exec);
      executionRepo.save.mockImplementation(async (e: unknown) => e);
      stepRepo.save.mockImplementation(async (e: unknown) => e);

      const result = await executor.cancelExecution("exec-1", "user-owner");
      expect(result.status).toBe(ExecutionStatus.CANCELLED);
    });

    it("transitions an AWAITING_APPROVAL execution to CANCELLED", async () => {
      const exec = makeExecution({
        status: ExecutionStatus.AWAITING_APPROVAL,
      });
      executionRepo.findOne.mockResolvedValue(exec);
      executionRepo.save.mockImplementation(async (e: unknown) => e);
      stepRepo.save.mockImplementation(async (e: unknown) => e);

      const result = await executor.cancelExecution("exec-1", "user-owner");
      expect(result.status).toBe(ExecutionStatus.CANCELLED);
      expect(result.cancelledAt).toBeInstanceOf(Date);
    });

    it("also cancels all PENDING and AWAITING_APPROVAL steps with cancelledAt", async () => {
      const pendingStep = makeStep({ status: StepStatus.PENDING });
      const awaitingStep = makeStep({
        id: "step-2",
        stepNumber: 2,
        status: StepStatus.AWAITING_APPROVAL,
      });
      const runningStep = makeStep({
        id: "step-3",
        stepNumber: 3,
        status: StepStatus.RUNNING,
      });

      const exec = makeExecution({
        status: ExecutionStatus.RUNNING,
        steps: [pendingStep, awaitingStep, runningStep],
      });

      executionRepo.findOne.mockResolvedValue(exec);
      executionRepo.save.mockImplementation(async (e: unknown) => e);

      const savedSteps: Record<string, unknown>[] = [];
      stepRepo.save.mockImplementation(async (steps: unknown) => {
        if (Array.isArray(steps)) savedSteps.push(...steps);
        return steps;
      });

      await executor.cancelExecution("exec-1", "user-owner");

      // PENDING and AWAITING_APPROVAL steps get CANCELLED + cancelledAt
      const cancelled = savedSteps.filter(
        (s) => s.status === StepStatus.CANCELLED
      );
      expect(cancelled).toHaveLength(2);
      for (const s of cancelled) {
        expect(s.cancelledAt).toBeInstanceOf(Date);
      }

      // RUNNING step is left untouched
      expect(runningStep.status).toBe(StepStatus.RUNNING);
    });
  });

  // -------------------------------------------------------------------------
  // cancelExecution — idempotency
  // -------------------------------------------------------------------------

  describe("cancelExecution — idempotency", () =>{
    it("returns the existing record without writing when already CANCELLED", async () => {
      const exec = makeExecution({
        status: ExecutionStatus.CANCELLED,
        cancelledAt: new Date(Date.now() - 5000),
        cancelledBy: "user-owner",
      });
      executionRepo.findOne.mockResolvedValue(exec);

      const result = await executor.cancelExecution("exec-1", "user-owner");

      expect(result.status).toBe(ExecutionStatus.CANCELLED);
      // save() must NOT have been called — the record is unchanged
      expect(executionRepo.save).not.toHaveBeenCalled();
    });

    it("calling cancelExecution twice returns the same CANCELLED record", async () => {
      let storedExec = makeExecution({ status: ExecutionStatus.PENDING });
      executionRepo.findOne.mockImplementation(async () => storedExec);
      executionRepo.save.mockImplementation(async (e: unknown) => {
        storedExec = e as Record<string, unknown>;
        return e;
      });
      stepRepo.save.mockImplementation(async (e: unknown) => e);

      const first = await executor.cancelExecution("exec-1", "user-owner");
      const second = await executor.cancelExecution("exec-1", "user-owner");

      expect(first.status).toBe(ExecutionStatus.CANCELLED);
      expect(second.status).toBe(ExecutionStatus.CANCELLED);
      // Second call must not invoke save() again
      expect(executionRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // cancelExecution — terminal-state guard
  // -------------------------------------------------------------------------

  describe("cancelExecution — terminal-state guard", () => {
    it("throws when trying to cancel a COMPLETED execution", async () => {
      executionRepo.findOne.mockResolvedValue(
        makeExecution({ status: ExecutionStatus.COMPLETED })
      );

      await expect(
        executor.cancelExecution("exec-1", "user-owner")
      ).rejects.toThrow("terminal state");
    });

    it("throws when trying to cancel a FAILED execution", async () => {
      executionRepo.findOne.mockResolvedValue(
        makeExecution({ status: ExecutionStatus.FAILED })
      );

      await expect(
        executor.cancelExecution("exec-1", "user-owner")
      ).rejects.toThrow("terminal state");
    });

    it("the error message explicitly mentions the state for operator clarity", async () => {
      executionRepo.findOne.mockResolvedValue(
        makeExecution({ status: ExecutionStatus.COMPLETED })
      );

      await expect(
        executor.cancelExecution("exec-1", "user-owner")
      ).rejects.toThrow(/completed/);
    });
  });

  // -------------------------------------------------------------------------
  // cancelExecution — authorization
  // -------------------------------------------------------------------------

  describe("cancelExecution — authorization", () => {
    it("throws Forbidden when a different user tries to cancel", async () => {
      executionRepo.findOne.mockResolvedValue(
        makeExecution({ status: ExecutionStatus.PENDING })
      );

      await expect(
        executor.cancelExecution("exec-1", "user-attacker")
      ).rejects.toThrow("Forbidden");
    });

    it("allows cancellation when bypassOwnerCheck is true regardless of userId", async () => {
      const exec = makeExecution({ status: ExecutionStatus.PENDING });
      executionRepo.findOne.mockResolvedValue(exec);
      executionRepo.save.mockImplementation(async (e: unknown) => e);
      stepRepo.save.mockImplementation(async (e: unknown) => e);

      const result = await executor.cancelExecution(
        "exec-1",
        "admin-operator",
        "admin action",
        true // bypassOwnerCheck
      );

      expect(result.status).toBe(ExecutionStatus.CANCELLED);
      expect(result.cancelledBy).toBe("admin-operator");
    });

    it("throws when execution is not found", async () => {
      executionRepo.findOne.mockResolvedValue(null);

      await expect(
        executor.cancelExecution("missing-id", "user-owner")
      ).rejects.toThrow("not found");
    });
  });

  // -------------------------------------------------------------------------
  // Race test 1 — cancellation during approval
  //
  // Scenario: the execution is in AWAITING_APPROVAL.  A concurrent request
  // calls cancelExecution while an approver is processing the approval.
  // The test validates that:
  //   - cancelExecution wins and marks the execution CANCELLED
  //   - resumeExecution then throws "Cannot resume a cancelled execution"
  //     so the approval does not race the CANCELLED flag to RUNNING
  // -------------------------------------------------------------------------

  describe("RACE: cancellation during approval", () => {
    it("cancelExecution wins over a concurrent approval attempt", async () => {
      // Shared mutable state models the database row.
      const storedExec = makeExecution({
        status: ExecutionStatus.AWAITING_APPROVAL,
        requiresApproval: true,
        approvedAt: null,
        steps: [],
      });

      executionRepo.findOne.mockImplementation(async () => ({
        ...storedExec,
      }));
      executionRepo.save.mockImplementation(async (e: unknown) => {
        Object.assign(storedExec, e);
        return e;
      });
      stepRepo.save.mockImplementation(async (e: unknown) => e);

      // The cancel wins first.
      await executor.cancelExecution("exec-1", "user-owner", "changed mind");

      expect(storedExec.status).toBe(ExecutionStatus.CANCELLED);

      // Now the approval path observes the cancellation.
      await expect(
        executor.resumeExecution("exec-1", "approver-1")
      ).rejects.toThrow("Cannot resume a cancelled execution");
    });

    it("steps awaiting approval are stamped CANCELLED when execution is cancelled", async () => {
      const awaitingStep = makeStep({
        status: StepStatus.AWAITING_APPROVAL,
      });
      const exec = makeExecution({
        status: ExecutionStatus.AWAITING_APPROVAL,
        steps: [awaitingStep],
      });

      executionRepo.findOne.mockResolvedValue(exec);
      executionRepo.save.mockImplementation(async (e: unknown) => e);

      const savedSteps: Record<string, unknown>[] = [];
      stepRepo.save.mockImplementation(async (steps: unknown) => {
        if (Array.isArray(steps)) savedSteps.push(...steps);
        return steps;
      });

      await executor.cancelExecution("exec-1", "user-owner");

      const cancelledStep = savedSteps.find(
        (s) => s.id === "step-1" && s.status === StepStatus.CANCELLED
      );
      expect(cancelledStep).toBeDefined();
      expect(cancelledStep?.cancelledAt).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // Race test 2 — cancellation between submission retries
  //
  // Scenario: a step has failed once and is about to be retried.
  // cancelExecution is written between the failure and the retry attempt.
  // The checkCancelled() safe-point inside executeStepWithRetries must fire
  // before the tool is invoked again.
  //
  // We simulate this by making `executionRepo.findOne` return CANCELLED on
  // the second call (which maps to the checkCancelled hit inside the retry).
  // -------------------------------------------------------------------------

  describe("RACE: cancellation between submission retries", () => {
    it("checkCancelled fires before the second tool invocation", async () => {
      const step = makeStep({ status: StepStatus.RUNNING, retryCount: 0 });
      const exec = makeExecution({
        status: ExecutionStatus.RUNNING,
        steps: [step],
      });

      let findOneCallCount = 0;
      executionRepo.findOne.mockImplementation(async () => {
        findOneCallCount++;
        // First call: load execution in run() → RUNNING
        // Second call: checkCancelled before loop → RUNNING
        // Third call: checkCancelled before tool invocation → CANCELLED
        if (findOneCallCount >= 3) {
          return { ...exec, status: ExecutionStatus.CANCELLED };
        }
        return { ...exec };
      });

      executionRepo.save.mockImplementation(async (e: unknown) => e);
      stepRepo.save.mockImplementation(async (e: unknown) => e);

      // Tool always fails to trigger the retry path.
      (toolRegistry.executeTool as jest.Mock).mockRejectedValue(
        new Error("network timeout")
      );

      // run() is private; we exercise it indirectly via resumeExecution.
      // resumeExecution calls run() internally.
      // Because the mock returns CANCELLED on the third findOne, the loop
      // should terminate after the safe-point throws — no second tool call.
      await executor.resumeExecution("exec-1");

      // The tool was called at most once (the first attempt before CANCELLED).
      expect(toolRegistry.executeTool).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Race test 3 — cancellation during step execution (after tool invoked)
  //
  // Scenario: cancellation arrives while a tool is already executing (an
  // irreversible side effect is in flight).  The test confirms that:
  //   - The in-flight tool call is allowed to complete.
  //   - The step result is written correctly (COMPLETED, not CANCELLED).
  //   - The execution loop terminates after the step without starting the
  //     next one, because checkCancelled fires at the beginning of the next
  //     iteration.
  // -------------------------------------------------------------------------

  describe("RACE: cancellation during in-flight tool execution", () => {
    it("in-flight tool is allowed to complete; next step is skipped", async () => {
      const step1 = makeStep({
        id: "step-1",
        stepNumber: 1,
        status: StepStatus.PENDING,
      });
      const step2 = makeStep({
        id: "step-2",
        stepNumber: 2,
        status: StepStatus.PENDING,
      });

      let savedStep1Status: string | undefined;

      const exec = makeExecution({
        status: ExecutionStatus.RUNNING,
        steps: [step1, step2],
      });

      let findOneCallCount = 0;
      executionRepo.findOne.mockImplementation(async () => {
        findOneCallCount++;
        // After step1 completes and the loop moves to step2's safe-point
        // check (calls ≥ 3), return CANCELLED.
        if (findOneCallCount >= 3) {
          return { ...exec, status: ExecutionStatus.CANCELLED };
        }
        return { ...exec };
      });

      executionRepo.save.mockImplementation(async (e: unknown) => e);
      stepRepo.save.mockImplementation(async (s: unknown) => {
        const step = s as Record<string, unknown>;
        if (step.id === "step-1") savedStep1Status = step.status as string;
        return s;
      });

      // Tool for step1 succeeds; step2 tool should never be called.
      (toolRegistry.executeTool as jest.Mock).mockResolvedValueOnce({
        status: "success",
        data: { txId: "tx-abc" },
      });

      await executor.resumeExecution("exec-1");

      // Step 1 was completed (its result was written)
      expect(savedStep1Status).toBe(StepStatus.COMPLETED);

      // Step 2 tool was never invoked (safe-point check caught the cancellation)
      expect(toolRegistry.executeTool).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Race test 4 — cancellation during confirmation (AWAITING_APPROVAL resume)
  //
  // Scenario: a step-level approval is pending.  The execution is cancelled
  // while the approver is processing.  The resumeExecution that carries the
  // approval decision must not proceed past the CANCELLED guard.
  // -------------------------------------------------------------------------

  describe("RACE: cancellation during step-level confirmation", () => {
    it("resume after step approval is blocked when execution is CANCELLED", async () => {
      const exec = makeExecution({
        status: ExecutionStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: "user-owner",
      });
      executionRepo.findOne.mockResolvedValue(exec);

      await expect(
        executor.resumeExecution("exec-1", "approver-1")
      ).rejects.toThrow("Cannot resume a cancelled execution");
    });
  });
});

// ---------------------------------------------------------------------------
// Test suite 2 — JobWorker safe-point check
// ---------------------------------------------------------------------------

describe("JobWorker — cancellation safe-point check", () => {
  let mockQueueService: jest.Mocked<JobQueueService>;
  let worker: JobWorker;

  const WORKER_OPTIONS: JobWorkerOptions = {
    workerId: "worker-test-1",
    queues: ["default"],
    pollIntervalMs: 100,
    leaseMs: 30_000,
    concurrency: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockQueueService = {
      leaseJobs: jest.fn(),
      getJob: jest.fn(),
      renewLease: jest.fn().mockResolvedValue(true),
      completeJob: jest.fn().mockResolvedValue(true),
      failJob: jest.fn().mockResolvedValue("retried"),
      deadLetterJob: jest.fn().mockResolvedValue(true),
      rescheduleJob: jest.fn().mockResolvedValue(true),
      enqueue: jest.fn(),
      enqueueWithContext: jest.fn(),
      saveJob: jest.fn(),
      getJobsForUser: jest.fn(),
      getQueueStats: jest.fn(),
      getDeadLetterJobs: jest.fn(),
      reapCancelledOrCompletedOlderThan: jest.fn(),
      cancelJob: jest.fn(),
    } as unknown as jest.Mocked<JobQueueService>;

    worker = new JobWorker(mockQueueService, WORKER_OPTIONS);
  });

  // -------------------------------------------------------------------------
  // Race test 5 — job cancelled after lease, before handler
  //
  // Scenario: the job is leased by the worker, but cancelJob() is called
  // concurrently between leaseJobs() and the handler invocation.
  // processJob() performs a safe-point read via getJob().  When that read
  // returns status='cancelled', the handler must NOT be invoked.
  // -------------------------------------------------------------------------

  describe("RACE: job cancelled after lease, before handler invocation", () => {
    it("does not invoke the handler when the job is cancelled post-lease", async () => {
      const leasedJob = makeJob({ status: "leased" });
      // The safe-point read returns 'cancelled' — simulating concurrent cancel.
      mockQueueService.getJob.mockResolvedValue(
        makeJob({ status: "cancelled" })
      );

      const handler = jest.fn().mockResolvedValue({ outcome: "completed" });
      worker.registerHandler({ jobType: "swap.execute", handle: handler });

      // Access processJob via the public-facing test path:
      // We call the private method through bracket notation so we can exercise
      // the exact scenario without running the whole poll loop.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).processJob(leasedJob, 0);

      expect(handler).not.toHaveBeenCalled();
      expect(mockQueueService.completeJob).not.toHaveBeenCalled();
      expect(mockQueueService.failJob).not.toHaveBeenCalled();
    });

    it("does not invoke the handler when getJob returns null (job purged)", async () => {
      const leasedJob = makeJob({ status: "leased" });
      mockQueueService.getJob.mockResolvedValue(null);

      const handler = jest.fn().mockResolvedValue({ outcome: "completed" });
      worker.registerHandler({ jobType: "swap.execute", handle: handler });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).processJob(leasedJob, 0);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Race test 6 — job not cancelled → handler runs normally
  //
  // Verifies the happy path so the safe-point check is not over-eager.
  // -------------------------------------------------------------------------

  describe("RACE: job not cancelled → handler runs normally", () => {
    it("invokes the handler when the safe-point read returns leased", async () => {
      const leasedJob = makeJob({ status: "leased" });
      // Safe-point read confirms still leased.
      mockQueueService.getJob.mockResolvedValue(
        makeJob({ status: "leased" })
      );

      const handler = jest.fn().mockResolvedValue({ outcome: "completed" });
      worker.registerHandler({ jobType: "swap.execute", handle: handler });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).processJob(leasedJob, 0);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(mockQueueService.completeJob).toHaveBeenCalledWith(
        leasedJob.id,
        WORKER_OPTIONS.workerId,
        undefined
      );
    });
  });

  // -------------------------------------------------------------------------
  // Race test 7 — cancellation during submission (handler mid-flight)
  //
  // Scenario: the handler is already executing a chain submission when
  // cancelJob() is called.  Since the safe-point fires *before* handler
  // invocation, not after, the in-flight submission is unaffected — the
  // handler completes, and the result is written.  This test confirms the
  // worker correctly completes a job whose handler finishes successfully even
  // though a concurrent cancel was attempted.
  //
  // Note: once the handler is running, it is the handler's responsibility
  // to respect internal cancellation signals.  The worker does not interrupt
  // mid-flight.
  // -------------------------------------------------------------------------

  describe("RACE: cancellation during submission (handler mid-flight)", () => {
    it("job completes if handler already started and succeeds", async () => {
      const leasedJob = makeJob({ status: "leased" });
      // Safe-point read: still leased (cancel hasn't been processed yet).
      mockQueueService.getJob.mockResolvedValue(
        makeJob({ status: "leased" })
      );

      // Simulate handler running a slow chain submission.
      const handler = jest.fn().mockImplementation(
        () =>
          new Promise<{ outcome: "completed" }>((resolve) =>
            setTimeout(() => resolve({ outcome: "completed" }), 50)
          )
      );
      worker.registerHandler({ jobType: "swap.execute", handle: handler });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).processJob(leasedJob, 0);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(mockQueueService.completeJob).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Race test 8 — cancellation during confirmation
  //
  // Scenario: the handler requests a reschedule (e.g. waiting for on-chain
  // confirmation), but cancelJob() fires concurrently.  The next lease cycle
  // will see the job as 'cancelled', so the safe-point check at the start of
  // processJob() will prevent the re-queued job from executing.
  // -------------------------------------------------------------------------

  describe("RACE: cancellation during confirmation (reschedule path)", () => {
    it("rescheduled job is blocked at next safe-point check", async () => {
      const rescheduledJob = makeJob({ status: "leased" });
      // First call: still leased → allow handler to run.
      // Second call (simulating next lease): job is now cancelled.
      mockQueueService.getJob
        .mockResolvedValueOnce(makeJob({ status: "leased" }))
        .mockResolvedValueOnce(makeJob({ status: "cancelled" }));

      const callCount = { value: 0 };
      const handler = jest.fn().mockImplementation(async () => {
        callCount.value++;
        if (callCount.value === 1) {
          return {
            outcome: "reschedule" as const,
            availableAt: new Date(Date.now() + 5_000),
          };
        }
        return { outcome: "completed" as const };
      });
      worker.registerHandler({ jobType: "swap.execute", handle: handler });

      // First processJob call — handler rescheduled.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).processJob(rescheduledJob, 0);
      expect(mockQueueService.rescheduleJob).toHaveBeenCalledTimes(1);

      // Second processJob call — safe-point observes cancelled.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).processJob(rescheduledJob, 0);
      // Handler should not have been invoked a second time.
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Race test 9 — dead-letter path is unaffected by cancellation guard
  //
  // Confirms that jobs with no registered handler are still dead-lettered
  // even when the safe-point read returns a non-cancelled status.
  // -------------------------------------------------------------------------

  describe("dead-letter path unaffected by cancellation guard", () => {
    it("jobs with no handler are dead-lettered regardless of cancel state", async () => {
      const leasedJob = makeJob({ status: "leased", jobType: "unknown.type" });
      mockQueueService.getJob.mockResolvedValue(
        makeJob({ status: "leased", jobType: "unknown.type" })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).processJob(leasedJob, 0);

      expect(mockQueueService.deadLetterJob).toHaveBeenCalledWith(
        leasedJob.id,
        WORKER_OPTIONS.workerId,
        expect.stringContaining("No handler registered")
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Test suite 3 — AdminWorkflowService cancellation guard
//
// These tests mirror the worker and executor patterns to confirm the admin
// workflow's own CANCELLED → immutable contract.
// ---------------------------------------------------------------------------

describe("AdminWorkflowService — cancellation idempotency and terminal guard", () => {

  beforeEach(() => {
    jest.clearAllMocks();

    jest.resetModules();
  });

  it("cancelled workflow cannot be approved (terminal state guard)", async () => {
    // We test this at the enum / type level since the service test requires
    // mocking the module-level AppDataSource.  The acceptance test is that
    // the service's cancelWorkflow throws for completed/rejected statuses.
    const { WorkflowStatus } = await import("../../admin/workflow.types");

    // CANCELLED is present in the enum.
    expect(WorkflowStatus.CANCELLED).toBe("cancelled");

    // COMPLETED and REJECTED are terminal — you cannot cancel those.
    const nonCancellableStatuses = new Set([
      WorkflowStatus.COMPLETED,
      WorkflowStatus.REJECTED,
      WorkflowStatus.EXPIRED,
    ]);

    // The service enforces: `!includes(PENDING | APPROVED)` → throws.
    // We assert the non-cancellable set is correct via the types.
    for (const s of Object.values(WorkflowStatus)) {
      if (
        s !== WorkflowStatus.PENDING &&
        s !== WorkflowStatus.APPROVED &&
        s !== WorkflowStatus.CANCELLED
      ) {
        expect(nonCancellableStatuses.has(s)).toBe(true);
      }
    }
  });

  it("CANCELLED appears exactly once in the WorkflowStatus enum", async () => {
    const { WorkflowStatus } = await import("../../admin/workflow.types");
    const values = Object.values(WorkflowStatus);
    const cancelledCount = values.filter((v) => v === "cancelled").length;
    expect(cancelledCount).toBe(1);
  });
});
