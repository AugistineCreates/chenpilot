"use strict";
/**
 * @fileoverview Examples Index
 *
 * This file exports all example modules and provides a convenient way
 * to run all examples or specific example categories.
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
var __exportStar =
  (this && this.__exportStar) ||
  function (m, exports) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p))
        __createBinding(exports, m, p);
  };
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
exports.runAllExamples = void 0;
exports.runAdvancedExamples = runAdvancedExamples;
exports.runExample = runExample;
exports.listExamples = listExamples;
// Basic usage examples
__exportStar(require("./basic-usage"), exports);
// Advanced examples
__exportStar(require("./multi-signature-treasury"), exports);
__exportStar(require("./cross-chain-bridge"), exports);
__exportStar(require("./hardware-wallet-integration"), exports);
// Re-export main example runner
var basic_usage_1 = require("./basic-usage");
Object.defineProperty(exports, "runAllExamples", {
  enumerable: true,
  get: function () {
    return basic_usage_1.runAllExamples;
  },
});
/**
 * Run all advanced examples
 */
function runAdvancedExamples() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("🚀 Running Advanced Examples...\n");
    try {
      // Import and run advanced examples
      const { treasuryExample } = yield Promise.resolve().then(() =>
        __importStar(require("./multi-signature-treasury"))
      );
      const { crossChainBridgeExample } = yield Promise.resolve().then(() =>
        __importStar(require("./cross-chain-bridge"))
      );
      const { hardwareWalletExample } = yield Promise.resolve().then(() =>
        __importStar(require("./hardware-wallet-integration"))
      );
      yield treasuryExample();
      console.log("\n" + "=".repeat(60) + "\n");
      yield crossChainBridgeExample();
      console.log("\n" + "=".repeat(60) + "\n");
      yield hardwareWalletExample();
      console.log("\n🎉 All advanced examples completed successfully!");
    } catch (error) {
      console.error("❌ Advanced examples failed:", error);
      throw error;
    }
  });
}
/**
 * Run specific example by name
 */
function runExample(exampleName) {
  return __awaiter(this, void 0, void 0, function* () {
    console.log(`🎯 Running example: ${exampleName}\n`);
    switch (exampleName.toLowerCase()) {
      case "basic":
      case "basic-usage": {
        const { runAllExamples } = yield Promise.resolve().then(() =>
          __importStar(require("./basic-usage"))
        );
        yield runAllExamples();
        break;
      }
      case "treasury":
      case "multi-signature-treasury": {
        const { treasuryExample } = yield Promise.resolve().then(() =>
          __importStar(require("./multi-signature-treasury"))
        );
        yield treasuryExample();
        break;
      }
      case "bridge":
      case "cross-chain-bridge": {
        const { crossChainBridgeExample } = yield Promise.resolve().then(() =>
          __importStar(require("./cross-chain-bridge"))
        );
        yield crossChainBridgeExample();
        break;
      }
      case "hardware":
      case "hardware-wallet":
      case "hardware-wallet-integration": {
        const { hardwareWalletExample } = yield Promise.resolve().then(() =>
          __importStar(require("./hardware-wallet-integration"))
        );
        yield hardwareWalletExample();
        break;
      }
      case "all":
        yield runAllExamples();
        console.log("\n" + "=".repeat(60) + "\n");
        yield runAdvancedExamples();
        break;
      default:
        throw new Error(`Unknown example: ${exampleName}`);
    }
  });
}
/**
 * List all available examples
 */
function listExamples() {
  console.log("📚 Available Examples:\n");
  console.log("Basic Examples:");
  console.log(
    "  • basic-usage           - SDK initialization and basic operations"
  );
  console.log("  • multi-signature       - Multi-signature workflow example");
  console.log("  • provider-discovery    - Provider discovery and selection");
  console.log("  • signature-verification - Cross-chain signature validation");
  console.log("  • error-handling        - Error recovery and handling");
  console.log("  • sdk-builder           - SDK builder pattern usage");
  console.log("  • registry-management   - Provider registry operations");
  console.log("\nAdvanced Examples:");
  console.log(
    "  • treasury              - Multi-signature treasury management"
  );
  console.log("  • bridge                - Cross-chain bridge implementation");
  console.log("  • hardware-wallet       - Hardware wallet integration");
  console.log("\nUsage:");
  console.log("  npm run examples                    # Run all basic examples");
  console.log(
    "  npm run examples:advanced           # Run all advanced examples"
  );
  console.log("  npm run examples -- <example-name>  # Run specific example");
  console.log("  npm run examples -- all             # Run all examples");
}
// CLI interface when run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("🎯 No example specified. Running all basic examples...\n");
    runAllExamples().catch(console.error);
  } else if (args[0] === "list" || args[0] === "--list") {
    listExamples();
  } else if (args[0] === "advanced") {
    runAdvancedExamples().catch(console.error);
  } else {
    runExample(args[0]).catch(console.error);
  }
}
