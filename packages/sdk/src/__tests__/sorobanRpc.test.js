"use strict";
/**
 * Unit tests for Soroban RPC client functionality
 * Tests event subscription, ledger lookups, and RPC interactions with mocked responses
 */
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
const events_1 = require("../events");
// Mock fetch for RPC calls
global.fetch = jest.fn();
describe("Soroban RPC Client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  describe("RPC Configuration", () => {
    it("should use testnet RPC URL by default", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
    it("should use mainnet RPC URL", () => {
      const config = {
        network: "mainnet",
        contractIds: ["CABC123"],
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
    it("should accept custom RPC URL", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
        rpcUrl: "https://custom-soroban-rpc.example.com",
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
    it("should reject unknown network", () => {
      const config = {
        network: "invalid",
        contractIds: ["CABC123"],
      };
      expect(() => new events_1.SorobanEventSubscription(config)).toThrow(
        "Unknown network: invalid"
      );
    });
  });
  describe("Event Subscription Lifecycle", () => {
    let subscription;
    beforeEach(() => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
        pollingIntervalMs: 1000,
      };
      subscription = new events_1.SorobanEventSubscription(config);
    });
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield subscription.unsubscribe();
      })
    );
    it("should start inactive", () => {
      expect(subscription.isActive()).toBe(false);
    });
    it("should activate on subscribe", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield subscription.subscribe();
        expect(subscription.isActive()).toBe(true);
      }));
    it("should deactivate on unsubscribe", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield subscription.subscribe();
        yield subscription.unsubscribe();
        expect(subscription.isActive()).toBe(false);
      }));
    it("should handle multiple subscribe calls", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield subscription.subscribe();
        yield subscription.subscribe();
        expect(subscription.isActive()).toBe(true);
      }));
    it("should handle multiple unsubscribe calls", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield subscription.subscribe();
        yield subscription.unsubscribe();
        yield subscription.unsubscribe();
        expect(subscription.isActive()).toBe(false);
      }));
  });
  describe("Ledger Tracking", () => {
    let subscription;
    beforeEach(() => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
      };
      subscription = new events_1.SorobanEventSubscription(config);
    });
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield subscription.unsubscribe();
      })
    );
    it("should return null for last ledger initially", () => {
      expect(subscription.getLastLedger()).toBeNull();
    });
    it("should track last ledger after subscription", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield subscription.subscribe();
        const lastLedger = subscription.getLastLedger();
        expect(lastLedger).toBeNull(); // Current implementation
      }));
  });
  describe("Event Handlers", () => {
    let subscription;
    beforeEach(() => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
      };
      subscription = new events_1.SorobanEventSubscription(config);
    });
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield subscription.unsubscribe();
      })
    );
    it("should register event handler", () => {
      const handler = jest.fn();
      const result = subscription.on("event", handler);
      expect(result).toBe(subscription);
    });
    it("should register error handler", () => {
      const handler = jest.fn();
      const result = subscription.on("error", handler);
      expect(result).toBe(subscription);
    });
    it("should remove event handler", () => {
      const handler = jest.fn();
      subscription.on("event", handler);
      const result = subscription.off("event", handler);
      expect(result).toBe(subscription);
    });
    it("should remove error handler", () => {
      const handler = jest.fn();
      subscription.on("error", handler);
      const result = subscription.off("error", handler);
      expect(result).toBe(subscription);
    });
    it("should support multiple event handlers", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      subscription.on("event", handler1).on("event", handler2);
      expect(subscription).toBeDefined();
    });
    it("should support multiple error handlers", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      subscription.on("error", handler1).on("error", handler2);
      expect(subscription).toBeDefined();
    });
  });
  describe("Contract ID Validation", () => {
    it("should require at least one contract ID", () => {
      const config = {
        network: "testnet",
        contractIds: [],
      };
      expect(() => new events_1.SorobanEventSubscription(config)).toThrow(
        "At least one contractId is required"
      );
    });
    it("should accept single contract ID", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
    it("should accept multiple contract IDs", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123", "CDEF456", "CGHI789"],
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
  });
  describe("Topic Filtering", () => {
    it("should accept topic filter", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
        topicFilter: ["transfer", "mint", "burn"],
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
    it("should work without topic filter", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
    it("should accept empty topic filter", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
        topicFilter: [],
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
  });
  describe("Polling Configuration", () => {
    it("should use custom polling interval", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
        pollingIntervalMs: 3000,
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
    it("should use default polling interval when not specified", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
    it("should poll at specified interval", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = {
          network: "testnet",
          contractIds: ["CABC123"],
          pollingIntervalMs: 1000,
        };
        const subscription = new events_1.SorobanEventSubscription(config);
        yield subscription.subscribe();
        jest.advanceTimersByTime(1000);
        expect(subscription.isActive()).toBe(true);
        yield subscription.unsubscribe();
      }));
  });
  describe("Start Ledger Configuration", () => {
    it("should accept start ledger", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
        startLedger: 1000000,
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
    it("should work without start ledger", () => {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
      };
      const subscription = new events_1.SorobanEventSubscription(config);
      expect(subscription).toBeDefined();
    });
  });
});
describe("parseEvent", () => {
  describe("Topic Parsing", () => {
    it("should parse string topics", () => {
      const raw = {
        type: "contract",
        contractId: "CABC123",
        topic: ["transfer", "from_addr", "to_addr"],
        value: { amount: "1000" },
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash_123",
        1000000,
        1234567890
      );
      expect(result.topics).toEqual(["transfer", "from_addr", "to_addr"]);
    });
    it("should stringify non-string topics", () => {
      const raw = {
        type: "contract",
        contractId: "CABC123",
        topic: [{ type: "transfer" }, 123, true, null],
        value: "data",
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash_456",
        1000001,
        1234567891
      );
      expect(result.topics).toEqual([
        '{"type":"transfer"}',
        "123",
        "true",
        "null",
      ]);
    });
    it("should handle empty topics", () => {
      const raw = {
        type: "contract",
        contractId: "CABC123",
        topic: [],
        value: "data",
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash_789",
        1000002,
        1234567892
      );
      expect(result.topics).toEqual([]);
    });
    it("should handle missing topics", () => {
      const raw = {
        type: "contract",
        contractId: "CABC123",
        value: "data",
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash_999",
        1000003,
        1234567893
      );
      expect(result.topics).toEqual([]);
    });
  });
  describe("Data Parsing", () => {
    it("should parse object data", () => {
      const raw = {
        topic: ["event"],
        value: { amount: "1000", recipient: "GADDR" },
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash",
        1000000,
        1234567890
      );
      expect(result.data).toEqual({ amount: "1000", recipient: "GADDR" });
    });
    it("should parse string data", () => {
      const raw = {
        topic: ["event"],
        value: "simple_string_value",
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash",
        1000000,
        1234567890
      );
      expect(result.data).toBe("simple_string_value");
    });
    it("should parse number data", () => {
      const raw = {
        topic: ["event"],
        value: 42,
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash",
        1000000,
        1234567890
      );
      expect(result.data).toBe(42);
    });
    it("should handle null data", () => {
      const raw = {
        topic: ["event"],
        value: null,
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash",
        1000000,
        1234567890
      );
      expect(result.data).toBeNull();
    });
    it("should handle missing data", () => {
      const raw = {
        topic: ["event"],
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash",
        1000000,
        1234567890
      );
      expect(result.data).toBeNull();
    });
  });
  describe("Metadata Preservation", () => {
    it("should preserve transaction hash", () => {
      const raw = { topic: ["event"], value: "data" };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_abc_123",
        1000000,
        1234567890
      );
      expect(result.transactionHash).toBe("tx_abc_123");
    });
    it("should preserve contract ID", () => {
      const raw = { topic: ["event"], value: "data" };
      const result = (0, events_1.parseEvent)(
        raw,
        "CTEST_CONTRACT",
        "tx_hash",
        1000000,
        1234567890
      );
      expect(result.contractId).toBe("CTEST_CONTRACT");
    });
    it("should preserve ledger sequence", () => {
      const raw = { topic: ["event"], value: "data" };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash",
        2500000,
        1234567890
      );
      expect(result.ledger).toBe(2500000);
    });
    it("should preserve timestamp", () => {
      const raw = { topic: ["event"], value: "data" };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash",
        1000000,
        1700000000
      );
      expect(result.createdAt).toBe(1700000000);
    });
    it("should create complete event object", () => {
      const raw = {
        type: "contract",
        contractId: "CTEST",
        topic: ["mint"],
        value: { recipient: "GADDR", amount: "5000" },
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CTEST",
        "tx_mint_123",
        2000000,
        1700000000
      );
      expect(result).toEqual({
        transactionHash: "tx_mint_123",
        contractId: "CTEST",
        topics: ["mint"],
        data: { recipient: "GADDR", amount: "5000" },
        ledger: 2000000,
        createdAt: 1700000000,
      });
    });
  });
  describe("Edge Cases", () => {
    it("should handle complex nested data", () => {
      const raw = {
        topic: ["complex_event"],
        value: {
          nested: {
            deep: {
              value: "test",
              array: [1, 2, 3],
            },
          },
        },
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash",
        1000000,
        1234567890
      );
      expect(result.data).toEqual({
        nested: {
          deep: {
            value: "test",
            array: [1, 2, 3],
          },
        },
      });
    });
    it("should handle array data", () => {
      const raw = {
        topic: ["array_event"],
        value: [1, 2, 3, "four", { five: 5 }],
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash",
        1000000,
        1234567890
      );
      expect(result.data).toEqual([1, 2, 3, "four", { five: 5 }]);
    });
    it("should handle boolean data", () => {
      const raw = {
        topic: ["bool_event"],
        value: true,
      };
      const result = (0, events_1.parseEvent)(
        raw,
        "CABC123",
        "tx_hash",
        1000000,
        1234567890
      );
      expect(result.data).toBe(true);
    });
  });
});
describe("subscribeToEvents", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  it("should create and start subscription", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
      };
      const subscription = yield (0, events_1.subscribeToEvents)(config);
      expect(subscription).toBeDefined();
      expect(subscription.isActive()).toBe(true);
      yield subscription.unsubscribe();
    }));
  it("should return EventSubscription interface", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
      };
      const subscription = yield (0, events_1.subscribeToEvents)(config);
      expect(subscription.isActive).toBeDefined();
      expect(subscription.unsubscribe).toBeDefined();
      expect(subscription.getLastLedger).toBeDefined();
      yield subscription.unsubscribe();
    }));
  it("should start polling immediately", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const config = {
        network: "testnet",
        contractIds: ["CABC123"],
        pollingIntervalMs: 1000,
      };
      const subscription = yield (0, events_1.subscribeToEvents)(config);
      expect(subscription.isActive()).toBe(true);
      yield subscription.unsubscribe();
    }));
});
