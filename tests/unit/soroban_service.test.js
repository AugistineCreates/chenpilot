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
const StellarSdk = __importStar(require("@stellar/stellar-sdk"));
const TEST_CONTRACT_ID = "CABC1234567890";
describe("Soroban Service invokeContract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SOROBAN_RPC_URL_TESTNET;
    delete process.env.SOROBAN_RPC_URL_MAINNET;
  });
  it("uses default testnet RPC URL and passphrase", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      process.env.SOROBAN_RPC_URL_TESTNET = "https://rpc-testnet.example";
      const { invokeContract } = yield Promise.resolve().then(() =>
        __importStar(require("../../src/services/sorobanService"))
      );
      yield invokeContract({
        network: "testnet",
        contractId: TEST_CONTRACT_ID,
        method: "ping",
        args: [],
      });
      expect(StellarSdk.SorobanRpc.Server).toHaveBeenCalledWith(
        "https://rpc-testnet.example",
        expect.any(Object)
      );
      const builderArgs = StellarSdk.TransactionBuilder.mock.calls[0][1];
      expect(builderArgs.networkPassphrase).toBe(StellarSdk.Networks.TESTNET);
    }));
  it("uses default mainnet RPC URL and passphrase", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      process.env.SOROBAN_RPC_URL_MAINNET = "https://rpc-mainnet.example";
      const { invokeContract } = yield Promise.resolve().then(() =>
        __importStar(require("../../src/services/sorobanService"))
      );
      yield invokeContract({
        network: "mainnet",
        contractId: TEST_CONTRACT_ID,
        method: "ping",
        args: [],
      });
      expect(StellarSdk.SorobanRpc.Server).toHaveBeenCalledWith(
        "https://rpc-mainnet.example",
        expect.any(Object)
      );
      const builderArgs = StellarSdk.TransactionBuilder.mock.calls[0][1];
      expect(builderArgs.networkPassphrase).toBe(StellarSdk.Networks.PUBLIC);
    }));
  it("rejects missing contractId", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const { invokeContract } = yield Promise.resolve().then(() =>
        __importStar(require("../../src/services/sorobanService"))
      );
      yield expect(
        invokeContract({
          network: "testnet",
          contractId: "",
          method: "ping",
        })
      ).rejects.toThrow("contractId");
    }));
  it("rejects missing method", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const { invokeContract } = yield Promise.resolve().then(() =>
        __importStar(require("../../src/services/sorobanService"))
      );
      yield expect(
        invokeContract({
          network: "testnet",
          contractId: TEST_CONTRACT_ID,
          method: "",
        })
      ).rejects.toThrow("method");
    }));
  it("returns expected result shape", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const { invokeContract } = yield Promise.resolve().then(() =>
        __importStar(require("../../src/services/sorobanService"))
      );
      const result = yield invokeContract({
        network: "testnet",
        contractId: TEST_CONTRACT_ID,
        method: "ping",
        args: [1, "two"],
      });
      expect(result).toEqual(
        expect.objectContaining({
          network: "testnet",
          contractId: TEST_CONTRACT_ID,
          method: "ping",
          result: "mock_scval",
        })
      );
      expect(result.raw).toBeDefined();
    }));
});
