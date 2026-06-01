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
const soroban_1 = require("../soroban");
describe("SorobanBatchBuilder", () => {
  describe("addTransaction", () => {
    it("should add a single transaction to the batch", () => {
      const builder = new soroban_1.SorobanBatchBuilder("testnet");
      builder.addTransaction("abc123");
      expect(builder.size()).toBe(1);
    });
    it("should chain multiple addTransaction calls", () => {
      const builder = new soroban_1.SorobanBatchBuilder("testnet");
      builder
        .addTransaction("hash1")
        .addTransaction("hash2")
        .addTransaction("hash3");
      expect(builder.size()).toBe(3);
    });
    it("should throw on invalid transaction hash", () => {
      const builder = new soroban_1.SorobanBatchBuilder("testnet");
      expect(() => builder.addTransaction("")).toThrow(
        "Invalid transaction hash"
      );
      expect(() => builder.addTransaction(null)).toThrow(
        "Invalid transaction hash"
      );
    });
  });
  describe("addTransactions", () => {
    it("should add multiple transactions at once", () => {
      const builder = new soroban_1.SorobanBatchBuilder("testnet");
      const hashes = ["hash1", "hash2", "hash3", "hash4"];
      builder.addTransactions(hashes);
      expect(builder.size()).toBe(4);
    });
    it("should work with empty array", () => {
      const builder = new soroban_1.SorobanBatchBuilder("testnet");
      builder.addTransactions([]);
      expect(builder.size()).toBe(0);
    });
    it("should throw if any hash in array is invalid", () => {
      const builder = new soroban_1.SorobanBatchBuilder("testnet");
      expect(() => builder.addTransactions(["hash1", "", "hash3"])).toThrow();
    });
  });
  describe("size", () => {
    it("should return zero for empty batch", () => {
      const builder = new soroban_1.SorobanBatchBuilder("testnet");
      expect(builder.size()).toBe(0);
    });
    it("should return correct count", () => {
      const builder = new soroban_1.SorobanBatchBuilder("testnet");
      builder.addTransaction("hash1");
      expect(builder.size()).toBe(1);
      builder.addTransaction("hash2");
      expect(builder.size()).toBe(2);
    });
  });
  describe("clear", () => {
    it("should clear all transactions", () => {
      const builder = new soroban_1.SorobanBatchBuilder("testnet");
      builder.addTransactions(["hash1", "hash2", "hash3"]);
      expect(builder.size()).toBe(3);
      builder.clear();
      expect(builder.size()).toBe(0);
    });
  });
  describe("execute", () => {
    it("should return empty array for empty batch", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        const results = yield builder.execute(() =>
          __awaiter(void 0, void 0, void 0, function* () {
            throw new Error("Fetch should not be called");
          })
        );
        expect(results).toEqual([]);
      }));
    it("should execute batch request with single transaction", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        builder.addTransaction("tx123");
        const mockFetch = () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    {
                      id: 1,
                      result: {
                        status: "SUCCESS",
                        ledger: 12345,
                        createdAt: 1234567890,
                        returnValue: "success",
                        events: [],
                      },
                    },
                  ];
                }),
            };
          });
        const results = yield builder.execute(mockFetch);
        expect(results).toHaveLength(1);
        expect(results[0].txHash).toBe("tx123");
        expect(results[0].status).toBe("SUCCESS");
        expect(results[0].ledger).toBe(12345);
      }));
    it("should execute batch request with multiple transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        builder.addTransactions(["tx1", "tx2", "tx3"]);
        const mockFetch = () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    {
                      id: 1,
                      result: {
                        status: "SUCCESS",
                        ledger: 100,
                        createdAt: 1000,
                      },
                    },
                    {
                      id: 2,
                      result: {
                        status: "FAILED",
                        ledger: 101,
                        createdAt: 1001,
                      },
                    },
                    {
                      id: 3,
                      result: {
                        status: "NOT_FOUND",
                      },
                    },
                  ];
                }),
            };
          });
        const results = yield builder.execute(mockFetch);
        expect(results).toHaveLength(3);
        expect(results[0].status).toBe("SUCCESS");
        expect(results[1].status).toBe("FAILED");
        expect(results[2].status).toBe("NOT_FOUND");
      }));
    it("should handle RPC errors in batch response", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        builder.addTransactions(["tx1", "tx2"]);
        const mockFetch = () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    {
                      id: 1,
                      result: {
                        status: "SUCCESS",
                      },
                    },
                    {
                      id: 2,
                      error: {
                        code: -32600,
                        message: "Invalid request",
                      },
                    },
                  ];
                }),
            };
          });
        const results = yield builder.execute(mockFetch);
        expect(results).toHaveLength(2);
        expect(results[0].status).toBe("SUCCESS");
        expect(results[1].status).toBe("NOT_FOUND");
        expect(results[1].errorMessage).toContain("Invalid request");
      }));
    it("should handle HTTP errors gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        builder.addTransactions(["tx1", "tx2"]);
        const mockFetch = () =>
          __awaiter(void 0, void 0, void 0, function* () {
            throw new Error("Network error");
          });
        const results = yield builder.execute(mockFetch);
        expect(results).toHaveLength(2);
        results.forEach((result) => {
          expect(result.status).toBe("NOT_FOUND");
          expect(result.errorMessage).toContain("Batch request failed");
        });
      }));
    it("should maintain order of results", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        const hashes = ["hash_a", "hash_b", "hash_c"];
        builder.addTransactions(hashes);
        const mockFetch = () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    { id: 1, result: { status: "SUCCESS" } },
                    { id: 2, result: { status: "FAILED" } },
                    { id: 3, result: { status: "NOT_FOUND" } },
                  ];
                }),
            };
          });
        const results = yield builder.execute(mockFetch);
        expect(results.map((r) => r.txHash)).toEqual(hashes);
      }));
    it("should format events correctly from batch response", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        builder.addTransaction("tx_with_events");
        const mockFetch = () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    {
                      id: 1,
                      result: {
                        status: "SUCCESS",
                        events: [
                          {
                            type: "contract",
                            contractId:
                              "CCJZ4IQSV5KFXV7W2O7ZMVXJ65I2LTGV7MNXNVXJ65I2LTGV7MNVXJ",
                            topic: ["topic1", "topic2"],
                            value: "eventData",
                          },
                        ],
                      },
                    },
                  ];
                }),
            };
          });
        const results = yield builder.execute(mockFetch);
        expect(results[0].events).toHaveLength(1);
        expect(results[0].events[0].type).toBe("contract");
        expect(results[0].events[0].topics).toEqual(["topic1", "topic2"]);
        expect(results[0].events[0].data).toBe("eventData");
      }));
    it("should use custom RPC URL when provided", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        let capturedUrl = "";
        const mockFetch = (url) =>
          __awaiter(void 0, void 0, void 0, function* () {
            capturedUrl = url;
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    {
                      id: 1,
                      result: { status: "SUCCESS" },
                    },
                  ];
                }),
            };
          });
        const customUrl = "https://custom-soroban-rpc.example.com";
        const builder = new soroban_1.SorobanBatchBuilder("testnet", customUrl);
        builder.addTransaction("tx1");
        yield builder.execute(mockFetch);
        expect(capturedUrl).toBe(customUrl);
      }));
    it("should use default RPC URL for network when not specified", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        let capturedUrl = "";
        const mockFetch = (url) =>
          __awaiter(void 0, void 0, void 0, function* () {
            capturedUrl = url;
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    {
                      id: 1,
                      result: { status: "SUCCESS" },
                    },
                  ];
                }),
            };
          });
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        builder.addTransaction("tx1");
        yield builder.execute(mockFetch);
        expect(capturedUrl).toContain("soroban-testnet.stellar.org");
      }));
    it("should handle mainnet URL correctly", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        let capturedUrl = "";
        const mockFetch = (url) =>
          __awaiter(void 0, void 0, void 0, function* () {
            capturedUrl = url;
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    {
                      id: 1,
                      result: { status: "SUCCESS" },
                    },
                  ];
                }),
            };
          });
        const builder = new soroban_1.SorobanBatchBuilder("mainnet");
        builder.addTransaction("tx1");
        yield builder.execute(mockFetch);
        expect(capturedUrl).toContain("soroban-mainnet.stellar.org");
      }));
    it("should handle multiple transactions with mixed statuses", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        builder.addTransactions(["success_tx", "failed_tx", "notfound_tx"]);
        const mockFetch = () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    {
                      id: 1,
                      result: {
                        status: "SUCCESS",
                        ledger: 1000,
                        createdAt: 1000000,
                        returnValue: "0xabc123",
                      },
                    },
                    {
                      id: 2,
                      result: {
                        status: "FAILED",
                        ledger: 1001,
                        createdAt: 1000001,
                      },
                    },
                    {
                      id: 3,
                      result: {
                        status: "NOT_FOUND",
                      },
                    },
                  ];
                }),
            };
          });
        const results = yield builder.execute(mockFetch);
        expect(results).toHaveLength(3);
        expect(results[0].status).toBe("SUCCESS");
        expect(results[0].returnValue).toBe("0xabc123");
        expect(results[1].status).toBe("FAILED");
        expect(results[2].status).toBe("NOT_FOUND");
      }));
    it("should handle responses with out-of-order IDs", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        builder.addTransactions(["tx1", "tx2", "tx3"]);
        const mockFetch = () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    { id: 3, result: { status: "NOT_FOUND" } },
                    { id: 1, result: { status: "SUCCESS" } },
                    { id: 2, result: { status: "FAILED" } },
                  ];
                }),
            };
          });
        const results = yield builder.execute(mockFetch);
        // Results should be sorted by ID internally
        expect(results[0].txHash).toBe("tx1");
        expect(results[1].txHash).toBe("tx2");
        expect(results[2].txHash).toBe("tx3");
        expect(results[0].status).toBe("SUCCESS");
        expect(results[1].status).toBe("FAILED");
        expect(results[2].status).toBe("NOT_FOUND");
      }));
    it("should reuse builder after clear", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const builder = new soroban_1.SorobanBatchBuilder("testnet");
        builder.addTransactions(["tx1", "tx2"]);
        builder.clear();
        builder.addTransaction("tx3");
        const mockFetch = () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return {
              ok: true,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return [
                    {
                      id: 1,
                      result: { status: "SUCCESS" },
                    },
                  ];
                }),
            };
          });
        const results = yield builder.execute(mockFetch);
        expect(results).toHaveLength(1);
        expect(results[0].txHash).toBe("tx3");
      }));
  });
});
