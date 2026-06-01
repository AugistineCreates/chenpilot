"use strict";
/**
 * Multi-Hop Trade Path Evaluation Examples
 *
 * This file demonstrates various ways to use the multi-hop trade path
 * evaluation feature in the Stellar DEX SDK.
 */
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
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.basicPathFinding = basicPathFinding;
exports.compareMultiplePaths = compareMultiplePaths;
exports.priceServiceIntegration = priceServiceIntegration;
exports.agentToolUsage = agentToolUsage;
exports.pathComparison = pathComparison;
exports.errorHandling = errorHandling;
const multiHopPathFinder_1 = require("../src/services/multiHopPathFinder");
const stellarPrice_service_1 = __importDefault(
  require("../src/services/stellarPrice.service")
);
const ToolRegistry_1 = require("../src/Agents/registry/ToolRegistry");
const StellarSdk = __importStar(require("@stellar/stellar-sdk"));
// ============================================
// Example 1: Basic Path Finding
// ============================================
function basicPathFinding() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Example 1: Basic Path Finding ===\n");
    const sourceAsset = StellarSdk.Asset.native(); // XLM
    const destAsset = new StellarSdk.Asset(
      "USDC",
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    );
    try {
      const result =
        yield multiHopPathFinder_1.multiHopPathFinder.findOptimalPath(
          sourceAsset,
          destAsset,
          "100.0000000"
        );
      console.log("Best Path Found:");
      console.log("  Route:", result.bestPath.route.join(" → "));
      console.log("  Hops:", result.bestPath.hops);
      console.log("  Input:", result.bestPath.sourceAmount, "XLM");
      console.log("  Output:", result.bestPath.destinationAmount, "USDC");
      console.log(
        "  Price Impact:",
        result.bestPath.priceImpact.toFixed(2),
        "%"
      );
      console.log("  Efficiency:", result.bestPath.efficiency.toFixed(4));
      console.log("  Evaluation Time:", result.evaluationTime, "ms");
      console.log("  Total Paths Found:", result.allPaths.length);
      console.log();
    } catch (error) {
      console.error("Error:", error);
    }
  });
}
// ============================================
// Example 2: Comparing Multiple Paths
// ============================================
function compareMultiplePaths() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Example 2: Comparing Multiple Paths ===\n");
    const sourceAsset = StellarSdk.Asset.native();
    const destAsset = new StellarSdk.Asset(
      "USDT",
      "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V"
    );
    try {
      const result =
        yield multiHopPathFinder_1.multiHopPathFinder.findOptimalPath(
          sourceAsset,
          destAsset,
          "1000.0000000",
          { maxHops: 4 }
        );
      console.log("All Available Paths:\n");
      result.allPaths.forEach((path, index) => {
        console.log(`Path ${index + 1}:`);
        console.log("  Route:", path.route.join(" → "));
        console.log("  Hops:", path.hops);
        console.log("  Output:", path.destinationAmount);
        console.log("  Efficiency:", path.efficiency.toFixed(4));
        console.log("  Price Impact:", path.priceImpact.toFixed(2), "%");
        console.log(
          "  Slippage:",
          (path.estimatedSlippage * 100).toFixed(3),
          "%"
        );
        console.log();
      });
      console.log("Selected Best Path:", result.bestPath.route.join(" → "));
      console.log();
    } catch (error) {
      console.error("Error:", error);
    }
  });
}
// ============================================
// Example 3: Using with Price Service
// ============================================
function priceServiceIntegration() {
  return __awaiter(this, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    console.log("=== Example 3: Price Service Integration ===\n");
    try {
      // Standard price quote
      const standardQuote = yield stellarPrice_service_1.default.getPrice(
        "XLM",
        "USDC",
        100
      );
      console.log("Standard Quote:");
      console.log("  Price:", standardQuote.price);
      console.log("  Output:", standardQuote.estimatedOutput);
      console.log(
        "  Path:",
        ((_a = standardQuote.path) === null || _a === void 0
          ? void 0
          : _a.join(" → ")) || "N/A"
      );
      console.log("  Cached:", standardQuote.cached);
      console.log();
      // Multi-hop quote
      const multiHopQuote =
        yield stellarPrice_service_1.default.getPriceWithMultiHop(
          "XLM",
          "USDC",
          100,
          5
        );
      console.log("Multi-Hop Quote:");
      console.log("  Price:", multiHopQuote.price);
      console.log("  Output:", multiHopQuote.estimatedOutput);
      console.log(
        "  Path:",
        ((_b = multiHopQuote.path) === null || _b === void 0
          ? void 0
          : _b.join(" → ")) || "N/A"
      );
      console.log("  Analysis:");
      console.log(
        "    Total Paths:",
        (_c = multiHopQuote.multiHopAnalysis) === null || _c === void 0
          ? void 0
          : _c.totalPathsFound
      );
      console.log(
        "    Best Path Hops:",
        (_d = multiHopQuote.multiHopAnalysis) === null || _d === void 0
          ? void 0
          : _d.bestPathHops
      );
      console.log(
        "    Efficiency:",
        (_e = multiHopQuote.multiHopAnalysis) === null || _e === void 0
          ? void 0
          : _e.efficiency.toFixed(4)
      );
      console.log();
    } catch (error) {
      console.error("Error:", error);
    }
  });
}
// ============================================
// Example 4: Using the Agent Tool
// ============================================
function agentToolUsage() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Example 4: Agent Tool Usage ===\n");
    try {
      const result = yield ToolRegistry_1.toolRegistry.executeTool(
        "multi_hop_trade",
        {
          fromAsset: "XLM",
          toAsset: "USDC",
          amount: 500,
          maxHops: 3,
        },
        "example-user-id"
      );
      if (result.success) {
        console.log("Tool Execution Successful!\n");
        console.log("Best Path:");
        console.log("  Route:", result.data.bestPath.route.join(" → "));
        console.log("  Hops:", result.data.bestPath.hops);
        console.log("  Output:", result.data.bestPath.destinationAmount);
        console.log("  Price Impact:", result.data.bestPath.priceImpact);
        console.log("  Slippage:", result.data.bestPath.estimatedSlippage);
        console.log("  Efficiency:", result.data.bestPath.efficiency);
        console.log();
        console.log("Alternative Paths:");
        result.data.alternativePaths.forEach((path, index) => {
          console.log(
            `  ${index + 1}. ${path.route.join(" → ")} (${path.hops} hops)`
          );
        });
        console.log();
        console.log("Recommendation:", result.data.recommendation);
        console.log();
      } else {
        console.error("Tool execution failed:", result.error);
      }
    } catch (error) {
      console.error("Error:", error);
    }
  });
}
// ============================================
// Example 5: Path Comparison
// ============================================
function pathComparison() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Example 5: Path Comparison ===\n");
    const path1 = {
      path: [],
      sourceAmount: "100",
      destinationAmount: "12.5",
      priceImpact: 0.6,
      estimatedSlippage: 0.0015,
      hops: 2,
      route: ["XLM", "USDC", "USDT"],
      efficiency: 12.35,
    };
    const path2 = {
      path: [],
      sourceAmount: "100",
      destinationAmount: "12.3",
      priceImpact: 0.9,
      estimatedSlippage: 0.0023,
      hops: 3,
      route: ["XLM", "USDC", "BTC", "USDT"],
      efficiency: 12.05,
    };
    const betterPath = multiHopPathFinder_1.multiHopPathFinder.comparePaths(
      path1,
      path2
    );
    console.log("Path 1:", path1.route.join(" → "));
    console.log("  Efficiency:", path1.efficiency);
    console.log("  Hops:", path1.hops);
    console.log();
    console.log("Path 2:", path2.route.join(" → "));
    console.log("  Efficiency:", path2.efficiency);
    console.log("  Hops:", path2.hops);
    console.log();
    console.log("Better Path:", betterPath.route.join(" → "));
    console.log("  Reason: Higher efficiency score");
    console.log();
  });
}
// ============================================
// Example 6: Error Handling
// ============================================
function errorHandling() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Example 6: Error Handling ===\n");
    // Invalid asset
    try {
      yield ToolRegistry_1.toolRegistry.executeTool(
        "multi_hop_trade",
        {
          fromAsset: "INVALID",
          toAsset: "USDC",
          amount: 100,
        },
        "user-id"
      );
    } catch (error) {
      console.log("Caught expected error for invalid asset");
    }
    // Same source and destination
    try {
      const result = yield ToolRegistry_1.toolRegistry.executeTool(
        "multi_hop_trade",
        {
          fromAsset: "XLM",
          toAsset: "XLM",
          amount: 100,
        },
        "user-id"
      );
      if (!result.success) {
        console.log("Error:", result.error);
      }
    } catch (error) {
      console.log("Caught error:", error);
    }
    console.log();
  });
}
// ============================================
// Run All Examples
// ============================================
function runAllExamples() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n╔════════════════════════════════════════════════╗");
    console.log("║  Multi-Hop Trade Path Evaluation Examples     ║");
    console.log("╚════════════════════════════════════════════════╝\n");
    try {
      yield basicPathFinding();
      yield compareMultiplePaths();
      yield priceServiceIntegration();
      yield agentToolUsage();
      yield pathComparison();
      yield errorHandling();
      console.log("✓ All examples completed successfully!");
    } catch (error) {
      console.error("Example execution failed:", error);
    }
  });
}
// Run if executed directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}
