import * as StellarSdk from "@stellar/stellar-sdk";
import {
  CompletenessEvidence,
  LedgerDiscontinuityError,
  PageTruncationError,
  ReconciliationBlockedByGapError,
} from "../../src/services/stellarIndexer/gapTypes";
import { GapQuarantineStore } from "../../src/services/stellarIndexer/gapQuarantineStore";
import { ContiguousCursorStore } from "../../src/services/stellarIndexer/contiguousCursorStore";
import { ReconciliationGate } from "../../src/services/stellarIndexer/reconciliationGate";
import { DeduplicatingDispatcher } from "../../src/services/stellarIndexer/deduplicatingDispatcher";
import { GapAwareEventIndexer } from "../../src/services/stellarIndexer/gapAwareEventIndexer";
import { GapRecoveryPipeline } from "../../src/services/stellarIndexer/gapRecoveryPipeline";
import { NormalizedEvent } from "../../src/services/stellarIndexer/eventNormalizer";

// Mock StellarSdk.SorobanRpc.Server
jest.mock("@stellar/stellar-sdk", () => {
  const original = jest.requireActual("@stellar/stellar-sdk") as any;
  return {
    ...original,
    SorobanRpc: {
      ...original.SorobanRpc,
      Server: jest.fn(),
    },
  };
});

describe("Ledger Ingestion Gap Detection & Completeness Verification (Issue #750)", () => {
  let quarantineStore: GapQuarantineStore;
  let cursorStore: ContiguousCursorStore;
  let reconciliationGate: ReconciliationGate;
  let dispatcher: DeduplicatingDispatcher;

  beforeEach(() => {
    quarantineStore = new GapQuarantineStore();
    cursorStore = new ContiguousCursorStore(quarantineStore);
    reconciliationGate = new ReconciliationGate(quarantineStore, cursorStore);
    dispatcher = new DeduplicatingDispatcher();
    jest.clearAllMocks();
  });

  describe("Acceptance Criterion 1: Cursor advancement is atomic with completeness evidence", () => {
    test("Advances cursor when evidence proves contiguous ingestion and page completeness", async () => {
      const streamId = "test-stream-1";

      const evidence: CompletenessEvidence = {
        streamId,
        startLedger: 100,
        endLedger: 105,
        totalEventsCount: 12,
        isPageComplete: true,
        expectedBoundaryReached: true,
        observedLedgers: [100, 101, 102, 103, 104, 105],
        evidenceHash: "pending",
        committedAt: new Date().toISOString(),
      };

      await cursorStore.advanceWithEvidence(streamId, 105, evidence, "evt-105-1");

      const cursor = await cursorStore.get(streamId);
      expect(cursor).not.toBeNull();
      expect(cursor?.lastContiguousLedger).toBe(105);
      expect(cursor?.lastEventId).toBe("evt-105-1");
      expect(cursor?.lastEvidence.isPageComplete).toBe(true);
      expect(cursor?.lastEvidence.expectedBoundaryReached).toBe(true);
      expect(cursor?.lastEvidence.evidenceHash).toHaveLength(64); // SHA-256 hash
    });

    test("Rejects cursor advancement if page is truncated or expected boundary is not reached", async () => {
      const streamId = "test-stream-2";

      const truncatedEvidence: CompletenessEvidence = {
        streamId,
        startLedger: 100,
        endLedger: 105,
        totalEventsCount: 100,
        isPageComplete: false, // Truncated!
        expectedBoundaryReached: false,
        observedLedgers: [100, 101, 102, 103, 104, 105],
        evidenceHash: "pending",
        committedAt: new Date().toISOString(),
      };

      await expect(
        cursorStore.advanceWithEvidence(streamId, 105, truncatedEvidence)
      ).rejects.toThrow(PageTruncationError);

      const cursor = await cursorStore.get(streamId);
      expect(cursor).toBeNull();
    });

    test("Detects ledger discontinuity, blocks advancement, and automatically quarantines the missing gap", async () => {
      const streamId = "test-stream-3";

      // Initialize cursor at ledger 100
      const baselineEvidence: CompletenessEvidence = {
        streamId,
        startLedger: 100,
        endLedger: 100,
        totalEventsCount: 1,
        isPageComplete: true,
        expectedBoundaryReached: true,
        observedLedgers: [100],
        evidenceHash: "pending",
        committedAt: new Date().toISOString(),
      };
      await cursorStore.advanceWithEvidence(streamId, 100, baselineEvidence);

      // Incoming batch starts at ledger 105 (Ledgers 101-104 are MISSING!)
      const discontinuousEvidence: CompletenessEvidence = {
        streamId,
        startLedger: 105,
        endLedger: 108,
        totalEventsCount: 5,
        isPageComplete: true,
        expectedBoundaryReached: true,
        observedLedgers: [105, 106, 107, 108],
        evidenceHash: "pending",
        committedAt: new Date().toISOString(),
      };

      await expect(
        cursorStore.advanceWithEvidence(streamId, 108, discontinuousEvidence)
      ).rejects.toThrow(LedgerDiscontinuityError);

      // Cursor must remain strictly at 100
      const cursor = await cursorStore.get(streamId);
      expect(cursor?.lastContiguousLedger).toBe(100);

      // Verify missing gap [101, 104] was quarantined
      const activeGaps = await quarantineStore.getActiveGaps(streamId);
      expect(activeGaps).toHaveLength(1);
      expect(activeGaps[0].fromLedger).toBe(101);
      expect(activeGaps[0].toLedger).toBe(104);
      expect(activeGaps[0].missingLedgersCount).toBe(4);
      expect(activeGaps[0].status).toBe("QUARANTINED");
    });
  });

  describe("Acceptance Criterion 2: Missing ledgers block dependent reconciliation", () => {
    test("Reconciliation is rejected when active quarantined gaps exist up to target ledger", async () => {
      const streamId = "reconcile-stream-1";

      // Set cursor at 100
      await cursorStore.reset(streamId, 100);

      // Quarantine gap for ledgers 101 to 103
      await quarantineStore.quarantineGap({
        streamId,
        fromLedger: 101,
        toLedger: 103,
        failureReason: "Dropped by provider",
      });

      // Attempt reconciliation for target ledger 102 (within the gap)
      const checkWithin = await reconciliationGate.checkReconciliationAllowed(streamId, 102);
      expect(checkWithin.allowed).toBe(false);
      expect(checkWithin.blockingGaps).toHaveLength(1);
      expect(checkWithin.reason).toContain("Reconciliation blocked");

      await expect(
        reconciliationGate.assertReconciliationAllowed(streamId, 102)
      ).rejects.toThrow(ReconciliationBlockedByGapError);

      // Attempt reconciliation for target ledger 105 (past the gap)
      const checkPast = await reconciliationGate.checkReconciliationAllowed(streamId, 105);
      expect(checkPast.allowed).toBe(false);
      expect(checkPast.blockingGaps.some((g) => g.fromLedger === 101)).toBe(true);

      await expect(
        reconciliationGate.assertReconciliationAllowed(streamId, 105)
      ).rejects.toThrow(ReconciliationBlockedByGapError);
    });

    test("Reconciliation is allowed once gaps are resolved and cursor is contiguous", async () => {
      const streamId = "reconcile-stream-2";

      const gap = await quarantineStore.quarantineGap({
        streamId,
        fromLedger: 101,
        toLedger: 103,
      });

      // Initially blocked
      expect((await reconciliationGate.checkReconciliationAllowed(streamId, 103)).allowed).toBe(false);

      // Resolve the gap and advance contiguous cursor to 103
      await quarantineStore.resolveGap(gap.gapId);
      await cursorStore.reset(streamId, 103);

      // Now allowed!
      const checkAfter = await reconciliationGate.checkReconciliationAllowed(streamId, 103);
      expect(checkAfter.allowed).toBe(true);
      expect(checkAfter.blockingGaps).toHaveLength(0);

      await expect(
        reconciliationGate.assertReconciliationAllowed(streamId, 103)
      ).resolves.not.toThrow();
    });
  });

  describe("Acceptance Criterion 3: Recovery backfills without duplicate side effects", () => {
    test("DeduplicatingDispatcher ensures replayed/backfilled events do not trigger duplicate side effects", async () => {
      let sideEffectCount = 0;
      const handledEvents: string[] = [];

      dispatcher.registerHandler({
        name: "test-side-effect-handler",
        accepts: () => true,
        handle: async (event) => {
          sideEffectCount++;
          handledEvents.push(event.id);
        },
      });

      const eventA: NormalizedEvent = {
        id: "evt-001",
        type: "soroban_contract",
        contractId: "C1",
        topics: ["swap"],
        payload: { amount: 100 },
        ledger: 101,
        ledgerClosedAt: "2026-09-27T00:00:00Z",
        txHash: "tx1",
      };

      const eventB: NormalizedEvent = {
        id: "evt-002",
        type: "soroban_contract",
        contractId: "C1",
        topics: ["transfer"],
        payload: { amount: 50 },
        ledger: 102,
        ledgerClosedAt: "2026-09-27T00:00:05Z",
        txHash: "tx2",
      };

      // 1. Initial live ingestion of eventA
      const result1 = await dispatcher.dispatch([eventA]);
      expect(result1.dispatchedCount).toBe(1);
      expect(result1.deduplicatedCount).toBe(0);
      expect(sideEffectCount).toBe(1);
      expect(handledEvents).toEqual(["evt-001"]);

      // 2. Replay / Backfill containing eventA again and new eventB
      const result2 = await dispatcher.dispatch([eventA, eventB]);
      expect(result2.dispatchedCount).toBe(1); // Only eventB dispatched
      expect(result2.deduplicatedCount).toBe(1); // eventA skipped!
      expect(sideEffectCount).toBe(2); // Total side effects executed: exactly 2
      expect(handledEvents).toEqual(["evt-001", "evt-002"]);

      // 3. Repeated backfill of both
      const result3 = await dispatcher.dispatch([eventA, eventB]);
      expect(result3.dispatchedCount).toBe(0);
      expect(result3.deduplicatedCount).toBe(2);
      expect(sideEffectCount).toBe(2); // No additional side effects!
    });

    test("GapRecoveryPipeline backfills quarantined gap, deduplicates events, and advances contiguous cursor", async () => {
      const streamId = "backfill-stream";
      await cursorStore.reset(streamId, 100);

      // Quarantine gap for ledgers 101-103
      const gap = await quarantineStore.quarantineGap({
        streamId,
        fromLedger: 101,
        toLedger: 103,
      });

      // Mock SorobanRpc response for backfill
      const mockGetEvents = jest.fn().mockResolvedValue({
        events: [
          {
            id: "evt-gap-101",
            type: "contract",
            ledger: 101,
            ledgerClosedAt: "2026-09-27T00:00:00Z",
            contractId: "C1",
            topic: [],
            value: {},
            inSuccessfulContractCall: true,
            txHash: "h101",
          },
          {
            id: "evt-gap-102",
            type: "contract",
            ledger: 102,
            ledgerClosedAt: "2026-09-27T00:00:05Z",
            contractId: "C1",
            topic: [],
            value: {},
            inSuccessfulContractCall: true,
            txHash: "h102",
          },
          {
            id: "evt-gap-103",
            type: "contract",
            ledger: 103,
            ledgerClosedAt: "2026-09-27T00:00:10Z",
            contractId: "C1",
            topic: [],
            value: {},
            inSuccessfulContractCall: true,
            txHash: "h103",
          },
        ],
      });

      (StellarSdk.SorobanRpc.Server as jest.Mock).mockImplementation(() => ({
        getEvents: mockGetEvents,
      }));

      let sideEffectCount = 0;
      dispatcher.registerHandler({
        name: "backfill-handler",
        accepts: () => true,
        handle: async () => {
          sideEffectCount++;
        },
      });

      const pipeline = new GapRecoveryPipeline(quarantineStore, cursorStore, dispatcher);
      const result = await pipeline.backfillGaps({
        streamId,
        rpcUrl: "https://soroban-testnet.stellar.org",
      });

      expect(result.totalGapsProcessed).toBe(1);
      expect(result.resolvedGaps).toContain(gap.gapId);
      expect(result.totalEventsIngested).toBe(3);
      expect(sideEffectCount).toBe(3);

      // Verify gap is marked RESOLVED
      const remainingActive = await quarantineStore.getActiveGaps(streamId);
      expect(remainingActive).toHaveLength(0);

      // Verify contiguous cursor advanced to 103
      const updatedCursor = await cursorStore.get(streamId);
      expect(updatedCursor?.lastContiguousLedger).toBe(103);
    });
  });

  describe("Acceptance Criterion 4: Tests cover pagination truncation, provider failover, and out-of-order delivery", () => {
    test("Pagination truncation: detects full page cut mid-ledger and does not advance past incomplete boundary", async () => {
      const streamId = "truncation-stream";
      await cursorStore.reset(streamId, 100);

      const pageSize = 4;
      // Mock returns 4 events (pageSize limit), all for ledger 101.
      // This means ledger 101 may have more events that were truncated!
      const mockGetEvents = jest.fn().mockResolvedValue({
        events: [
          { id: "e1", type: "contract", ledger: 101, topic: [], value: {}, txHash: "t1" },
          { id: "e2", type: "contract", ledger: 101, topic: [], value: {}, txHash: "t2" },
          { id: "e3", type: "contract", ledger: 101, topic: [], value: {}, txHash: "t3" },
          { id: "e4", type: "contract", ledger: 101, topic: [], value: {}, txHash: "t4" },
        ],
      });

      (StellarSdk.SorobanRpc.Server as jest.Mock).mockImplementation(() => ({
        getEvents: mockGetEvents,
      }));

      const indexer = new GapAwareEventIndexer(
        {
          streamId,
          rpcUrls: ["https://primary-rpc.stellar.org"],
          pageSize,
        },
        cursorStore,
        quarantineStore,
        dispatcher
      );

      const pollResult = await indexer.poll();

      // Page was truncated!
      expect(pollResult.pageTruncated).toBe(true);
      // Cursor must NOT have committed ledger 101 as fully processed
      expect(pollResult.committedLedger).toBe(100);

      const cursor = await cursorStore.get(streamId);
      expect(cursor?.lastContiguousLedger).toBe(100);
    });

    test("Pagination truncation with multi-ledger page: commits complete ledgers and bounds cursor before truncated tip", async () => {
      const streamId = "multi-truncation-stream";
      await cursorStore.reset(streamId, 100);

      const pageSize = 4;
      // Ledger 101 has 2 events, ledger 102 has 2 events and hits pageSize.
      // Ledger 101 is complete! Ledger 102 is potentially truncated.
      const mockGetEvents = jest.fn().mockResolvedValue({
        events: [
          { id: "e1", type: "contract", ledger: 101, topic: [], value: {}, txHash: "t1" },
          { id: "e2", type: "contract", ledger: 101, topic: [], value: {}, txHash: "t2" },
          { id: "e3", type: "contract", ledger: 102, topic: [], value: {}, txHash: "t3" },
          { id: "e4", type: "contract", ledger: 102, topic: [], value: {}, txHash: "t4" },
        ],
      });

      (StellarSdk.SorobanRpc.Server as jest.Mock).mockImplementation(() => ({
        getEvents: mockGetEvents,
      }));

      const indexer = new GapAwareEventIndexer(
        {
          streamId,
          rpcUrls: ["https://primary-rpc.stellar.org"],
          pageSize,
        },
        cursorStore,
        quarantineStore,
        dispatcher
      );

      const pollResult = await indexer.poll();

      expect(pollResult.pageTruncated).toBe(true);
      // Committed ledger is bounded to 101! Ledger 102 is held until complete.
      expect(pollResult.committedLedger).toBe(101);

      const cursor = await cursorStore.get(streamId);
      expect(cursor?.lastContiguousLedger).toBe(101);
    });

    test("Provider failover: automatically switches from failing primary RPC to healthy secondary RPC", async () => {
      const streamId = "failover-stream";
      await cursorStore.reset(streamId, 100);

      const primaryRpc = "https://failing-primary.stellar.org";
      const secondaryRpc = "https://healthy-secondary.stellar.org";

      let primaryCalls = 0;
      let secondaryCalls = 0;

      (StellarSdk.SorobanRpc.Server as jest.Mock).mockImplementation((url: string) => {
        if (url === primaryRpc) {
          return {
            getEvents: jest.fn().mockImplementation(async () => {
              primaryCalls++;
              throw new Error("Primary RPC connection timeout 504");
            }),
          };
        } else {
          return {
            getEvents: jest.fn().mockImplementation(async () => {
              secondaryCalls++;
              return {
                events: [
                  { id: "e1", type: "contract", ledger: 101, topic: [], value: {}, txHash: "t1" },
                ],
              };
            }),
          };
        }
      });

      const indexer = new GapAwareEventIndexer(
        {
          streamId,
          rpcUrls: [primaryRpc, secondaryRpc],
          pageSize: 100,
        },
        cursorStore,
        quarantineStore,
        dispatcher
      );

      const pollResult = await indexer.poll();

      expect(primaryCalls).toBe(1);
      expect(secondaryCalls).toBe(1);
      expect(pollResult.providerUsed).toBe(secondaryRpc);
      expect(pollResult.committedLedger).toBe(101);

      const cursor = await cursorStore.get(streamId);
      expect(cursor?.lastContiguousLedger).toBe(101);
    });

    test("Out-of-order delivery: stops cursor, quarantines gap, and preserves continuity", async () => {
      const streamId = "ooo-stream";
      await cursorStore.reset(streamId, 100);

      // RPC delivers events for ledger 105 when cursor expected 101
      const mockGetEvents = jest.fn().mockResolvedValue({
        events: [
          { id: "e105", type: "contract", ledger: 105, topic: [], value: {}, txHash: "t105" },
        ],
      });

      (StellarSdk.SorobanRpc.Server as jest.Mock).mockImplementation(() => ({
        getEvents: mockGetEvents,
      }));

      const indexer = new GapAwareEventIndexer(
        {
          streamId,
          rpcUrls: ["https://primary-rpc.stellar.org"],
          pageSize: 100,
        },
        cursorStore,
        quarantineStore,
        dispatcher
      );

      const pollResult = await indexer.poll();

      // Gap detected count
      expect(pollResult.detectedGapsCount).toBe(1);
      // Cursor did not jump to 105! Remains at 100
      expect(pollResult.committedLedger).toBe(100);

      const cursor = await cursorStore.get(streamId);
      expect(cursor?.lastContiguousLedger).toBe(100);

      // Missing gap 101-104 is quarantined for replay
      const activeGaps = await quarantineStore.getActiveGaps(streamId);
      expect(activeGaps).toHaveLength(1);
      expect(activeGaps[0].fromLedger).toBe(101);
      expect(activeGaps[0].toLedger).toBe(104);
    });
  });
});
