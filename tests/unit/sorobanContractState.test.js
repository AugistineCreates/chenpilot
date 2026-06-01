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
const sorobanContractState_1 = require("../../src/Agents/tools/sorobanContractState");
const sorobanService = __importStar(
  require("../../src/services/sorobanService")
);
jest.mock("../../src/services/sorobanService");
jest.mock("../../src/config/logger");
describe("SorobanContractStateTool", () => {
  let tool;
  const mockInvokeContract = sorobanService.invokeContract;
  beforeEach(() => {
    tool = new sorobanContractState_1.SorobanContractStateTool();
    jest.clearAllMocks();
  });
  describe("Metadata", () => {
    it("should have correct tool metadata", () => {
      expect(tool.metadata.name).toBe("soroban_contract_state");
      expect(tool.metadata.category).toBe("soroban");
      expect(tool.metadata.description).toContain("DeFi decision making");
      expect(tool.metadata.parameters.contractId.required).toBe(true);
    });
    it("should have DeFi-focused examples", () => {
      expect(tool.metadata.examples.length).toBeGreaterThan(0);
      expect(tool.metadata.examples.some((ex) => ex.includes("reserves"))).toBe(
        true
      );
    });
  });
  describe("Query Specific Methods", () => {
    it("should query specified contract methods", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        mockInvokeContract
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTEST123",
            method: "get_reserves",
            result: { token0: "1000000", token1: "2000000" },
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTEST123",
            method: "get_fee",
            result: 30,
          });
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
            network: "testnet",
            methods: ["get_reserves", "get_fee"],
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.state
        ).toHaveProperty("get_reserves");
        expect(
          (_b = result.data) === null || _b === void 0 ? void 0 : _b.state
        ).toHaveProperty("get_fee");
        expect(mockInvokeContract).toHaveBeenCalledTimes(2);
      }));
    it("should handle method query failures gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        mockInvokeContract
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTEST123",
            method: "total_supply",
            result: "1000000000",
          })
          .mockRejectedValueOnce(new Error("Method not found"));
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
            methods: ["total_supply", "invalid_method"],
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.state
        ).toHaveProperty("total_supply");
        expect(
          (_c =
            (_b = result.data) === null || _b === void 0
              ? void 0
              : _b.methods) === null || _c === void 0
            ? void 0
            : _c.invalid_method
        ).toHaveProperty("error");
      }));
  });
  describe("Query State Keys", () => {
    it("should map state keys to contract methods", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        mockInvokeContract.mockResolvedValue({
          network: "testnet",
          contractId: "CTEST123",
          method: "get_reserves",
          result: { token0: "1000000", token1: "2000000" },
        });
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
            stateKeys: ["reserves"],
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.state
        ).toHaveProperty("reserves");
        expect(mockInvokeContract).toHaveBeenCalledWith(
          expect.objectContaining({
            method: "get_reserves",
          })
        );
      }));
    it("should query multiple state keys", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        mockInvokeContract
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTEST123",
            method: "total_supply",
            result: "1000000000",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTEST123",
            method: "decimals",
            result: 7,
          });
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
            stateKeys: ["totalSupply", "decimals"],
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.state
        ).toHaveProperty("totalSupply");
        expect(
          (_b = result.data) === null || _b === void 0 ? void 0 : _b.state
        ).toHaveProperty("decimals");
      }));
  });
  describe("Common DeFi State Queries", () => {
    it("should query common DeFi methods when no specific queries provided", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        mockInvokeContract.mockImplementation((params) =>
          __awaiter(void 0, void 0, void 0, function* () {
            return {
              network: params.network,
              contractId: params.contractId,
              method: params.method,
              result: params.method === "total_supply" ? "1000000000" : null,
            };
          })
        );
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(mockInvokeContract).toHaveBeenCalled();
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.state
        ).toBeDefined();
      }));
    it("should handle partial success in common queries", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        let callCount = 0;
        mockInvokeContract.mockImplementation((params) =>
          __awaiter(void 0, void 0, void 0, function* () {
            callCount++;
            if (callCount === 1) {
              return {
                network: params.network,
                contractId: params.contractId,
                method: params.method,
                result: "1000000000",
              };
            }
            throw new Error("Method not available");
          })
        );
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(
          Object.keys(
            ((_a = result.data) === null || _a === void 0
              ? void 0
              : _a.state) || {}
          ).length
        ).toBeGreaterThan(0);
      }));
  });
  describe("Contract Metadata", () => {
    it("should query contract metadata when requested", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        mockInvokeContract
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTEST123",
            method: "admin",
            result: "GADMIN123",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTEST123",
            method: "version",
            result: "1.0.0",
          });
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
            methods: [],
            includeMetadata: true,
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.metadata
        ).toBeDefined();
        expect(
          (_c =
            (_b = result.data) === null || _b === void 0
              ? void 0
              : _b.metadata) === null || _c === void 0
            ? void 0
            : _c.admin
        ).toBe("GADMIN123");
        expect(
          (_e =
            (_d = result.data) === null || _d === void 0
              ? void 0
              : _d.metadata) === null || _e === void 0
            ? void 0
            : _e.version
        ).toBe("1.0.0");
      }));
    it("should handle missing metadata gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        mockInvokeContract.mockRejectedValue(new Error("Method not found"));
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
            methods: [],
            includeMetadata: true,
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.metadata
        ).toBeDefined();
      }));
  });
  describe("Network Configuration", () => {
    it("should use testnet by default", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockInvokeContract.mockResolvedValue({
          network: "testnet",
          contractId: "CTEST123",
          method: "total_supply",
          result: "1000000000",
        });
        yield tool.execute(
          {
            contractId: "CTEST123",
            methods: ["total_supply"],
          },
          "user-123"
        );
        expect(mockInvokeContract).toHaveBeenCalledWith(
          expect.objectContaining({
            network: "testnet",
          })
        );
      }));
    it("should use specified network", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockInvokeContract.mockResolvedValue({
          network: "mainnet",
          contractId: "CTEST123",
          method: "total_supply",
          result: "1000000000",
        });
        yield tool.execute(
          {
            contractId: "CTEST123",
            network: "mainnet",
            methods: ["total_supply"],
          },
          "user-123"
        );
        expect(mockInvokeContract).toHaveBeenCalledWith(
          expect.objectContaining({
            network: "mainnet",
          })
        );
      }));
    it("should pass custom RPC URL", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockInvokeContract.mockResolvedValue({
          network: "testnet",
          contractId: "CTEST123",
          method: "total_supply",
          result: "1000000000",
        });
        yield tool.execute(
          {
            contractId: "CTEST123",
            rpcUrl: "https://custom-rpc.example.com",
            methods: ["total_supply"],
          },
          "user-123"
        );
        expect(mockInvokeContract).toHaveBeenCalledWith(
          expect.objectContaining({
            rpcUrl: "https://custom-rpc.example.com",
          })
        );
      }));
  });
  describe("DeFi Protocol Specific Queries", () => {
    it("should query liquidity pool state", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockInvokeContract
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CPOOL123",
            method: "get_reserves",
            result: { reserve0: "1000000", reserve1: "2000000" },
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CPOOL123",
            method: "total_supply",
            result: "500000",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CPOOL123",
            method: "get_price",
            result: "2.0",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CPOOL123",
            method: "get_fee",
            result: 30,
          });
        const state = yield tool.queryDeFiProtocol("CPOOL123", "pool");
        expect(state).toHaveProperty("reserves");
        expect(state).toHaveProperty("totalSupply");
        expect(state).toHaveProperty("price");
        expect(state).toHaveProperty("fee");
      }));
    it("should query lending protocol state", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockInvokeContract
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CLEND123",
            method: "total_supply",
            result: "10000000",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CLEND123",
            method: "total_borrow",
            result: "5000000",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CLEND123",
            method: "utilization_rate",
            result: "0.5",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CLEND123",
            method: "interest_rate",
            result: "0.05",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CLEND123",
            method: "collateral_factor",
            result: "0.75",
          });
        const state = yield tool.queryDeFiProtocol("CLEND123", "lending");
        expect(state).toHaveProperty("totalSupply");
        expect(state).toHaveProperty("totalBorrow");
        expect(state).toHaveProperty("utilizationRate");
        expect(state).toHaveProperty("interestRate");
        expect(state).toHaveProperty("collateralFactor");
      }));
    it("should query token state", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockInvokeContract
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTOKEN123",
            method: "total_supply",
            result: "1000000000",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTOKEN123",
            method: "balance",
            result: "100000",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTOKEN123",
            method: "allowance",
            result: "50000",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTOKEN123",
            method: "decimals",
            result: 7,
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTOKEN123",
            method: "name",
            result: "Test Token",
          })
          .mockResolvedValueOnce({
            network: "testnet",
            contractId: "CTOKEN123",
            method: "symbol",
            result: "TEST",
          });
        const state = yield tool.queryDeFiProtocol("CTOKEN123", "token");
        expect(state).toHaveProperty("totalSupply");
        expect(state).toHaveProperty("decimals");
        expect(state).toHaveProperty("name");
        expect(state).toHaveProperty("symbol");
      }));
  });
  describe("Error Handling", () => {
    it("should return error result when contract query fails completely", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockInvokeContract.mockRejectedValue(new Error("Contract not found"));
        const result = yield tool.execute(
          {
            contractId: "CINVALID",
            methods: ["total_supply"],
          },
          "user-123"
        );
        expect(result.status).toBe("error");
        expect(result.error).toContain("Failed to query contract state");
      }));
    it("should include contract ID in error result", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        mockInvokeContract.mockRejectedValue(new Error("Network error"));
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
            methods: ["total_supply"],
          },
          "user-123"
        );
        expect(result.status).toBe("error");
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.contractId
        ).toBe("CTEST123");
      }));
  });
  describe("Result Format", () => {
    it("should include timestamp in result", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        mockInvokeContract.mockResolvedValue({
          network: "testnet",
          contractId: "CTEST123",
          method: "total_supply",
          result: "1000000000",
        });
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
            methods: ["total_supply"],
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.timestamp
        ).toBeDefined();
        expect(
          new Date(
            (_b = result.data) === null || _b === void 0 ? void 0 : _b.timestamp
          ).getTime()
        ).toBeGreaterThan(0);
      }));
    it("should include network in result", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        mockInvokeContract.mockResolvedValue({
          network: "mainnet",
          contractId: "CTEST123",
          method: "total_supply",
          result: "1000000000",
        });
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
            network: "mainnet",
            methods: ["total_supply"],
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.network
        ).toBe("mainnet");
      }));
    it("should include contract ID in result", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        mockInvokeContract.mockResolvedValue({
          network: "testnet",
          contractId: "CTEST123",
          method: "total_supply",
          result: "1000000000",
        });
        const result = yield tool.execute(
          {
            contractId: "CTEST123",
            methods: ["total_supply"],
          },
          "user-123"
        );
        expect(result.status).toBe("success");
        expect(
          (_a = result.data) === null || _a === void 0 ? void 0 : _a.contractId
        ).toBe("CTEST123");
      }));
  });
});
