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
const networkStatus_1 = require("../networkStatus");
// Mock fetch globally
global.fetch = jest.fn();
describe("Network Status API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  describe("checkNetworkHealth", () => {
    it("should return healthy status when RPC responds successfully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                jsonrpc: "2.0",
                id: 1,
                result: {
                  sequence: 12345,
                  hash: "abc123",
                },
              };
            }),
        });
        const health = yield (0, networkStatus_1.checkNetworkHealth)({
          network: "testnet",
        });
        expect(health.isHealthy).toBe(true);
        expect(health.latestLedger).toBe(12345);
        expect(health.responseTimeMs).toBeGreaterThanOrEqual(0);
        expect(health.error).toBeUndefined();
      }));
    it("should return unhealthy status on HTTP error", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        global.fetch.mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        });
        const health = yield (0, networkStatus_1.checkNetworkHealth)({
          network: "testnet",
        });
        expect(health.isHealthy).toBe(false);
        expect(health.latestLedger).toBe(0);
        expect(health.error).toContain("503");
      }));
    it("should return unhealthy status on RPC error", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                jsonrpc: "2.0",
                id: 1,
                error: {
                  code: -32600,
                  message: "Invalid request",
                },
              };
            }),
        });
        const health = yield (0, networkStatus_1.checkNetworkHealth)({
          network: "testnet",
        });
        expect(health.isHealthy).toBe(false);
        expect(health.error).toBe("Invalid request");
      }));
    it("should handle network errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        global.fetch.mockRejectedValueOnce(new Error("Network timeout"));
        const health = yield (0, networkStatus_1.checkNetworkHealth)({
          network: "testnet",
        });
        expect(health.isHealthy).toBe(false);
        expect(health.error).toBe("Network timeout");
      }));
    it("should use custom RPC URL when provided", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const customUrl = "https://custom-rpc.example.com";
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                jsonrpc: "2.0",
                id: 1,
                result: { sequence: 999 },
              };
            }),
        });
        yield (0, networkStatus_1.checkNetworkHealth)({
          network: "testnet",
          rpcUrl: customUrl,
        });
        expect(global.fetch).toHaveBeenCalledWith(
          customUrl,
          expect.objectContaining({
            method: "POST",
          })
        );
      }));
    it("should work with mainnet", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                jsonrpc: "2.0",
                id: 1,
                result: { sequence: 54321 },
              };
            }),
        });
        const health = yield (0, networkStatus_1.checkNetworkHealth)({
          network: "mainnet",
        });
        expect(health.isHealthy).toBe(true);
        expect(health.latestLedger).toBe(54321);
        expect(global.fetch).toHaveBeenCalledWith(
          "https://soroban-mainnet.stellar.org",
          expect.any(Object)
        );
      }));
  });
  describe("checkLedgerLatency", () => {
    it("should return normal latency when ledger is recent", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const currentTime = Math.floor(Date.now() / 1000);
        const recentCloseTime = currentTime - 3; // 3 seconds ago
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                jsonrpc: "2.0",
                id: 1,
                result: {
                  sequence: 12345,
                  protocolVersion: 20,
                  closeTime: recentCloseTime,
                },
              };
            }),
        });
        const latency = yield (0, networkStatus_1.checkLedgerLatency)({
          network: "testnet",
        });
        expect(latency.currentLedger).toBe(12345);
        expect(latency.timeSinceLastLedgerSec).toBeGreaterThanOrEqual(3);
        expect(latency.timeSinceLastLedgerSec).toBeLessThan(5);
        expect(latency.averageLedgerTimeSec).toBe(5);
        expect(latency.isNormal).toBe(true);
      }));
    it("should return abnormal latency when ledger is old", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const currentTime = Math.floor(Date.now() / 1000);
        const oldCloseTime = currentTime - 30; // 30 seconds ago
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                jsonrpc: "2.0",
                id: 1,
                result: {
                  sequence: 12345,
                  protocolVersion: 20,
                  closeTime: oldCloseTime,
                },
              };
            }),
        });
        const latency = yield (0, networkStatus_1.checkLedgerLatency)({
          network: "testnet",
        });
        expect(latency.isNormal).toBe(false);
        expect(latency.timeSinceLastLedgerSec).toBeGreaterThan(15);
      }));
    it("should throw on HTTP error", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        global.fetch.mockResolvedValueOnce({
          ok: false,
          statusText: "Bad Gateway",
        });
        yield expect(
          (0, networkStatus_1.checkLedgerLatency)({ network: "testnet" })
        ).rejects.toThrow("Failed to fetch ledger");
      }));
    it("should throw on RPC error", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                jsonrpc: "2.0",
                id: 1,
                error: {
                  message: "Method not found",
                },
              };
            }),
        });
        yield expect(
          (0, networkStatus_1.checkLedgerLatency)({ network: "testnet" })
        ).rejects.toThrow("Method not found");
      }));
  });
  describe("getProtocolVersion", () => {
    it("should return protocol version from Horizon", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                current_protocol_version: 20,
                core_version: "stellar-core 20.0.0",
                network_passphrase: "Test SDF Network ; September 2015",
              };
            }),
        });
        const protocol = yield (0, networkStatus_1.getProtocolVersion)({
          network: "testnet",
        });
        expect(protocol.version).toBe(20);
        expect(protocol.coreVersion).toBe("stellar-core 20.0.0");
        expect(protocol.networkPassphrase).toBe(
          "Test SDF Network ; September 2015"
        );
      }));
    it("should use custom Horizon URL when provided", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const customUrl = "https://custom-horizon.example.com";
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                current_protocol_version: 21,
                core_version: "stellar-core 21.0.0",
                network_passphrase:
                  "Public Global Stellar Network ; September 2015",
              };
            }),
        });
        yield (0, networkStatus_1.getProtocolVersion)({
          network: "mainnet",
          horizonUrl: customUrl,
        });
        expect(global.fetch).toHaveBeenCalledWith(`${customUrl}/`);
      }));
    it("should throw on HTTP error", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        global.fetch.mockResolvedValueOnce({
          ok: false,
          statusText: "Not Found",
        });
        yield expect(
          (0, networkStatus_1.getProtocolVersion)({ network: "testnet" })
        ).rejects.toThrow("Failed to fetch protocol version");
      }));
    it("should handle missing fields gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {};
            }),
        });
        const protocol = yield (0, networkStatus_1.getProtocolVersion)({
          network: "testnet",
        });
        expect(protocol.version).toBe(0);
        expect(protocol.coreVersion).toBe("unknown");
        expect(protocol.networkPassphrase).toBe("unknown");
      }));
  });
  describe("getNetworkStatus", () => {
    it("should return complete network status", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const currentTime = Math.floor(Date.now() / 1000);
        // Mock for checkNetworkHealth
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                jsonrpc: "2.0",
                id: 1,
                result: { sequence: 12345 },
              };
            }),
        });
        // Mock for checkLedgerLatency
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                jsonrpc: "2.0",
                id: 1,
                result: {
                  sequence: 12345,
                  protocolVersion: 20,
                  closeTime: currentTime - 4,
                },
              };
            }),
        });
        // Mock for getProtocolVersion
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                current_protocol_version: 20,
                core_version: "stellar-core 20.0.0",
                network_passphrase: "Test SDF Network ; September 2015",
              };
            }),
        });
        const status = yield (0, networkStatus_1.getNetworkStatus)({
          network: "testnet",
        });
        expect(status.health.isHealthy).toBe(true);
        expect(status.health.latestLedger).toBe(12345);
        expect(status.latency.currentLedger).toBe(12345);
        expect(status.latency.isNormal).toBe(true);
        expect(status.protocol.version).toBe(20);
        expect(status.checkedAt).toBeGreaterThan(0);
      }));
    it("should handle partial failures gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const currentTime = Math.floor(Date.now() / 1000);
        // Mock for checkNetworkHealth - fails
        global.fetch.mockRejectedValueOnce(new Error("Connection refused"));
        // Mock for checkLedgerLatency - succeeds
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                jsonrpc: "2.0",
                id: 1,
                result: {
                  sequence: 12345,
                  protocolVersion: 20,
                  closeTime: currentTime - 4,
                },
              };
            }),
        });
        // Mock for getProtocolVersion - succeeds
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                current_protocol_version: 20,
                core_version: "stellar-core 20.0.0",
                network_passphrase: "Test SDF Network ; September 2015",
              };
            }),
        });
        const status = yield (0, networkStatus_1.getNetworkStatus)({
          network: "testnet",
        });
        expect(status.health.isHealthy).toBe(false);
        expect(status.health.error).toBe("Connection refused");
        expect(status.latency.isNormal).toBe(true);
        expect(status.protocol.version).toBe(20);
      }));
    it("should work with mainnet configuration", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const currentTime = Math.floor(Date.now() / 1000);
        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            json: () =>
              __awaiter(void 0, void 0, void 0, function* () {
                return {
                  jsonrpc: "2.0",
                  id: 1,
                  result: { sequence: 99999 },
                };
              }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () =>
              __awaiter(void 0, void 0, void 0, function* () {
                return {
                  jsonrpc: "2.0",
                  id: 1,
                  result: {
                    sequence: 99999,
                    protocolVersion: 21,
                    closeTime: currentTime - 5,
                  },
                };
              }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () =>
              __awaiter(void 0, void 0, void 0, function* () {
                return {
                  current_protocol_version: 21,
                  core_version: "stellar-core 21.0.0",
                  network_passphrase:
                    "Public Global Stellar Network ; September 2015",
                };
              }),
          });
        const status = yield (0, networkStatus_1.getNetworkStatus)({
          network: "mainnet",
        });
        expect(status.health.isHealthy).toBe(true);
        expect(status.protocol.networkPassphrase).toContain("Public Global");
      }));
  });
});
