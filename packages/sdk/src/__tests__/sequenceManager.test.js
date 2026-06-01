"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
const sequenceManager_1 = require("../sequenceManager");
describe("SequenceManager", () => {
  let manager;
  const testAccountId = "GABC123TEST456";
  beforeEach(() => {
    manager = new sequenceManager_1.SequenceManager({
      cacheTTL: 1000, // 1 second for testing
      maxPendingTransactions: 10,
      autoRefresh: false, // Disable for tests
    });
  });
  afterEach(() => {
    manager.destroy();
  });
  describe("getNextSequence", () => {
    it("should fetch and return initial sequence", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        const info = yield manager.getNextSequence(
          testAccountId,
          fetchSequence
        );
        expect(fetchSequence).toHaveBeenCalledTimes(1);
        expect(info.current).toBe("100");
        expect(info.next).toBe("101");
        expect(info.pendingCount).toBe(1);
        expect(info.cached).toBe(false);
      }));
    it("should return cached sequence on subsequent calls", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        const info1 = yield manager.getNextSequence(
          testAccountId,
          fetchSequence
        );
        const info2 = yield manager.getNextSequence(
          testAccountId,
          fetchSequence
        );
        expect(fetchSequence).toHaveBeenCalledTimes(1);
        expect(info1.next).toBe("101");
        expect(info2.next).toBe("102");
        expect(info2.cached).toBe(true);
        expect(info2.pendingCount).toBe(2);
      }));
    it("should refresh after cache TTL expires", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest
          .fn()
          .mockResolvedValueOnce("100")
          .mockResolvedValueOnce("105");
        yield manager.getNextSequence(testAccountId, fetchSequence);
        // Wait for cache to expire
        yield new Promise((resolve) => setTimeout(resolve, 1100));
        const info = yield manager.getNextSequence(
          testAccountId,
          fetchSequence
        );
        expect(fetchSequence).toHaveBeenCalledTimes(2);
        expect(info.current).toBe("105");
        expect(info.next).toBe("106");
        expect(info.cached).toBe(false);
      }));
    it("should handle concurrent requests correctly", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        const promises = Array.from({ length: 5 }, () =>
          manager.getNextSequence(testAccountId, fetchSequence)
        );
        const results = yield Promise.all(promises);
        // Should only fetch once
        expect(fetchSequence).toHaveBeenCalledTimes(1);
        // Each should get a unique sequence
        const sequences = results.map((r) => r.next);
        expect(sequences).toEqual(["101", "102", "103", "104", "105"]);
      }));
    it("should handle multiple accounts independently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const account1 = "GABC123";
        const account2 = "GDEF456";
        const fetch1 = jest.fn().mockResolvedValue("100");
        const fetch2 = jest.fn().mockResolvedValue("200");
        const info1 = yield manager.getNextSequence(account1, fetch1);
        const info2 = yield manager.getNextSequence(account2, fetch2);
        expect(info1.next).toBe("101");
        expect(info2.next).toBe("201");
      }));
  });
  describe("reserveSequence", () => {
    it("should reserve a sequence number", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = yield manager.reserveSequence(
          testAccountId,
          "101",
          { type: "payment" }
        );
        expect(transaction).not.toBeNull();
        expect(
          transaction === null || transaction === void 0
            ? void 0
            : transaction.sequence
        ).toBe("101");
        expect(
          transaction === null || transaction === void 0
            ? void 0
            : transaction.status
        ).toBe("pending");
        expect(
          transaction === null || transaction === void 0
            ? void 0
            : transaction.metadata
        ).toEqual({ type: "payment" });
      }));
    it("should prevent duplicate sequence reservation", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield manager.reserveSequence(testAccountId, "101");
        const duplicate = yield manager.reserveSequence(testAccountId, "101");
        expect(duplicate).toBeNull();
      }));
    it("should enforce max pending transactions limit", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Reserve up to the limit
        for (let i = 0; i < 10; i++) {
          yield manager.reserveSequence(testAccountId, `${100 + i}`);
        }
        // Attempt to exceed limit
        yield expect(
          manager.reserveSequence(testAccountId, "110")
        ).rejects.toThrow("Maximum pending transactions");
      }));
    it("should allow reservations for different accounts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const account1 = "GABC123";
        const account2 = "GDEF456";
        const tx1 = yield manager.reserveSequence(account1, "101");
        const tx2 = yield manager.reserveSequence(account2, "101");
        expect(tx1).not.toBeNull();
        expect(tx2).not.toBeNull();
      }));
  });
  describe("markSubmitted", () => {
    it("should update transaction status to submitted", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield manager.reserveSequence(testAccountId, "101");
        yield manager.markSubmitted(testAccountId, "101", "hash123");
        const pending = manager.getPendingTransactions(testAccountId);
        expect(pending[0].status).toBe("submitted");
        expect(pending[0].hash).toBe("hash123");
      }));
    it("should handle non-existent sequence gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield expect(
          manager.markSubmitted(testAccountId, "999", "hash123")
        ).resolves.not.toThrow();
      }));
  });
  describe("markConfirmed", () => {
    it("should remove confirmed transaction from pending", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield manager.reserveSequence(testAccountId, "101");
        yield manager.markConfirmed(testAccountId, "101");
        const pending = manager.getPendingTransactions(testAccountId);
        expect(pending).toHaveLength(0);
      }));
    it("should update pending count in sequence info", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        yield manager.getNextSequence(testAccountId, fetchSequence);
        yield manager.reserveSequence(testAccountId, "101");
        yield manager.markConfirmed(testAccountId, "101");
        const info = manager.getSequenceInfo(testAccountId);
        expect(
          info === null || info === void 0 ? void 0 : info.pendingCount
        ).toBe(0);
      }));
  });
  describe("markFailed", () => {
    it("should remove failed transaction from pending", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield manager.reserveSequence(testAccountId, "101");
        yield manager.markFailed(testAccountId, "101");
        const pending = manager.getPendingTransactions(testAccountId);
        expect(pending).toHaveLength(0);
      }));
    it("should update pending count", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        yield manager.getNextSequence(testAccountId, fetchSequence);
        yield manager.reserveSequence(testAccountId, "101");
        yield manager.markFailed(testAccountId, "101");
        const info = manager.getSequenceInfo(testAccountId);
        expect(
          info === null || info === void 0 ? void 0 : info.pendingCount
        ).toBe(0);
      }));
  });
  describe("getPendingTransactions", () => {
    it("should return all pending transactions for an account", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield manager.reserveSequence(testAccountId, "101");
        yield manager.reserveSequence(testAccountId, "102");
        yield manager.reserveSequence(testAccountId, "103");
        const pending = manager.getPendingTransactions(testAccountId);
        expect(pending).toHaveLength(3);
        expect(pending.map((tx) => tx.sequence)).toEqual(["101", "102", "103"]);
      }));
    it("should return empty array for account with no pending", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const pending = manager.getPendingTransactions("UNKNOWN");
        expect(pending).toEqual([]);
      }));
    it("should return copies of transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield manager.reserveSequence(testAccountId, "101");
        const pending1 = manager.getPendingTransactions(testAccountId);
        const pending2 = manager.getPendingTransactions(testAccountId);
        expect(pending1).not.toBe(pending2);
        expect(pending1[0]).not.toBe(pending2[0]);
      }));
  });
  describe("getSequenceInfo", () => {
    it("should return cached sequence info", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        yield manager.getNextSequence(testAccountId, fetchSequence);
        const info = manager.getSequenceInfo(testAccountId);
        expect(info).not.toBeNull();
        expect(info === null || info === void 0 ? void 0 : info.current).toBe(
          "100"
        );
      }));
    it("should return null for unknown account", () => {
      const info = manager.getSequenceInfo("UNKNOWN");
      expect(info).toBeNull();
    });
    it("should return a copy of sequence info", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        yield manager.getNextSequence(testAccountId, fetchSequence);
        const info1 = manager.getSequenceInfo(testAccountId);
        const info2 = manager.getSequenceInfo(testAccountId);
        expect(info1).not.toBe(info2);
      }));
  });
  describe("refreshSequence", () => {
    it("should force refresh from network", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest
          .fn()
          .mockResolvedValueOnce("100")
          .mockResolvedValueOnce("105");
        yield manager.getNextSequence(testAccountId, fetchSequence);
        const info = yield manager.refreshSequence(
          testAccountId,
          fetchSequence
        );
        expect(fetchSequence).toHaveBeenCalledTimes(2);
        expect(info.current).toBe("105");
        expect(info.cached).toBe(false);
      }));
    it("should account for pending transactions when refreshing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        yield manager.getNextSequence(testAccountId, fetchSequence);
        yield manager.reserveSequence(testAccountId, "101");
        yield manager.reserveSequence(testAccountId, "102");
        const info = yield manager.refreshSequence(
          testAccountId,
          fetchSequence
        );
        // With 2 pending, next should be 103
        expect(info.pendingCount).toBe(2);
        expect(info.next).toBe("103");
      }));
  });
  describe("clearAccount", () => {
    it("should clear all data for an account", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        yield manager.getNextSequence(testAccountId, fetchSequence);
        yield manager.reserveSequence(testAccountId, "101");
        manager.clearAccount(testAccountId);
        const info = manager.getSequenceInfo(testAccountId);
        const pending = manager.getPendingTransactions(testAccountId);
        expect(info).toBeNull();
        expect(pending).toEqual([]);
      }));
  });
  describe("clearAll", () => {
    it("should clear all cached data", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetch1 = jest.fn().mockResolvedValue("100");
        const fetch2 = jest.fn().mockResolvedValue("200");
        yield manager.getNextSequence("GABC123", fetch1);
        yield manager.getNextSequence("GDEF456", fetch2);
        manager.clearAll();
        const stats = manager.getStats();
        expect(stats.accountsTracked).toBe(0);
        expect(stats.totalPending).toBe(0);
      }));
  });
  describe("getStats", () => {
    it("should return accurate statistics", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetch1 = jest.fn().mockResolvedValue("100");
        const fetch2 = jest.fn().mockResolvedValue("200");
        yield manager.getNextSequence("GABC123", fetch1);
        yield manager.getNextSequence("GABC123", fetch1);
        yield manager.getNextSequence("GDEF456", fetch2);
        const stats = manager.getStats();
        expect(stats.accountsTracked).toBe(2);
        expect(stats.totalPending).toBe(3);
        expect(stats.accountStats).toHaveLength(2);
      }));
    it("should include cache age information", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        yield manager.getNextSequence(testAccountId, fetchSequence);
        yield new Promise((resolve) => setTimeout(resolve, 100));
        const stats = manager.getStats();
        const accountStat = stats.accountStats[0];
        expect(accountStat.cacheAge).toBeGreaterThanOrEqual(100);
      }));
  });
  describe("Concurrent Operations", () => {
    it("should handle high concurrency correctly", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("1000");
        // Simulate 50 concurrent transaction requests
        const promises = Array.from({ length: 50 }, (_, i) =>
          __awaiter(void 0, void 0, void 0, function* () {
            const info = yield manager.getNextSequence(
              testAccountId,
              fetchSequence
            );
            yield manager.reserveSequence(testAccountId, info.next);
            return info.next;
          })
        );
        const sequences = yield Promise.all(promises);
        // All sequences should be unique
        const uniqueSequences = new Set(sequences);
        expect(uniqueSequences.size).toBe(50);
        // Should only fetch from network once
        expect(fetchSequence).toHaveBeenCalledTimes(1);
        // All pending transactions should be tracked
        const pending = manager.getPendingTransactions(testAccountId);
        expect(pending).toHaveLength(50);
      }));
    it("should handle mixed operations concurrently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest.fn().mockResolvedValue("100");
        const operations = [
          manager.getNextSequence(testAccountId, fetchSequence),
          manager.reserveSequence(testAccountId, "101"),
          manager.getNextSequence(testAccountId, fetchSequence),
          manager.markSubmitted(testAccountId, "101", "hash1"),
          manager.getNextSequence(testAccountId, fetchSequence),
        ];
        yield expect(Promise.all(operations)).resolves.not.toThrow();
      }));
  });
  describe("Edge Cases", () => {
    it("should handle very large sequence numbers", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const largeSeq = "999999999999999999";
        const fetchSequence = jest.fn().mockResolvedValue(largeSeq);
        const info = yield manager.getNextSequence(
          testAccountId,
          fetchSequence
        );
        expect(info.current).toBe(largeSeq);
        expect(info.next).toBe("1000000000000000000");
      }));
    it("should handle sequence number overflow gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const maxSeq = "18446744073709551615"; // Max uint64
        const fetchSequence = jest.fn().mockResolvedValue(maxSeq);
        const info = yield manager.getNextSequence(
          testAccountId,
          fetchSequence
        );
        expect(info.next).toBe("18446744073709551616");
      }));
    it("should handle fetch errors gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const fetchSequence = jest
          .fn()
          .mockRejectedValue(new Error("Network error"));
        yield expect(
          manager.getNextSequence(testAccountId, fetchSequence)
        ).rejects.toThrow("Network error");
      }));
  });
});
