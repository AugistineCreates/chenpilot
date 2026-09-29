import {
  BatchPayoutWorkflowService,
  PaymentExecution,
  PaymentExecutionResult,
  PaymentExecutor,
  PaymentRequestService,
  RecurringPaymentMandateService,
} from "../../src/Payments";

const requirement = {
  network: "stellar:testnet",
  asset: { code: "USDC", issuer: "GISSUER" },
  amount: "10",
  recipient: "GRECIPIENT",
};

class RecordingExecutor implements PaymentExecutor {
  readonly calls: PaymentExecution[] = [];
  private results: PaymentExecutionResult[] = [];

  queue(...results: PaymentExecutionResult[]): void {
    this.results.push(...results);
  }

  async executePayment(payment: PaymentExecution): Promise<PaymentExecutionResult> {
    this.calls.push(payment);
    return this.results.shift() ?? { status: "success", transactionHash: `tx-${this.calls.length}` };
  }
}

describe("payment workflows", () => {
  it("matches payment requests deterministically and rejects wrong chain events", () => {
    const service = new PaymentRequestService();
    service.createRequest({ id: "request-1", requirement });

    expect(
      service.matchIncomingPayment("request-1", {
        id: "event-wrong-network",
        network: "stellar:mainnet",
        asset: requirement.asset,
        amount: "4",
        recipient: requirement.recipient,
        transactionHash: "tx-wrong-network",
        observedAt: new Date("2026-01-01T00:00:00Z"),
      }).status
    ).toBe("wrong_network");

    expect(
      service.matchIncomingPayment("request-1", {
        id: "event-wrong-issuer",
        network: requirement.network,
        asset: { code: "USDC", issuer: "GOTHER" },
        amount: "4",
        recipient: requirement.recipient,
        transactionHash: "tx-wrong-issuer",
        observedAt: new Date("2026-01-01T00:01:00Z"),
      }).status
    ).toBe("wrong_asset");

    const partial = service.matchIncomingPayment("request-1", {
      id: "event-partial",
      network: requirement.network,
      asset: requirement.asset,
      amount: "4.25",
      recipient: requirement.recipient,
      transactionHash: "tx-partial",
      observedAt: new Date("2026-01-01T00:02:00Z"),
    });
    expect(partial.status).toBe("accepted");
    expect(partial.request.status).toBe("partially_paid");
    expect(partial.remainingAmount).toBe("5.75");

    const duplicate = service.matchIncomingPayment("request-1", {
      id: "event-partial",
      network: requirement.network,
      asset: requirement.asset,
      amount: "4.25",
      recipient: requirement.recipient,
      transactionHash: "tx-partial",
      observedAt: new Date("2026-01-01T00:02:30Z"),
    });
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.request.paidAmount).toBe("4.25");

    const excess = service.matchIncomingPayment("request-1", {
      id: "event-excess",
      network: requirement.network,
      asset: requirement.asset,
      amount: "7",
      recipient: requirement.recipient,
      transactionHash: "tx-excess",
      observedAt: new Date("2026-01-01T00:03:00Z"),
    });
    expect(excess.request.status).toBe("overpaid");
    expect(excess.overpaidAmount).toBe("1.25");
  });

  it("expires and cancels payment requests before fulfillment", () => {
    const service = new PaymentRequestService();
    service.createRequest({
      id: "request-expiring",
      requirement,
      expiresAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(service.expireRequests(new Date("2026-01-01T00:00:01Z"))[0].status).toBe("expired");

    service.createRequest({ id: "request-cancelled", requirement });
    expect(service.cancelRequest("request-cancelled").status).toBe("cancelled");
  });

  it("runs mandates once per schedule, retries failures, enforces limits, and stops after revocation", async () => {
    const executor = new RecordingExecutor();
    executor.queue(
      { status: "failed", error: "temporary_network_error" },
      { status: "success", transactionHash: "tx-retry" },
      { status: "success", transactionHash: "tx-second" }
    );
    const service = new RecurringPaymentMandateService(executor);

    service.createMandate({
      id: "mandate-1",
      requirement: { ...requirement, amount: "5" },
      intervalMs: 60_000,
      nextRunAt: new Date("2026-01-01T00:00:00Z"),
      cumulativeLimit: "10",
      approvalRequired: true,
      approved: false,
      missedRunBehavior: "execute_late",
    });

    await expect(service.runMandateIfDue("mandate-1", new Date("2026-01-01T00:00:01Z"))).rejects.toThrow(
      /requires approval/
    );

    service.approveMandate("mandate-1");
    const failed = await service.runMandateIfDue("mandate-1", new Date("2026-01-01T00:00:01Z"));
    expect(failed?.status).toBe("failed");
    expect(executor.calls).toHaveLength(1);

    const retried = await service.runMandateIfDue("mandate-1", new Date("2026-01-01T00:00:02Z"));
    expect(retried?.status).toBe("succeeded");
    expect(retried?.transactionHash).toBe("tx-retry");

    await Promise.all([
      service.runMandateIfDue("mandate-1", new Date("2026-01-01T00:01:01Z")),
      service.runMandateIfDue("mandate-1", new Date("2026-01-01T00:01:01Z")),
    ]);
    expect(executor.calls.filter((call) => call.idempotencyKey.includes("2026-01-01T00:01:00.000Z"))).toHaveLength(1);

    const limitBlocked = await service.runMandateIfDue("mandate-1", new Date("2026-01-01T00:02:01Z"));
    expect(limitBlocked?.status).toBe("failed");
    expect(limitBlocked?.error).toBe("cumulative_limit_exceeded");

    service.revokeMandate("mandate-1", new Date("2026-01-01T00:02:30Z"));
    await service.runMandateIfDue("mandate-1", new Date("2026-01-01T00:03:01Z"));
    expect(executor.calls).toHaveLength(3);
  });

  it("binds approval to payout manifests and resumes only unresolved entries", async () => {
    const executor = new RecordingExecutor();
    executor.queue(
      { status: "success", transactionHash: "tx-entry-1" },
      { status: "failed", error: "horizon_timeout" },
      { status: "success", transactionHash: "tx-entry-2" }
    );
    const service = new BatchPayoutWorkflowService(executor);
    const workflow = service.validateAndCreate({
      id: "batch-1",
      entries: [
        { id: "entry-1", requirement },
        { id: "entry-2", requirement: { ...requirement, recipient: "GRECIPIENT2" } },
      ],
    });

    expect(() => service.approve("batch-1", "manifest-tampered")).toThrow(/does not match/);
    service.approve("batch-1", workflow.manifestHash);

    const firstPass = await service.execute("batch-1");
    expect(firstPass.outcomes).toEqual([
      { entryId: "entry-1", status: "succeeded", transactionHash: "tx-entry-1", error: undefined },
      { entryId: "entry-2", status: "failed", transactionHash: undefined, error: "horizon_timeout" },
    ]);

    const secondPass = await service.execute("batch-1");
    expect(secondPass.status).toBe("completed");
    expect(secondPass.outcomes).toEqual([
      { entryId: "entry-1", status: "succeeded", transactionHash: "tx-entry-1", error: undefined },
      { entryId: "entry-2", status: "succeeded", transactionHash: "tx-entry-2", error: undefined },
    ]);
    expect(executor.calls.map((call) => call.metadata?.entryId)).toEqual(["entry-1", "entry-2", "entry-2"]);
  });

  it("isolates invalid payout recipients before submission", () => {
    const executor = new RecordingExecutor();
    const service = new BatchPayoutWorkflowService(executor);
    const workflow = service.validateAndCreate({
      id: "batch-invalid",
      entries: [{ id: "entry-invalid", requirement: { ...requirement, recipient: "" } }],
    });

    expect(workflow.outcomes[0]).toMatchObject({
      entryId: "entry-invalid",
      status: "invalid",
      error: "missing_recipient",
    });
    expect(() => service.approve("batch-invalid", workflow.manifestHash)).toThrow(/invalid entries/);
    expect(executor.calls).toHaveLength(0);
  });
});
