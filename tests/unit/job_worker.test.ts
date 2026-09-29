import { QueueJob } from "../../src/jobs/job.entity";
import { JobWorker, NonRetryableJobError } from "../../src/jobs/jobWorker";

function makeJob(overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    id: "job-1",
    queue: "transactions",
    jobType: "test.job",
    status: "leased",
    userId: "user-1",
    correlationId: null,
    payload: {},
    result: null,
    metadata: null,
    availableAt: new Date(),
    leaseExpiresAt: new Date(Date.now() + 30000),
    leasedBy: "worker-1",
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    completedAt: null,
    deadLetteredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("JobWorker", () => {
  it("completes jobs when the handler succeeds", async () => {
    const queueService = {
      completeJob: jest.fn().mockResolvedValue(true),
      renewLease: jest.fn().mockResolvedValue(true),
    };
    const worker = new JobWorker(queueService as any, {
      workerId: "worker-1",
      queues: ["transactions"],
    });

    worker.registerHandler({
      jobType: "test.job",
      handle: jest.fn().mockResolvedValue({
        outcome: "completed",
        result: { ok: true },
      }),
    });

    await (worker as any).processJob(makeJob(), 0);

    expect(queueService.completeJob).toHaveBeenCalledWith(
      "job-1",
      "worker-1",
      { ok: true },
    );
  });

  it("reschedules jobs without consuming attempts when a handler defers them", async () => {
    const queueService = {
      rescheduleJob: jest.fn().mockResolvedValue(true),
      renewLease: jest.fn().mockResolvedValue(true),
    };
    const worker = new JobWorker(queueService as any, {
      workerId: "worker-1",
      queues: ["transactions"],
    });

    const nextRun = new Date(Date.now() + 60000);
    worker.registerHandler({
      jobType: "test.job",
      handle: jest.fn().mockResolvedValue({
        outcome: "reschedule",
        availableAt: nextRun,
      }),
    });

    await (worker as any).processJob(makeJob(), 0);

    expect(queueService.rescheduleJob).toHaveBeenCalledWith(
      "job-1",
      "worker-1",
      nextRun,
      undefined,
    );
  });

  it("dead-letters jobs when a handler throws a non-retryable error", async () => {
    const queueService = {
      deadLetterJob: jest.fn().mockResolvedValue(true),
      renewLease: jest.fn().mockResolvedValue(true),
    };
    const worker = new JobWorker(queueService as any, {
      workerId: "worker-1",
      queues: ["transactions"],
    });

    worker.registerHandler({
      jobType: "test.job",
      handle: jest
        .fn()
        .mockRejectedValue(new NonRetryableJobError("fatal input")),
    });

    await (worker as any).processJob(makeJob(), 0);

    expect(queueService.deadLetterJob).toHaveBeenCalledWith(
      "job-1",
      "worker-1",
      "fatal input",
    );
  });
});
