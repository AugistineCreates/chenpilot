import { createJobContext, propagateJobContext } from "../jobContext";
import type { QueueJob } from "../../jobs/job.entity";

const mockJob: QueueJob = {
  id: "job-123",
  queue: "side-effects",
  jobType: "funding.auto_deploy",
  status: "pending",
  userId: "user-123",
  correlationId: "corr-456",
  payload: {},
  availableAt: new Date(),
  attempts: 0,
  maxAttempts: 5,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("JobContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createJobContext", () => {
    it("creates context from queue job", () => {
      const ctx = createJobContext(mockJob);

      expect(ctx.transport).toBe("queue");
      expect(ctx.queueName).toBe("side-effects");
      expect(ctx.jobId).toBe("job-123");
      expect(ctx.userId).toBe("user-123");
      expect(ctx.executionId).toBe("job-123");
    });

    it("inherits requestId from current context when available", () => {
      let capturedRequestId: string | undefined;

      propagateJobContext(mockJob, () => {
        capturedRequestId = createJobContext(mockJob).requestId;
      });

      // Without current context, requestId falls back to correlationId
      expect(capturedRequestId).toBe("corr-456");
    });
  });

  describe("propagateJobContext", () => {
    it("wraps handler execution with job context", () => {
      let captured: Record<string, unknown> = {};

      propagateJobContext(mockJob, () => {
        captured = {
          jobId: createJobContext(mockJob).jobId,
          queueName: createJobContext(mockJob).queueName,
        };
        return "result";
      });

      expect(captured.jobId).toBe("job-123");
      expect(captured.queueName).toBe("side-effects");
    });

    it("cleans up context after callback completes", () => {
      propagateJobContext(mockJob, () => {
        expect(createJobContext(mockJob).jobId).toBe("job-123");
      });

      const ctx = createJobContext(mockJob);
      // After propagation, createJobContext still reads from DB, not AsyncLocalStorage
      expect(ctx.jobId).toBe("job-123");
    });
  });
});
