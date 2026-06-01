"use strict";
/**
 * Fee Bumping Example
 *
 * This example demonstrates how to use the FeeBumpingEngine to automatically
 * handle resource limit errors in Soroban transactions.
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
exports.basicExample = basicExample;
exports.strategyExample = strategyExample;
exports.customLimitsExample = customLimitsExample;
exports.callbackExample = callbackExample;
exports.multipleResourcesExample = multipleResourcesExample;
exports.feeEstimationExample = feeEstimationExample;
exports.factoryExample = factoryExample;
exports.runAllExamples = runAllExamples;
const feeBumping_1 = require("../src/feeBumping");
// Example 1: Basic usage with default configuration
function basicExample() {
  return __awaiter(this, void 0, void 0, function* () {
    var _a;
    console.log("=== Basic Fee Bumping Example ===\n");
    const engine = new feeBumping_1.FeeBumpingEngine();
    // Simulate a transaction that might fail due to resource limits
    const result = yield engine.bumpAndRetry((limits) =>
      __awaiter(this, void 0, void 0, function* () {
        console.log("Attempting transaction with limits:", limits);
        // Your actual Soroban transaction here
        // For example: await sorobanClient.invokeContract({ ...params, resourceLimits: limits })
        // Simulating success
        return { hash: "0x123abc", status: "success" };
      })
    );
    if (result.success) {
      console.log("✓ Transaction succeeded!");
      console.log(
        "  Transaction hash:",
        (_a = result.result) === null || _a === void 0 ? void 0 : _a.hash
      );
      console.log("  Final limits:", result.finalLimits);
      console.log("  Estimated fee:", result.estimatedFee, "stroops");
    } else {
      console.log("✗ Transaction failed:", result.error);
    }
  });
}
// Example 2: Using different strategies
function strategyExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Strategy Comparison Example ===\n");
    const strategies = ["conservative", "moderate", "aggressive"];
    for (const strategy of strategies) {
      const engine = new feeBumping_1.FeeBumpingEngine({ strategy });
      // Simulate a resource error
      const mockError = "cpu instructions exceeded 150000000 limit 100000000";
      const currentLimits = feeBumping_1.FeeBumpingEngine.getDefaultLimits();
      const adjusted = engine.calculateAdjustment(mockError, currentLimits);
      if (adjusted) {
        console.log(`${strategy.toUpperCase()} strategy:`);
        console.log(`  Original CPU: ${currentLimits.cpuInstructions}`);
        console.log(`  Adjusted CPU: ${adjusted.cpuInstructions}`);
        console.log(
          `  Multiplier: ${(adjusted.cpuInstructions / 150000000).toFixed(2)}x\n`
        );
      }
    }
  });
}
// Example 3: Custom initial limits
function customLimitsExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Custom Initial Limits Example ===\n");
    const engine = new feeBumping_1.FeeBumpingEngine();
    // Use custom initial limits for a specific contract
    const customLimits = {
      cpuInstructions: 50000000, // Lower than default
      readBytes: 100000,
      writeBytes: 50000,
    };
    const result = yield engine.bumpAndRetry(
      (limits) =>
        __awaiter(this, void 0, void 0, function* () {
          console.log("Using custom limits:", limits);
          return { hash: "0x456def", status: "success" };
        }),
      customLimits
    );
    console.log("Result:", result.success ? "Success" : "Failed");
  });
}
// Example 4: Monitoring fee bumps with callback
function callbackExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Fee Bump Monitoring Example ===\n");
    const engine = new feeBumping_1.FeeBumpingEngine({
      strategy: "moderate",
      maxAttempts: 3,
      onBump: (info) => {
        console.log(`\n[Bump #${info.attempt}]`);
        console.log(`  Resource: ${info.error.resource}`);
        console.log(`  Required: ${info.error.required}`);
        console.log(
          `  Previous limit: ${info.previousLimits[info.error.resource]}`
        );
        console.log(`  New limit: ${info.newLimits[info.error.resource]}`);
      },
    });
    // Simulate a transaction that fails twice then succeeds
    let attemptCount = 0;
    const result = yield engine.bumpAndRetry((limits) =>
      __awaiter(this, void 0, void 0, function* () {
        attemptCount++;
        console.log(
          `\nAttempt ${attemptCount}:`,
          limits.cpuInstructions,
          "CPU instructions"
        );
        if (attemptCount < 3) {
          throw new Error(
            "cpu instructions exceeded 150000000 limit 100000000"
          );
        }
        return { hash: "0x789ghi", status: "success" };
      })
    );
    console.log("\n✓ Final result:", result.success ? "Success" : "Failed");
    console.log("  Total attempts:", result.attempts.length + 1);
  });
}
// Example 5: Handling different resource errors
function multipleResourcesExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Multiple Resource Errors Example ===\n");
    const engine = new feeBumping_1.FeeBumpingEngine({ maxAttempts: 5 });
    // Simulate different resource errors
    let attemptCount = 0;
    const result = yield engine.bumpAndRetry((limits) =>
      __awaiter(this, void 0, void 0, function* () {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error(
            "cpu instructions exceeded 150000000 limit 100000000"
          );
        } else if (attemptCount === 2) {
          throw new Error("read bytes exceeded 250000 limit 200000");
        } else if (attemptCount === 3) {
          throw new Error("write bytes exceeded 150000 limit 100000");
        }
        return { hash: "0xabcdef", status: "success" };
      })
    );
    console.log("✓ Transaction succeeded after", attemptCount, "attempts");
    console.log("  Final limits:", result.finalLimits);
    console.log("  Attempt history:");
    result.attempts.forEach((attempt, i) => {
      var _a;
      console.log(
        `    ${i + 1}. ${(_a = attempt.error) === null || _a === void 0 ? void 0 : _a.substring(0, 50)}...`
      );
    });
  });
}
// Example 6: Fee estimation
function feeEstimationExample() {
  console.log("\n=== Fee Estimation Example ===\n");
  const engine = new feeBumping_1.FeeBumpingEngine();
  const scenarios = [
    {
      name: "Default limits",
      limits: feeBumping_1.FeeBumpingEngine.getDefaultLimits(),
    },
    {
      name: "Low limits",
      limits: {
        cpuInstructions: 50000000,
        readBytes: 100000,
        writeBytes: 50000,
        readLedgerEntries: 20,
        writeLedgerEntries: 10,
        txSizeByte: 50000,
      },
    },
    {
      name: "High limits",
      limits: {
        cpuInstructions: 200000000,
        readBytes: 400000,
        writeBytes: 200000,
        readLedgerEntries: 80,
        writeLedgerEntries: 50,
        txSizeByte: 200000,
      },
    },
  ];
  scenarios.forEach((scenario) => {
    const fee = engine.estimateFee(scenario.limits);
    console.log(`${scenario.name}:`);
    console.log(
      `  Estimated fee: ${fee} stroops (${(fee / 10000000).toFixed(4)} XLM)`
    );
  });
}
// Example 7: Using the factory function
function factoryExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Factory Function Example ===\n");
    // Create engine using factory function
    const engine = (0, feeBumping_1.createFeeBumpingEngine)({
      strategy: "aggressive",
      maxAttempts: 5,
    });
    const result = yield engine.bumpAndRetry((limits) =>
      __awaiter(this, void 0, void 0, function* () {
        return { hash: "0xfactory", status: "success" };
      })
    );
    console.log("✓ Created engine via factory function");
    console.log("  Result:", result.success ? "Success" : "Failed");
  });
}
// Run all examples
function runAllExamples() {
  return __awaiter(this, void 0, void 0, function* () {
    try {
      yield basicExample();
      yield strategyExample();
      yield customLimitsExample();
      yield callbackExample();
      yield multipleResourcesExample();
      feeEstimationExample();
      yield factoryExample();
      console.log("\n=== All examples completed successfully! ===\n");
    } catch (error) {
      console.error("Error running examples:", error);
    }
  });
}
