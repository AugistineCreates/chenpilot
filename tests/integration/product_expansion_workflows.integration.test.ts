import { PortfolioRebalancingWorkflow } from "../../src/Portfolio/rebalancingWorkflow.service";
import { RecipientGovernanceService } from "../../src/Contacts/recipientGovernance.service";
import { ScheduledTaskManagementService } from "../../src/Agents/scheduledTaskManagement.service";
import { NotificationDeliveryService } from "../../packages/bot/src/notification/deliveryService";
import {
  DeliveryPlatform,
  DeliveryStatus,
  NotificationPriority,
  NotificationType,
  PlatformDeliveryHandler,
} from "../../packages/bot/src/notification/core";

describe("product expansion workflows", () => {
  it("validates allocation totals, binds approval to trades, and reports incomplete rebalance actions", async () => {
    const workflow = new PortfolioRebalancingWorkflow(new Set(["XLM", "USDC"]), 0.01);

    expect(() =>
      workflow.propose([{ asset: "XLM", value: 100 }], [{ asset: "XLM", targetBps: 9_000, toleranceBps: 50, minTradeValue: 1 }]),
    ).toThrow("10000 bps");

    const plan = workflow.propose(
      [
        { asset: "XLM", value: 70 },
        { asset: "USDC", value: 30 },
      ],
      [
        { asset: "XLM", targetBps: 5_000, toleranceBps: 100, minTradeValue: 5 },
        { asset: "USDC", targetBps: 5_000, toleranceBps: 100, minTradeValue: 5 },
      ],
    );
    const approval = workflow.approve(plan, "user-1", 1);

    await expect(workflow.execute(plan, { ...approval, planHash: "tampered" }, { execute: jest.fn() })).rejects.toThrow("does not match");

    const result = await workflow.execute(plan, approval, {
      execute: jest.fn(async (trade) => {
        if (trade.asset === "USDC") throw new Error("route unavailable");
        return { executedValue: trade.value, feeValue: trade.feeEstimate };
      }),
    });

    expect(result.trades.find((trade) => trade.asset === "XLM")?.status).toBe("executed");
    expect(result.trades.find((trade) => trade.asset === "USDC")?.status).toBe("incomplete");
    expect(result.incompleteActions).toContain("USDC: route unavailable");
    expect(result.residualValue).toBeLessThan(plan.residualValue);
  });

  it("retains recipient revisions and blocks stale prepared transfers after concurrent address edits", () => {
    const service = new RecipientGovernanceService();
    const initial = service.createRecipient({ recipientId: "recipient-1", identityKey: "kyc:alice", address: "GA1", network: "stellar" });
    service.verifyRevision("recipient-1", initial.revisionId);

    const prepared = service.prepareTransfer({
      transferId: "tx-1",
      recipientId: "recipient-1",
      revisionId: initial.revisionId,
      amount: "10",
      asset: "USDC",
    });

    const updated = service.updateRecipient({ recipientId: "recipient-1", address: "GA2", network: "stellar" });
    expect(updated.status).toBe("pending_verification");
    expect(service.history("recipient-1")).toHaveLength(2);
    expect(() => service.submitTransfer(prepared)).toThrow("no longer verified");

    service.verifyRevision("recipient-1", updated.revisionId);
    const nextPrepared = service.prepareTransfer({
      transferId: "tx-2",
      recipientId: "recipient-1",
      revisionId: updated.revisionId,
      amount: "10",
      asset: "USDC",
    });
    expect(service.submitTransfer(nextPrepared).address).toBe("GA2");
  });

  it("separates platform delivery from acknowledgement, deduplicates replay, and recovers missed critical notifications", async () => {
    jest.useFakeTimers();
    const handler: PlatformDeliveryHandler = {
      platform: DeliveryPlatform.TELEGRAM,
      deliver: jest.fn(async (message) => ({
        success: message.id !== "critical-1",
        platform: DeliveryPlatform.TELEGRAM,
        attempt: 1,
        duration: 1,
        timestamp: Date.now(),
        error: message.id === "critical-1" ? "offline" : undefined,
      })),
      isAvailable: () => true,
      getHealth: () => ({ available: true }),
    };
    const service = new NotificationDeliveryService({
      retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1, useJitter: false, jitterPercentage: 0 },
      enableMetrics: false,
    });
    service.registerPlatformHandler(handler);

    await service.enqueue({
      id: "critical-1",
      userId: "user-1",
      type: NotificationType.ERROR,
      priority: NotificationPriority.URGENT,
      platforms: [DeliveryPlatform.TELEGRAM],
      content: "critical",
      metadata: { eventId: "event-1" },
      createdAt: Date.now(),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getDeliveryState("critical-1")?.status).toBe(DeliveryStatus.DEAD_LETTER);
    expect(service.acknowledge("critical-1", "user-1").acknowledged).toBe(true);
    expect(service.getDeliveryState("critical-1")?.acknowledgedBy).toBe("user-1");
    expect((await service.enqueue({
      id: "critical-duplicate",
      userId: "user-1",
      type: NotificationType.ERROR,
      priority: NotificationPriority.URGENT,
      platforms: [DeliveryPlatform.TELEGRAM],
      content: "critical",
      metadata: { eventId: "event-1" },
      createdAt: Date.now(),
    })).accepted).toBe(false);

    const recovery = await service.recoverMissedCritical("critical-1");
    expect(recovery.accepted).toBe(true);
    expect(service.getDeliveryHistoryForUser("user-1").map((state) => state.notificationId)).toContain("critical-1");
    jest.useRealTimers();
    await service.shutdown();
  });

  it("manages durable scheduled task windows, runtime authorization, retries, and duplicate prevention", async () => {
    const service = new ScheduledTaskManagementService();
    const task = service.create({
      id: "task-1",
      originatingIdentity: "user-1",
      payload: { action: "price_check" },
      windowStart: new Date("2026-09-28T10:00:00Z"),
      windowEnd: new Date("2026-09-28T11:00:00Z"),
      approvalPolicy: "low_risk_auto",
      missedWindowBehavior: "skip",
    });

    expect(() => service.update(task.id, { payload: { action: "swap" } })).toThrow("require approval");
    service.update(task.id, { payload: { action: "swap" }, approvalPolicy: "high_risk" }, true);

    const blocked = await service.runDue(
      task.id,
      new Date("2026-09-28T10:30:00Z"),
      { authorize: async () => true },
      jest.fn(),
    );
    expect(blocked.runHistory[blocked.runHistory.length - 1]?.status).toBe("blocked");

    service.update(task.id, { approvalPolicy: "low_risk_auto" }, true);
    const executor = jest.fn();
    const completed = await service.runDue(
      task.id,
      new Date("2026-09-28T10:30:00Z"),
      { authorize: async () => true },
      executor,
    );
    expect(completed.runHistory[completed.runHistory.length - 1]?.status).toBe("completed");
    expect(executor).toHaveBeenCalledTimes(1);

    const duplicate = await service.runDue(
      task.id,
      new Date("2026-09-28T10:35:00Z"),
      { authorize: async () => true },
      executor,
    );
    expect(duplicate.runHistory[duplicate.runHistory.length - 1]?.reason).toBe("duplicate run prevented");
    expect(executor).toHaveBeenCalledTimes(1);

    const retryTask = service.create({
      id: "task-2",
      originatingIdentity: "user-1",
      payload: { action: "rebalance_report" },
      windowStart: new Date("2026-09-28T12:00:00Z"),
      windowEnd: new Date("2026-09-28T13:00:00Z"),
      approvalPolicy: "low_risk_auto",
      missedWindowBehavior: "run_on_recovery",
    });
    const retryExecutor = jest
      .fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(undefined);

    const failed = await service.runDue(
      retryTask.id,
      new Date("2026-09-28T12:05:00Z"),
      { authorize: async () => true },
      retryExecutor,
    );
    expect(failed.runHistory[failed.runHistory.length - 1]?.status).toBe("failed");

    const retried = await service.runDue(
      retryTask.id,
      new Date("2026-09-28T12:06:00Z"),
      { authorize: async () => true },
      retryExecutor,
    );
    expect(retried.runHistory[retried.runHistory.length - 1]?.status).toBe("completed");
    expect(retryExecutor).toHaveBeenCalledTimes(2);
  });
});
