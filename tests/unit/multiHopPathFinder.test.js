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
const globals_1 = require("@jest/globals");
const multiHopPathFinder_1 = require("../../src/services/multiHopPathFinder");
const StellarSdk = __importStar(require("@stellar/stellar-sdk"));
globals_1.jest.mock("@stellar/stellar-sdk");
(0, globals_1.describe)("MultiHopPathFinder", () => {
  let pathFinder;
  let mockServer;
  (0, globals_1.beforeEach)(() => {
    mockServer = {
      strictSendPaths: globals_1.jest.fn().mockReturnThis(),
      strictReceivePaths: globals_1.jest.fn().mockReturnThis(),
      limit: globals_1.jest.fn().mockReturnThis(),
      call: globals_1.jest.fn(),
    };
    StellarSdk.Horizon.Server = globals_1.jest.fn(() => mockServer);
    pathFinder = new multiHopPathFinder_1.MultiHopPathFinder();
  });
  (0, globals_1.describe)("findOptimalPath", () => {
    (0, globals_1.it)("should find and evaluate multiple trading paths", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockPaths = {
          records: [
            {
              source_amount: "100.0000000",
              destination_amount: "12.5000000",
              path: [
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "USDC",
                  asset_issuer:
                    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
                },
              ],
            },
            {
              source_amount: "100.0000000",
              destination_amount: "12.3000000",
              path: [
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "USDT",
                  asset_issuer:
                    "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V",
                },
              ],
            },
          ],
        };
        mockServer.call.mockResolvedValue(mockPaths);
        const sourceAsset = StellarSdk.Asset.native();
        const destAsset = new StellarSdk.Asset(
          "USDC",
          "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        );
        const result = yield pathFinder.findOptimalPath(
          sourceAsset,
          destAsset,
          "100",
          { maxHops: 3 }
        );
        (0, globals_1.expect)(result.bestPath).toBeDefined();
        (0, globals_1.expect)(result.allPaths.length).toBeGreaterThan(0);
        (0, globals_1.expect)(result.bestPath.efficiency).toBeGreaterThan(0);
        (0, globals_1.expect)(result.evaluationTime).toBeGreaterThan(0);
      })
    );
    (0, globals_1.it)("should select path with highest efficiency", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const mockPaths = {
          records: [
            {
              source_amount: "100.0000000",
              destination_amount: "15.0000000",
              path: [],
            },
            {
              source_amount: "100.0000000",
              destination_amount: "14.5000000",
              path: [
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "USDC",
                  asset_issuer:
                    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
                },
              ],
            },
          ],
        };
        mockServer.call.mockResolvedValue(mockPaths);
        const sourceAsset = StellarSdk.Asset.native();
        const destAsset = new StellarSdk.Asset(
          "USDT",
          "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V"
        );
        const result = yield pathFinder.findOptimalPath(
          sourceAsset,
          destAsset,
          "100"
        );
        (0, globals_1.expect)(
          parseFloat(result.bestPath.destinationAmount)
        ).toBeGreaterThanOrEqual(
          parseFloat(
            ((_a = result.allPaths[1]) === null || _a === void 0
              ? void 0
              : _a.destinationAmount) || "0"
          )
        );
      })
    );
    (0, globals_1.it)("should filter paths by max hops", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockPaths = {
          records: [
            {
              source_amount: "100.0000000",
              destination_amount: "12.0000000",
              path: [],
            },
            {
              source_amount: "100.0000000",
              destination_amount: "12.5000000",
              path: [
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "USDC",
                  asset_issuer: "ISSUER1",
                },
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "USDT",
                  asset_issuer: "ISSUER2",
                },
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "BTC",
                  asset_issuer: "ISSUER3",
                },
              ],
            },
          ],
        };
        mockServer.call.mockResolvedValue(mockPaths);
        const sourceAsset = StellarSdk.Asset.native();
        const destAsset = new StellarSdk.Asset("USDC", "ISSUER");
        const result = yield pathFinder.findOptimalPath(
          sourceAsset,
          destAsset,
          "100",
          { maxHops: 2 }
        );
        result.allPaths.forEach((path) => {
          (0, globals_1.expect)(path.hops).toBeLessThanOrEqual(2);
        });
      })
    );
    (0, globals_1.it)("should throw error when no paths found", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockServer.call.mockResolvedValue({ records: [] });
        const sourceAsset = StellarSdk.Asset.native();
        const destAsset = new StellarSdk.Asset("UNKNOWN", "ISSUER");
        yield (0, globals_1.expect)(
          pathFinder.findOptimalPath(sourceAsset, destAsset, "100")
        ).rejects.toThrow("No valid trading paths found");
      })
    );
  });
  (0, globals_1.describe)("comparePaths", () => {
    (0, globals_1.it)("should prefer path with higher efficiency", () => {
      const path1 = {
        path: [],
        sourceAmount: "100",
        destinationAmount: "12",
        priceImpact: 1,
        estimatedSlippage: 0.001,
        hops: 2,
        route: ["XLM", "USDC"],
        efficiency: 11.5,
      };
      const path2 = {
        path: [],
        sourceAmount: "100",
        destinationAmount: "11",
        priceImpact: 1.5,
        estimatedSlippage: 0.002,
        hops: 3,
        route: ["XLM", "USDT", "USDC"],
        efficiency: 10.2,
      };
      const better = pathFinder.comparePaths(path1, path2);
      (0, globals_1.expect)(better.efficiency).toBe(11.5);
    });
    (0, globals_1.it)(
      "should prefer fewer hops when efficiency is equal",
      () => {
        const path1 = {
          path: [],
          sourceAmount: "100",
          destinationAmount: "12",
          priceImpact: 1,
          estimatedSlippage: 0.001,
          hops: 2,
          route: ["XLM", "USDC"],
          efficiency: 11.0,
        };
        const path2 = {
          path: [],
          sourceAmount: "100",
          destinationAmount: "12",
          priceImpact: 1,
          estimatedSlippage: 0.001,
          hops: 3,
          route: ["XLM", "USDT", "USDC"],
          efficiency: 11.0,
        };
        const better = pathFinder.comparePaths(path1, path2);
        (0, globals_1.expect)(better.hops).toBe(2);
      }
    );
  });
});
