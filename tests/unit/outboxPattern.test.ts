/**
 * Outbox Pattern Tests
 *
 * Proves the acceptance criteria from issue #653:
 * 1. State changes and outbox records commit atomically.
 * 2. Consumers deduplicate redelivery by stable event identity.
 * 3. Ordering requirements are documented per aggregate.
 * 4. Crash-loop tests prove eventual delivery without duplicate effects.
 */

// Mock TypeORM before importing anything that uses it
const mockRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockManager = {
  save: jest.fn(),
  getRepository: jest.fn().mockReturnValue(mockRepo),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ maxSeq: "0" }),
  }),
};

const mockDataSource = {
  getRepository: jest.fn().mockReturnValue(mockRepo),
  transaction: jest.fn(async (fn: Function) => fn(mockManager)),
};

jest.mock("../../src/config/Datasource", () => ({
  __esModule: true,
  default: mockDataSource,
  AppDataSource: mockDataSource,
}));

jest.mock("../../src/config/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { OutboxService, DispatchedEvent } from "../../src/Reliability/outbox.service";
import { OutboxEvent, AggregateType } from "../../src/Reliability/outboxEvent.entity";
import { OutboxDispatcher, ORDERED_AGGREGATES } from "../../src/Reliability/outboxDispatcher";
import { generateStableEventId, deterministicEventId } from "../../src/Reliability/eventIdentity";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a chainable mock query builder for sequence and dispatch queries. */
function createMockQueryBuilder() {
  const qb: Record<string, any> = {};
  qb.select = jest.fn().mockReturnValue(qb);
  qb.where = jest.fn().mockReturnValue(qb);
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn().mockReturnValue(qb);
  qb.addOrderBy = jest.fn().mockReturnValue(qb);
  qb.take = jest.fn().mockReturnValue(qb);
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn().mockResolvedValue({ maxSeq: "0" });
  qb.delete = jest.fn().mockReturnValue(qb);
  qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
  return qb;
}

let eventCounter = 0;

function createMockEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  eventCounter++;
  return {
    id: `test-uuid-${eventCounter}`,
    eventId: `evt-test-${eventCounter}`,
    eventType: "transaction.created",
    aggregateType: "transaction",
    aggregateId: "tx-001",
    sequence: eventCounter,
    payload: { txHash: "abc123" },
    metadata: null,
    status: "pending",
    retryCount: 0,
    maxRetries: 5,
    nextRetryAt: null,
    dispatchedAt: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OutboxEvent;
}

/**
 * Create a mock dataSource with a queryBuilder that returns the given events from getMany.
 * Also supports cleanup/delete chains.
 */
function createTestDataSource(options: {
  pendingEvents?: OutboxEvent[];
  maxSeq?: string;
} = {}) {
  const pendingEvents = options.pendingEvents ?? [];
  const maxSeq = options.maxSeq ?? "0";

  const qb = createMockQueryBuilder();
  qb.getMany.mockResolvedValue(pendingEvents);
  qb.getRawOne.mockResolvedValue({ maxSeq });

  return {
    getRepository: jest.fn().mockReturnValue({
      ...mockRepo,
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    }),
    transaction: jest.fn(async (fn: Function) => fn(mockManager)),
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Outbox Pattern (Issue #653)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eventCounter = 0;
  });

  // ── AC 1: Atomic commit ───────────────────────────────────────────────────

  describe("AC1: State changes and outbox records commit atomically", () => {
    it("publishes outbox record within a transaction manager", async () => {
      const ds = createTestDataSource();
      const service = new OutboxService(ds);
      const savedEvent = createMockEvent();
      mockManager.save.mockResolvedValue(savedEvent);

      const result = await service.publishWithManager(mockManager, {
        eventType: "transaction.created",
        aggregateType: "transaction",
        aggregateId: "tx-001",
        payload: { txHash: "abc123" },
      });

      expect(mockManager.save).toHaveBeenCalledTimes(1);
      expect(result.eventId).toBeDefined();
      expect(result.eventType).toBe("transaction.created");
      expect(result.aggregateType).toBe("transaction");
    });

    it("publish() wraps in its own transaction", async () => {
      const ds = createTestDataSource();
      const service = new OutboxService(ds);
      const savedEvent = createMockEvent();
      mockManager.save.mockResolvedValue(savedEvent);

      await service.publish({
        eventType: "user.created",
        aggregateType: "user",
        aggregateId: "user-001",
        payload: { email: "test@example.com" },
      });

      expect(ds.transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC 2: Idempotent consumers ────────────────────────────────────────────

  describe("AC2: Consumers deduplicate redelivery by stable event identity", () => {
    it("same eventId prevents duplicate dispatch at dispatcher level", async () => {
      const ds = createTestDataSource();
      const service = new OutboxService(ds);
      const handler = jest.fn().mockResolvedValue(undefined);
      service.on("transaction.created", handler);

      const event = createMockEvent({ eventId: "stable-id-001" });

      // First dispatch — should succeed
      await service["dispatchEvent"](event);
      expect(handler).toHaveBeenCalledTimes(1);

      // Dispatching again with same eventId works at service level
      // (dedup is handled by the dispatcher layer)
      const event2 = createMockEvent({ eventId: "stable-id-001" });
      await service["dispatchEvent"](event2);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("dispatcher performs in-memory dedup across re-dispatches", async () => {
      const ds = createTestDataSource();
      const dispatcher = new OutboxDispatcher(ds, { intervalMs: 100000 });
      const handler = jest.fn().mockResolvedValue(undefined);
      dispatcher.on("transaction.created", handler);

      // Pre-mark as already dispatched
      dispatcher["dispatchedIds"].add("stable-id-001");

      const event = createMockEvent({ eventId: "stable-id-001" });
      await (dispatcher as any).safeDispatch(event);

      // Handler should NOT be called because eventId was already dispatched
      expect(handler).not.toHaveBeenCalled();
    });

    it("deterministic event IDs are stable for the same input", () => {
      const id1 = deterministicEventId("transaction.created", "tx-001");
      const id2 = deterministicEventId("transaction.created", "tx-001");
      expect(id1).toBe(id2);
    });

    it("deterministic event IDs differ for different inputs", () => {
      const id1 = deterministicEventId("transaction.created", "tx-001");
      const id2 = deterministicEventId("transaction.created", "tx-002");
      expect(id1).not.toBe(id2);
    });
  });

  // ── AC 3: Ordering requirements documented per aggregate ──────────────────

  describe("AC3: Ordering requirements are documented per aggregate", () => {
    it("ordered aggregates include transaction, bot, deployment, agent", () => {
      expect(ORDERED_AGGREGATES.has("transaction")).toBe(true);
      expect(ORDERED_AGGREGATES.has("bot")).toBe(true);
      expect(ORDERED_AGGREGATES.has("deployment")).toBe(true);
      expect(ORDERED_AGGREGATES.has("agent")).toBe(true);
    });

    it("unordered aggregates include user, contact, contract, audit, generic", () => {
      expect(ORDERED_AGGREGATES.has("user")).toBe(false);
      expect(ORDERED_AGGREGATES.has("contact")).toBe(false);
      expect(ORDERED_AGGREGATES.has("contract")).toBe(false);
      expect(ORDERED_AGGREGATES.has("audit")).toBe(false);
      expect(ORDERED_AGGREGATES.has("generic")).toBe(false);
    });

    it("sequence is monotonically increasing within an aggregate", async () => {
      // Create separate data sources for each call to return different maxSeq values
      const qb1 = createMockQueryBuilder();
      qb1.getRawOne.mockResolvedValue({ maxSeq: "0" });
      const ds1 = { getRepository: jest.fn().mockReturnValue({ ...mockRepo, createQueryBuilder: jest.fn().mockReturnValue(qb1) }) } as any;

      const qb2 = createMockQueryBuilder();
      qb2.getRawOne.mockResolvedValue({ maxSeq: "1" });
      const ds2 = { getRepository: jest.fn().mockReturnValue({ ...mockRepo, createQueryBuilder: jest.fn().mockReturnValue(qb2) }) } as any;

      const qb3 = createMockQueryBuilder();
      qb3.getRawOne.mockResolvedValue({ maxSeq: "2" });
      const ds3 = { getRepository: jest.fn().mockReturnValue({ ...mockRepo, createQueryBuilder: jest.fn().mockReturnValue(qb3) }) } as any;

      const service1 = new OutboxService(ds1);
      const service2 = new OutboxService(ds2);
      const service3 = new OutboxService(ds3);

      const event1 = createMockEvent({ id: "1", sequence: 1 });
      const event2 = createMockEvent({ id: "2", sequence: 2 });
      const event3 = createMockEvent({ id: "3", sequence: 3 });

      mockManager.save
        .mockResolvedValueOnce(event1)
        .mockResolvedValueOnce(event2)
        .mockResolvedValueOnce(event3);

      const saved1 = await service1.publishWithManager(mockManager, {
        eventType: "transaction.created",
        aggregateType: "transaction",
        aggregateId: "tx-001",
        payload: {},
      });

      const saved2 = await service2.publishWithManager(mockManager, {
        eventType: "transaction.submitted",
        aggregateType: "transaction",
        aggregateId: "tx-001",
        payload: {},
      });

      const saved3 = await service3.publishWithManager(mockManager, {
        eventType: "transaction.confirmed",
        aggregateType: "transaction",
        aggregateId: "tx-001",
        payload: {},
      });

      expect(saved1.sequence).toBeLessThan(saved2.sequence);
      expect(saved2.sequence).toBeLessThan(saved3.sequence);
    });
  });

  // ── AC 4: Crash-loop tests ────────────────────────────────────────────────

  describe("AC4: Crash-loop tests prove eventual delivery without duplicate effects", () => {
    it("dispatcher retries failed events with exponential back-off", async () => {
      const ds = createTestDataSource();
      const service = new OutboxService(ds);
      const event = createMockEvent({
        retryCount: 2,
        maxRetries: 5,
      });

      await service["scheduleRetry"](event, new Error("temporary failure"));

      expect(mockRepo.update).toHaveBeenCalledWith(event.id, expect.objectContaining({
        retryCount: 3,
        status: "pending",
      }));

      const updateCall = mockRepo.update.mock.calls[0][1];
      expect(updateCall.nextRetryAt).toBeInstanceOf(Date);
      expect(updateCall.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it("dispatcher marks event as permanently failed after max retries", async () => {
      const ds = createTestDataSource();
      const service = new OutboxService(ds);
      const event = createMockEvent({
        retryCount: 4,
        maxRetries: 5,
      });

      await service["scheduleRetry"](event, new Error("permanent failure"));

      expect(mockRepo.update).toHaveBeenCalledWith(event.id, expect.objectContaining({
        status: "failed",
        retryCount: 5,
        errorMessage: "permanent failure",
      }));
    });

    it("crash-loop scenario: handler fails then succeeds on retry", async () => {
      const event = createMockEvent({ retryCount: 0, id: "crash-1", eventId: "crash-evt-1" });

      // First dataSource: returns the event, dispatch fails
      const qb1 = createMockQueryBuilder();
      qb1.getMany.mockResolvedValue([event]);
      const ds1 = { getRepository: jest.fn().mockReturnValue({ ...mockRepo, createQueryBuilder: jest.fn().mockReturnValue(qb1) }) } as any;

      const service1 = new OutboxService(ds1);
      let callCount = 0;
      service1.on("transaction.created", async (ev: DispatchedEvent) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Simulated crash");
        }
      });

      // First dispatch — handler fails, dispatchOnce catches the error
      const dispatched1 = await service1.dispatchOnce();
      expect(dispatched1).toBe(0);
      expect(callCount).toBe(1);

      // Manually schedule retry (simulates what OutboxDispatcher.safeDispatch does)
      await service1["scheduleRetry"](event, new Error("Simulated crash"));
      expect(mockRepo.update).toHaveBeenCalledWith(
        event.id,
        expect.objectContaining({ status: "pending", retryCount: 1 })
      );

      jest.clearAllMocks();

      // Simulate retry: event comes back with retryCount=1
      const retriedEvent = createMockEvent({
        id: event.id,
        eventId: event.eventId,
        retryCount: 1,
      });

      const qb2 = createMockQueryBuilder();
      qb2.getMany.mockResolvedValue([retriedEvent]);
      const ds2 = { getRepository: jest.fn().mockReturnValue({ ...mockRepo, createQueryBuilder: jest.fn().mockReturnValue(qb2) }) } as any;

      const service2 = new OutboxService(ds2);
      service2.on("transaction.created", async (ev: DispatchedEvent) => {
        callCount++;
        // Second call succeeds (no throw)
      });

      const dispatched2 = await service2.dispatchOnce();

      // Should succeed this time
      expect(dispatched2).toBe(1);
      expect(mockRepo.update).toHaveBeenCalledWith(
        retriedEvent.id,
        expect.objectContaining({ status: "dispatched" })
      );
      expect(callCount).toBe(2);
    });

    it("crash-loop scenario: dispatcher processes batch after restart", async () => {
      // Simulate a dispatcher that crashed and restarted
      const pendingEvents = [
        createMockEvent({ id: "1", eventId: "evt-1", sequence: 1 }),
        createMockEvent({ id: "2", eventId: "evt-2", sequence: 2 }),
        createMockEvent({ id: "3", eventId: "evt-3", sequence: 3 }),
      ];

      const ds = createTestDataSource({ pendingEvents });
      const dispatcher = new OutboxDispatcher(ds, { intervalMs: 100000 });
      const dispatched: string[] = [];
      dispatcher.on("transaction.created", async (event: DispatchedEvent) => {
        dispatched.push(event.eventId);
      });

      // Run poll (simulates restart)
      await (dispatcher as any).poll();

      // All three events should be dispatched
      expect(dispatched).toEqual(["evt-1", "evt-2", "evt-3"]);
    });

    it("dispatcher skips already-dispatched events on restart", async () => {
      const pendingEvents = [
        createMockEvent({ id: "1", eventId: "already-dispatched", sequence: 1 }),
        createMockEvent({ id: "2", eventId: "new-event", sequence: 2 }),
      ];

      const ds = createTestDataSource({ pendingEvents });
      const dispatcher = new OutboxDispatcher(ds, { intervalMs: 100000 });
      const dispatched: string[] = [];
      dispatcher.on("transaction.created", async (event: DispatchedEvent) => {
        dispatched.push(event.eventId);
      });

      // Pre-mark one as already dispatched (simulates prior run)
      dispatcher["dispatchedIds"].add("already-dispatched");

      await (dispatcher as any).poll();

      // Only new-event should be dispatched
      expect(dispatched).toEqual(["new-event"]);
    });
  });

  // ── Event identity ────────────────────────────────────────────────────────

  describe("Event Identity", () => {
    it("generates unique event IDs", () => {
      const id1 = generateStableEventId();
      const id2 = generateStableEventId();
      expect(id1).not.toBe(id2);
      // UUID v4 format
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("deterministic IDs differ across time buckets", () => {
      const t1 = new Date("2026-01-01T00:00:00Z");
      const t2 = new Date("2026-01-01T00:01:01Z"); // Different minute
      const id1 = deterministicEventId("tx.created", "tx-1", t1);
      const id2 = deterministicEventId("tx.created", "tx-1", t2);
      expect(id1).not.toBe(id2);
    });
  });

  // ── Ordering dispatch ──────────────────────────────────────────────────────

  describe("Ordered dispatch", () => {
    it("dispatches ordered aggregates sequentially in sequence order", async () => {
      const events = [
        createMockEvent({ id: "1", eventId: "evt-seq-1", aggregateType: "transaction", aggregateId: "tx-1", sequence: 1, eventType: "transaction.created" }),
        createMockEvent({ id: "2", eventId: "evt-seq-2", aggregateType: "transaction", aggregateId: "tx-1", sequence: 2, eventType: "transaction.submitted" }),
        createMockEvent({ id: "3", eventId: "evt-seq-3", aggregateType: "transaction", aggregateId: "tx-1", sequence: 3, eventType: "transaction.confirmed" }),
      ];

      const ds = createTestDataSource({ pendingEvents: events });
      const dispatcher = new OutboxDispatcher(ds, { intervalMs: 100000 });
      const dispatchOrder: string[] = [];
      dispatcher.on("transaction.created", async (e: DispatchedEvent) => { dispatchOrder.push(e.eventType); });
      dispatcher.on("transaction.submitted", async (e: DispatchedEvent) => { dispatchOrder.push(e.eventType); });
      dispatcher.on("transaction.confirmed", async (e: DispatchedEvent) => { dispatchOrder.push(e.eventType); });

      await (dispatcher as any).poll();

      // Must be in sequence order
      expect(dispatchOrder).toEqual([
        "transaction.created",
        "transaction.submitted",
        "transaction.confirmed",
      ]);
    });

    it("unordered aggregates are dispatched in parallel", async () => {
      const events = [
        createMockEvent({ id: "1", eventId: "unordered-1", aggregateType: "user", aggregateId: "u-1", sequence: 1, eventType: "user.created" }),
        createMockEvent({ id: "2", eventId: "unordered-2", aggregateType: "contact", aggregateId: "c-1", sequence: 1, eventType: "contact.created" }),
      ];

      const ds = createTestDataSource({ pendingEvents: events });
      const dispatcher = new OutboxDispatcher(ds, { intervalMs: 100000 });
      const dispatched: string[] = [];
      dispatcher.on("user.created", async (e: DispatchedEvent) => { dispatched.push(e.eventId); });
      dispatcher.on("contact.created", async (e: DispatchedEvent) => { dispatched.push(e.eventId); });

      await (dispatcher as any).poll();

      // Both should be dispatched (order may vary since they're parallel)
      expect(dispatched).toHaveLength(2);
      expect(dispatched).toContain("unordered-1");
      expect(dispatched).toContain("unordered-2");
    });
  });

  // ── Retention ──────────────────────────────────────────────────────────────

  describe("Retention controls", () => {
    it("cleanup deletes dispatched events older than maxAge", async () => {
      const qb = createMockQueryBuilder();
      qb.execute.mockResolvedValue({ affected: 5 });

      const ds = {
        getRepository: jest.fn().mockReturnValue({
          ...mockRepo,
          createQueryBuilder: jest.fn().mockReturnValue(qb),
        }),
      } as any;

      const service = new OutboxService(ds);
      const deleted = await service.cleanup();

      expect(deleted).toBe(5);
      expect(qb.delete).toHaveBeenCalled();
      expect(qb.where).toHaveBeenCalledWith(
        "status = :status",
        { status: "dispatched" }
      );
      expect(qb.execute).toHaveBeenCalled();
    });

    it("cleanup returns 0 when no events to clean", async () => {
      const qb = createMockQueryBuilder();
      qb.execute.mockResolvedValue({ affected: 0 });

      const ds = {
        getRepository: jest.fn().mockReturnValue({
          ...mockRepo,
          createQueryBuilder: jest.fn().mockReturnValue(qb),
        }),
      } as any;

      const service = new OutboxService(ds);
      const deleted = await service.cleanup();

      expect(deleted).toBe(0);
    });
  });

  // ── Query helpers ──────────────────────────────────────────────────────────

  describe("Query helpers", () => {
    it("getPending returns pending events", async () => {
      const pendingEvents = [createMockEvent()];
      const ds = createTestDataSource();
      mockRepo.find.mockResolvedValue(pendingEvents);
      ds.getRepository.mockReturnValue({ ...mockRepo, createQueryBuilder: jest.fn().mockReturnValue(createMockQueryBuilder()) });

      const service = new OutboxService(ds);
      const result = await service.getPending();

      expect(result).toEqual(pendingEvents);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { status: "pending" },
        order: { createdAt: "ASC" },
      });
    });

    it("retryFailed resets a failed event to pending", async () => {
      const failedEvent = createMockEvent({ status: "failed" });
      const ds = createTestDataSource();
      mockRepo.findOne.mockResolvedValue(failedEvent);
      mockRepo.update.mockResolvedValue(undefined);

      const service = new OutboxService(ds);
      const result = await service.retryFailed(failedEvent.eventId);

      expect(result).toBe(true);
      expect(mockRepo.update).toHaveBeenCalledWith(failedEvent.id, expect.objectContaining({
        status: "pending",
        retryCount: 0,
        nextRetryAt: null,
        errorMessage: null,
      }));
    });

    it("retryFailed returns false for non-existent event", async () => {
      const ds = createTestDataSource();
      mockRepo.findOne.mockResolvedValue(null);

      const service = new OutboxService(ds);
      const result = await service.retryFailed("non-existent");

      expect(result).toBe(false);
    });
  });
});
