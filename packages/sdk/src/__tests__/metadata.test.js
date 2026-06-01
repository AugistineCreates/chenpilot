"use strict";
/**
 * Unit tests for Stellar Metadata Manager
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
const metadata_1 = require("../metadata");
// Mock the stellar-sdk
jest.mock("stellar-sdk", () => ({
  Server: jest.fn(() => ({
    accounts: jest.fn(() => ({
      accountId: jest.fn(() => ({
        call: jest.fn(),
      })),
    })),
  })),
  Account: jest.fn((accountId, sequence) => ({
    accountId,
    sequence,
  })),
  TransactionBuilder: jest.fn(function (account, options) {
    this.account = account;
    this.options = options;
    this.operations = [];
    this.addOperation = jest.fn(function (op) {
      this.operations.push(op);
      return this;
    });
    this.setTimeout = jest.fn(function (timeout) {
      this.timeout = timeout;
      return this;
    });
    this.build = jest.fn(function () {
      return {
        toXDR: jest.fn(() => "mock-xdr-string"),
      };
    });
  }),
  Networks: {
    PUBLIC_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
  },
  Operation: {
    manageData: jest.fn((op) =>
      Object.assign(Object.assign({}, op), { type: "manageData" })
    ),
  },
  BASE_FEE: 100,
}));
describe("StellarMetadataManager", () => {
  let manager;
  let mockServer;
  beforeEach(() => {
    jest.clearAllMocks();
    manager = new metadata_1.StellarMetadataManager({
      horizonUrl: "https://horizon-testnet.stellar.org",
    });
    // Get the mocked server instance
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const StellarSDK = require("stellar-sdk");
    mockServer = StellarSDK.Server.mock.results[0].value;
  });
  // ─── Constructor tests ─────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should initialize with default config", () => {
      const mgr = new metadata_1.StellarMetadataManager();
      expect(mgr).toBeDefined();
    });
    it("should initialize with custom config", () => {
      const mgr = new metadata_1.StellarMetadataManager({
        horizonUrl: "https://custom.horizon.url",
        baseFee: 200,
      });
      expect(mgr).toBeDefined();
    });
    it("should create via factory function", () => {
      const mgr = (0, metadata_1.createMetadataManager)();
      expect(mgr).toBeInstanceOf(metadata_1.StellarMetadataManager);
    });
  });
  // ─── prepareSetMetadata tests ──────────────────────────────────────────────
  describe("prepareSetMetadata", () => {
    const accountId = "GAAA";
    const mockAccount = { sequence: "1000" };
    beforeEach(() => {
      mockServer.accounts.mockReturnValue({
        accountId: jest.fn(() => ({
          call: jest.fn().mockResolvedValue(mockAccount),
        })),
      });
    });
    it("should throw on missing accountId", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const params = { key: "test" };
        yield expect(manager.prepareSetMetadata(params)).rejects.toThrow(
          /accountId and key are required/
        );
      }));
    it("should throw on missing key", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const params = { accountId };
        yield expect(manager.prepareSetMetadata(params)).rejects.toThrow(
          /accountId and key are required/
        );
      }));
    it("should throw on invalid key format", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const params = {
          accountId,
          key: "invalid@key!",
          value: "test-value",
        };
        yield expect(manager.prepareSetMetadata(params)).rejects.toThrow(
          /Key must be alphanumeric/
        );
      }));
    it("should throw on value exceeding 4KB", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const params = {
          accountId,
          key: "test-key",
          value: "x".repeat(4097),
        };
        yield expect(manager.prepareSetMetadata(params)).rejects.toThrow(
          /exceeds 4KB limit/
        );
      }));
    it("should accept valid key formats", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const validKeys = ["key1", "key_123", "key-abc", "KEY_MIX-123"];
        for (const key of validKeys) {
          const params = {
            accountId,
            key,
            value: "test-value",
          };
          const xdr = yield manager.prepareSetMetadata(params);
          expect(xdr).toBe("mock-xdr-string");
        }
      }));
    it("should accept 4KB value exactly", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const params = {
          accountId,
          key: "test-key",
          value: "x".repeat(4096),
        };
        const xdr = yield manager.prepareSetMetadata(params);
        expect(xdr).toBe("mock-xdr-string");
      }));
    it("should prepare transaction for single ManageData operation", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const params = {
          accountId,
          key: "test-key",
          value: "short-value",
          type: "custom",
        };
        const xdr = yield manager.prepareSetMetadata(params);
        expect(xdr).toBe("mock-xdr-string");
      }));
    it("should set metadata type to generic if not provided", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const params = {
          accountId,
          key: "test-key",
          value: "test-value",
        };
        yield manager.prepareSetMetadata(params);
        expect(xdr).toBe("mock-xdr-string");
      }));
    it("should handle expiration timestamp", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const expiresAt = Math.floor(Date.now() / 1000) + 86400;
        const params = {
          accountId,
          key: "test-key",
          value: "test-value",
          expiresAt,
        };
        const xdr = yield manager.prepareSetMetadata(params);
        expect(xdr).toBe("mock-xdr-string");
      }));
    it("should chunk large data for storage", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const largeValue = "x".repeat(200); // Will be chunked
        const params = {
          accountId,
          key: "large-key",
          value: largeValue,
        };
        yield manager.prepareSetMetadata(params);
        // Verify operation was created
        expect(xdr).toBe("mock-xdr-string");
      }));
  });
  // ─── getMetadata tests ─────────────────────────────────────────────────────
  describe("getMetadata", () => {
    const accountId = "GAAA";
    const key = "test-key";
    it("should throw on missing accountId", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const params = { key };
        yield expect(manager.getMetadata(params)).rejects.toThrow(
          /accountId and key are required/
        );
      }));
    it("should throw on missing key", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const params = { accountId };
        yield expect(manager.getMetadata(params)).rejects.toThrow(
          /accountId and key are required/
        );
      }));
    it("should return null when metadata not found", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({ data_attr: {} }),
          })),
        });
        const result = yield manager.getMetadata({ accountId, key });
        expect(result).toBeNull();
      }));
    it("should retrieve metadata from account data", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const metadata = {
          key: "test-key",
          value: "test-value",
          type: "custom",
          timestamp: Math.floor(Date.now() / 1000),
        };
        const encoded = Buffer.from(JSON.stringify(metadata)).toString(
          "base64"
        );
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({
              data_attr: { "md:test-key": encoded },
            }),
          })),
        });
        const result = yield manager.getMetadata({ accountId, key });
        expect(result).toEqual({
          key: "test-key",
          value: "test-value",
          type: "custom",
          createdAt: metadata.timestamp,
          updatedAt: metadata.timestamp,
          expiresAt: undefined,
        });
      }));
    it("should cache retrieved metadata", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const metadata = {
          key: "test-key",
          value: "test-value",
          type: "custom",
          timestamp: Math.floor(Date.now() / 1000),
        };
        const encoded = Buffer.from(JSON.stringify(metadata)).toString(
          "base64"
        );
        const mockCall = jest.fn().mockResolvedValue({
          data_attr: { "md:test-key": encoded },
        });
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: mockCall,
          })),
        });
        // First call should hit Horizon
        yield manager.getMetadata({ accountId, key });
        expect(mockCall).toHaveBeenCalledTimes(1);
        // Second call should use cache
        yield manager.getMetadata({ accountId, key });
        expect(mockCall).toHaveBeenCalledTimes(1); // Not called again
      }));
    it("should return null for expired metadata", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const expiresAt = Math.floor(Date.now() / 1000) - 1000; // Expired
        const metadata = {
          key: "test-key",
          value: "test-value",
          timestamp: Math.floor(Date.now() / 1000),
          expiresAt,
        };
        const encoded = Buffer.from(JSON.stringify(metadata)).toString(
          "base64"
        );
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({
              data_attr: { "md:test-key": encoded },
            }),
          })),
        });
        const result = yield manager.getMetadata({ accountId, key });
        expect(result).toBeNull();
      }));
  });
  // ─── listMetadata tests ───────────────────────────────────────────────────
  describe("listMetadata", () => {
    const accountId = "GAAA";
    it("should throw on missing accountId", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield expect(manager.listMetadata("")).rejects.toThrow(
          /accountId is required/
        );
      }));
    it("should return empty list when no metadata exists", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({ data_attr: {} }),
          })),
        });
        const result = yield manager.listMetadata(accountId);
        expect(result).toEqual({
          accountId,
          metadata: [],
          total: 0,
          hasMore: false,
        });
      }));
    it("should list all metadata for an account", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const metadata1 = {
          key: "key1",
          value: "value1",
          type: "type1",
          timestamp: Math.floor(Date.now() / 1000),
        };
        const metadata2 = {
          key: "key2",
          value: "value2",
          type: "type2",
          timestamp: Math.floor(Date.now() / 1000),
        };
        const encoded1 = Buffer.from(JSON.stringify(metadata1)).toString(
          "base64"
        );
        const encoded2 = Buffer.from(JSON.stringify(metadata2)).toString(
          "base64"
        );
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({
              data_attr: {
                "md:key1": encoded1,
                "md:key2": encoded2,
              },
            }),
          })),
        });
        const result = yield manager.listMetadata(accountId);
        expect(result.metadata.length).toBe(2);
        expect(result.total).toBe(2);
        expect(result.hasMore).toBe(false);
      }));
    it("should skip expired metadata in list", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const unexpired = {
          key: "key1",
          value: "value1",
          timestamp: Math.floor(Date.now() / 1000),
        };
        const expired = {
          key: "key2",
          value: "value2",
          timestamp: Math.floor(Date.now() / 1000) - 10000,
          expiresAt: Math.floor(Date.now() / 1000) - 1000,
        };
        const encoded1 = Buffer.from(JSON.stringify(unexpired)).toString(
          "base64"
        );
        const encoded2 = Buffer.from(JSON.stringify(expired)).toString(
          "base64"
        );
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({
              data_attr: {
                "md:key1": encoded1,
                "md:key2": encoded2,
              },
            }),
          })),
        });
        const result = yield manager.listMetadata(accountId);
        expect(result.metadata.length).toBe(1);
        expect(result.metadata[0].key).toBe("key1");
      }));
  });
  // ─── prepareDeleteMetadata tests ───────────────────────────────────────────
  describe("prepareDeleteMetadata", () => {
    const accountId = "GAAA";
    const key = "test-key";
    const mockAccount = { sequence: "1000" };
    beforeEach(() => {
      mockServer.accounts.mockReturnValue({
        accountId: jest.fn(() => ({
          call: jest.fn().mockResolvedValue(mockAccount),
        })),
      });
    });
    it("should throw on missing accountId", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield expect(manager.prepareDeleteMetadata("", key)).rejects.toThrow(
          /accountId and key are required/
        );
      }));
    it("should throw on missing key", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield expect(
          manager.prepareDeleteMetadata(accountId, "")
        ).rejects.toThrow(/accountId and key are required/);
      }));
    it("should prepare delete transaction", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const xdr = yield manager.prepareDeleteMetadata(accountId, key);
        expect(xdr).toBe("mock-xdr-string");
      }));
    it("should clear cache on delete", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // First load some data into cache
        const metadata = {
          key: "test-key",
          value: "test-value",
          timestamp: Math.floor(Date.now() / 1000),
        };
        const encoded = Buffer.from(JSON.stringify(metadata)).toString(
          "base64"
        );
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({
              data_attr: { "md:test-key": encoded },
            }),
          })),
        });
        yield manager.getMetadata({ accountId, key });
        // Now delete
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({ sequence: "1001" }),
          })),
        });
        yield manager.prepareDeleteMetadata(accountId, key);
        // Cache should be cleared
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({ data_attr: {} }),
          })),
        });
        const result = yield manager.getMetadata({ accountId, key });
        expect(result).toBeNull();
      }));
  });
  // ─── getMetadataBatch tests ───────────────────────────────────────────────
  describe("getMetadataBatch", () => {
    const accountId = "GAAA";
    it("should retrieve multiple metadata entries", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const metadata1 = {
          key: "key1",
          value: "value1",
          timestamp: Math.floor(Date.now() / 1000),
        };
        const metadata2 = {
          key: "key2",
          value: "value2",
          timestamp: Math.floor(Date.now() / 1000),
        };
        const encoded1 = Buffer.from(JSON.stringify(metadata1)).toString(
          "base64"
        );
        const encoded2 = Buffer.from(JSON.stringify(metadata2)).toString(
          "base64"
        );
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest
              .fn()
              .mockResolvedValueOnce({
                data_attr: { "md:key1": encoded1 },
              })
              .mockResolvedValueOnce({
                data_attr: { "md:key2": encoded2 },
              }),
          })),
        });
        const results = yield manager.getMetadataBatch(accountId, [
          "key1",
          "key2",
        ]);
        expect(results.size).toBe(2);
        expect(results.get("key1")).toBeDefined();
        expect(results.get("key2")).toBeDefined();
      }));
    it("should return null for missing entries", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({ data_attr: {} }),
          })),
        });
        const results = yield manager.getMetadataBatch(accountId, [
          "missing-key",
        ]);
        expect(results.get("missing-key")).toBeNull();
      }));
  });
  // ─── clearCache tests ─────────────────────────────────────────────────────
  describe("clearCache", () => {
    it("should clear all cached metadata", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        manager.clearCache();
        // Should not throw
        expect(true).toBe(true);
      }));
  });
  // ─── Edge cases ────────────────────────────────────────────────────────────
  describe("edge cases", () => {
    const accountId = "GAAA";
    it("should handle special characters in values", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const params = {
          accountId,
          key: "special-key",
          value: JSON.stringify({ special: "value", emoji: "🚀" }),
        };
        const xdr = yield manager.prepareSetMetadata(params);
        expect(xdr).toBe("mock-xdr-string");
      }));
    it("should handle empty metadata type", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const metadata = {
          key: "test-key",
          value: "test-value",
          type: undefined,
          timestamp: Math.floor(Date.now() / 1000),
        };
        const encoded = Buffer.from(JSON.stringify(metadata)).toString(
          "base64"
        );
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({
              data_attr: { "md:test-key": encoded },
            }),
          })),
        });
        const result = yield manager.getMetadata({
          accountId,
          key: "test-key",
        });
        expect(result).toBeDefined();
      }));
    it("should handle network errors gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockRejectedValue(new Error("Network error")),
          })),
        });
        yield expect(
          manager.getMetadata({ accountId, key: "test-key" })
        ).rejects.toThrow(/Failed to retrieve metadata/);
      }));
    it("should handle malformed JSON in account data", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: jest.fn().mockResolvedValue({
              data_attr: {
                "md:test-key": Buffer.from("invalid-json").toString("base64"),
              },
            }),
          })),
        });
        yield expect(
          manager.getMetadata({ accountId, key: "test-key" })
        ).rejects.toThrow();
      }));
  });
  // ─── Performance tests ────────────────────────────────────────────────────
  describe("performance", () => {
    const accountId = "GAAA";
    it("should cache multiple requests efficiently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const metadata = {
          key: "test-key",
          value: "test-value",
          timestamp: Math.floor(Date.now() / 1000),
        };
        const encoded = Buffer.from(JSON.stringify(metadata)).toString(
          "base64"
        );
        const mockCall = jest.fn().mockResolvedValue({
          data_attr: { "md:test-key": encoded },
        });
        mockServer.accounts.mockReturnValue({
          accountId: jest.fn(() => ({
            call: mockCall,
          })),
        });
        // Multiple calls should only hit Horizon once
        for (let i = 0; i < 5; i++) {
          yield manager.getMetadata({ accountId, key: "test-key" });
        }
        expect(mockCall).toHaveBeenCalledTimes(1);
      }));
  });
});
