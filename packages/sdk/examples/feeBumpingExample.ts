/**
 * Fee Bumping Example
 *
 * This example demonstrates how to use the FeeBumpingEngine to automatically
 * handle resource limit errors in Soroban transactions.
 */

import { FeeBumpingEngine, createFeeBumpingEngine } from "../src/feeBumping";
import { ResourceLimits } from "../src/types";

// Example 1: Basic usage with default configuration
async function basicExample() {
  console.log("=== Basic Fee Bumping Example ===\n");

  const engine = new FeeBumpingEngine();

  // Simulate a transaction that might fail due to resource limits
  const result = await engine.bumpAndRetry(async (limits: ResourceLimits) => {
    console.log("Attempting transaction with limits:", limits);

    // Your actual Soroban transaction here
    // For example: await sorobanClient.invokeContract({ ...params, resourceLimits: limits })

    // Simulating success
    return { hash: "0x123abc", status: "success" };
  });

  if (result.success) {
    console.log("✓ Transaction succeeded!");
    console.log("  Transaction hash:", result.result?.hash);
    console.log("  Final limits:", result.finalLimits);
    console.log("  Estimated fee:", result.estimatedFee, "stroops");
  } else {
    console.log("✗ Transaction failed:", result.error);
  }
}

// Example 2: Using different strategies
async function strategyExample() {
  console.log("\n=== Strategy Comparison Example ===\n");

  const strategies = ["conservative", "moderate", "aggressive"] as const;

  for (const strategy of strategies) {
    const engine = new FeeBumpingEngine({ strategy });

    // Simulate a resource error
    const mockError = "cpu instructions exceeded 150000000 limit 100000000";
    const currentLimits = FeeBumpingEngine.getDefaultLimits();

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
}

// Example 3: Custom initial limits
async function customLimitsExample() {
  console.log("\n=== Custom Initial Limits Example ===\n");

  const engine = new FeeBumpingEngine();

  // Use custom initial limits for a specific contract
  const customLimits = {
    cpuInstructions: 50_000_000, // Lower than default
    readBytes: 100_000,
    writeBytes: 50_000,
  };

  const result = await engine.bumpAndRetry(async (limits: ResourceLimits) => {
    console.log("Using custom limits:", limits);
    return { hash: "0x456def", status: "success" };
  }, customLimits);

  console.log("Result:", result.success ? "Success" : "Failed");
}

// Example 4: Monitoring fee bumps with callback
async function callbackExample() {
  console.log("\n=== Fee Bump Monitoring Example ===\n");

  const engine = new FeeBumpingEngine({
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
  const result = await engine.bumpAndRetry(async (limits: ResourceLimits) => {
    attemptCount++;
    console.log(
      `\nAttempt ${attemptCount}:`,
      limits.cpuInstructions,
      "CPU instructions"
    );

    if (attemptCount < 3) {
      throw new Error("cpu instructions exceeded 150000000 limit 100000000");
    }

    return { hash: "0x789ghi", status: "success" };
  });

  console.log("\n✓ Final result:", result.success ? "Success" : "Failed");
  console.log("  Total attempts:", result.attempts.length + 1);
}

// Example 5: Handling different resource errors
async function multipleResourcesExample() {
  console.log("\n=== Multiple Resource Errors Example ===\n");

  const engine = new FeeBumpingEngine({ maxAttempts: 5 });

  // Simulate different resource errors
  let attemptCount = 0;
  const result = await engine.bumpAndRetry(async (limits: ResourceLimits) => {
    attemptCount++;

    if (attemptCount === 1) {
      throw new Error("cpu instructions exceeded 150000000 limit 100000000");
    } else if (attemptCount === 2) {
      throw new Error("read bytes exceeded 250000 limit 200000");
    } else if (attemptCount === 3) {
      throw new Error("write bytes exceeded 150000 limit 100000");
    }

    return { hash: "0xabcdef", status: "success" };
  });

  console.log("✓ Transaction succeeded after", attemptCount, "attempts");
  console.log("  Final limits:", result.finalLimits);
  console.log("  Attempt history:");
  result.attempts.forEach((attempt, i) => {
    console.log(`    ${i + 1}. ${attempt.error?.substring(0, 50)}...`);
  });
}

// Example 6: Fee estimation
function feeEstimationExample() {
  console.log("\n=== Fee Estimation Example ===\n");

  const engine = new FeeBumpingEngine();

  const scenarios = [
    { name: "Default limits", limits: FeeBumpingEngine.getDefaultLimits() },
    {
      name: "Low limits",
      limits: {
        cpuInstructions: 50_000_000,
        readBytes: 100_000,
        writeBytes: 50_000,
        readLedgerEntries: 20,
        writeLedgerEntries: 10,
        txSizeByte: 50_000,
      },
    },
    {
      name: "High limits",
      limits: {
        cpuInstructions: 200_000_000,
        readBytes: 400_000,
        writeBytes: 200_000,
        readLedgerEntries: 80,
        writeLedgerEntries: 50,
        txSizeByte: 200_000,
      },
    },
  ];

  scenarios.forEach((scenario) => {
    const fee = engine.estimateFee(scenario.limits);
    console.log(`${scenario.name}:`);
    console.log(
      `  Estimated fee: ${fee} stroops (${(fee / 10_000_000).toFixed(4)} XLM)`
    );
  });
}

// Example 7: Using the factory function
async function factoryExample() {
  console.log("\n=== Factory Function Example ===\n");

  // Create engine using factory function
  const engine = createFeeBumpingEngine({
    strategy: "aggressive",
    maxAttempts: 5,
  });

  const result = await engine.bumpAndRetry(async (limits: ResourceLimits) => {
    return { hash: "0xfactory", status: "success" };
  });

  console.log("✓ Created engine via factory function");
  console.log("  Result:", result.success ? "Success" : "Failed");
}

// Run all examples
async function runAllExamples() {
  try {
    await basicExample();
    await strategyExample();
    await customLimitsExample();
    await callbackExample();
    await multipleResourcesExample();
    feeEstimationExample();
    await factoryExample();

    console.log("\n=== All examples completed successfully! ===\n");
  } catch (error) {
    console.error("Error running examples:", error);
  }
}

// Uncomment to run examples
// runAllExamples();

export {
  basicExample,
  strategyExample,
  customLimitsExample,
  callbackExample,
  multipleResourcesExample,
  feeEstimationExample,
  factoryExample,
  runAllExamples,
};
