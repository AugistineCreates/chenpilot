"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
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
// Mock the TypeORM DataSource so the global setup.ts does not attempt a real DB connection.
jest.mock("../../src/config/Datasource", () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    initialize: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
  },
}));
const StellarSdk = __importStar(require("@stellar/stellar-sdk"));
const sorobanService_1 = require("../../src/services/sorobanService");
const mockGetTransaction = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  StellarSdk.SorobanRpc.Server.mockImplementation(() => ({
    getTransaction: mockGetTransaction,
  }));
});
describe("getContractLogs", () => {
  it("throws when txHash is missing", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield expect(
        (0, sorobanService_1.getContractLogs)({
          txHash: "",
          network: "testnet",
        })
      ).rejects.toThrow("Missing or invalid txHash");
    }));
  it("throws when transaction is NOT_FOUND", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockGetTransaction.mockResolvedValue({ status: "NOT_FOUND" });
      yield expect(
        (0, sorobanService_1.getContractLogs)({
          txHash: "abc123",
          network: "testnet",
        })
      ).rejects.toThrow("Transaction not found: abc123");
    }));
  it("throws when transaction FAILED", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockGetTransaction.mockResolvedValue({ status: "FAILED" });
      yield expect(
        (0, sorobanService_1.getContractLogs)({
          txHash: "abc123",
          network: "testnet",
        })
      ).rejects.toThrow("Transaction failed: abc123");
    }));
  it("returns empty array when no events present", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockGetTransaction.mockResolvedValue({ status: "SUCCESS" });
      const logs = yield (0, sorobanService_1.getContractLogs)({
        txHash: "abc123",
        network: "testnet",
      });
      expect(logs).toEqual([]);
    }));
  it("returns formatted log entries for each event", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockGetTransaction.mockResolvedValue({
        status: "SUCCESS",
        events: [
          {
            type: "contract",
            contractId: "CABC1234567890",
            topic: ["topic_val"],
            value: "data_val",
          },
        ],
      });
      const logs = yield (0, sorobanService_1.getContractLogs)({
        txHash: "abc123",
        network: "testnet",
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        index: 0,
        contractId: "CABC1234567890",
        type: "contract",
        topics: ["topic_val"],
        data: "data_val",
      });
    }));
  it("defaults type to 'contract' when event type is missing", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockGetTransaction.mockResolvedValue({
        status: "SUCCESS",
        events: [{ contractId: "CABC1234567890" }],
      });
      const logs = yield (0, sorobanService_1.getContractLogs)({
        txHash: "abc123",
        network: "testnet",
      });
      expect(logs[0].type).toBe("contract");
      expect(logs[0].contractId).toBe("CABC1234567890");
      expect(logs[0].topics).toEqual([]);
      expect(logs[0].data).toBeNull();
    }));
  it("uses provided rpcUrl over default", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockGetTransaction.mockResolvedValue({ status: "SUCCESS" });
      yield (0, sorobanService_1.getContractLogs)({
        txHash: "abc123",
        network: "testnet",
        rpcUrl: "https://custom-rpc.example",
      });
      expect(StellarSdk.SorobanRpc.Server).toHaveBeenCalledWith(
        "https://custom-rpc.example",
        expect.any(Object)
      );
    }));
});
