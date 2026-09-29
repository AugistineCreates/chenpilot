import * as StellarSdk from "@stellar/stellar-sdk";
import { jobQueueService } from "../../src/jobs/jobQueue.service";
import { delayedTransactionService } from "../../src/services/delayedTransaction.service";

describe("DelayedTransactionService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("enqueues scheduled transactions onto the durable queue", async () => {
    jest
      .spyOn(StellarSdk.Transaction, "fromXDR")
      .mockReturnValue({} as StellarSdk.Transaction);

    const scheduledAt = Date.now() + 60000;
    jest.spyOn(jobQueueService, "enqueue").mockResolvedValue({
      id: "job-123",
      queue: "transactions",
      jobType: "delayed_transaction.submit",
      status: "pending",
      userId: "user-1",
      correlationId: null,
      payload: {
        userId: "user-1",
        transactionXdr: "AAAA",
        config: { strategy: "scheduled", scheduledAt },
      },
      result: null,
      metadata: { strategy: "scheduled" },
      availableAt: new Date(scheduledAt),
      leaseExpiresAt: null,
      leasedBy: null,
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      completedAt: null,
      deadLetteredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const job = await delayedTransactionService.createDelayedTransaction(
      "user-1",
      "AAAA",
      { strategy: "scheduled", scheduledAt, maxRetries: 3 },
    );

    expect(jobQueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: "transactions",
        jobType: "delayed_transaction.submit",
        userId: "user-1",
        maxAttempts: 3,
      }),
    );
    expect(job.id).toBe("job-123");
    expect(job.status).toBe("pending");
  });
});
