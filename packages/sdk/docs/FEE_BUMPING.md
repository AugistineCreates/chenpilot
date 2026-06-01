# Soroban Fee Bumping Guide

## Overview

The Fee Bumping Engine automatically adjusts resource limits for Soroban transactions that fail due to insufficient resources. Instead of manually calculating and retrying with higher limits, the engine handles this process automatically with configurable strategies.

## Table of Contents

- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Usage Examples](#usage-examples)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Quick Start

```typescript
import { FeeBumpingEngine } from "@chen-pilot/sdk-core";

// Create engine with default configuration
const engine = new FeeBumpingEngine();

// Execute transaction with automatic fee bumping
const result = await engine.bumpAndRetry(async (limits) => {
  return await sorobanClient.invokeContract({
    contractId: "CXXX...",
    method: "transfer",
    args: [...],
    resourceLimits: limits,
  });
});

if (result.success) {
  console.log("Transaction hash:", result.result.hash);
  console.log("Final fee:", result.estimatedFee, "stroops");
} else {
  console.error("Transaction failed:", result.error);
}
```

## Core Concepts

### Resource Limits

Soroban transactions require specifying resource limits for:

- **CPU Instructions**: Computational resources
- **Read Bytes**: Data read from ledger
- **Write Bytes**: Data written to ledger
- **Read Ledger Entries**: Number of ledger entries read
- **Write Ledger Entries**: Number of ledger entries written
- **Transaction Size**: Size of the transaction in bytes

### Fee Bumping Strategies

The engine supports three strategies for adjusting limits:

| Strategy         | Multiplier | Use Case                                           |
| ---------------- | ---------- | -------------------------------------------------- |
| **Conservative** | 1.2x       | Cost-sensitive applications, predictable contracts |
| **Moderate**     | 1.5x       | General purpose (default)                          |
| **Aggressive**   | 2.0x       | Complex contracts, unpredictable resource usage    |

### Proportional Bumping

When a specific resource limit is exceeded, the engine:

1. Bumps the failed resource by the strategy multiplier
2. Bumps all other resources by 1.1x to prevent cascading failures

This approach ensures that related resource constraints don't cause subsequent failures.

## API Reference

### FeeBumpingEngine

#### Constructor

```typescript
new FeeBumpingEngine(config?: FeeBumpConfig)
```

**Parameters:**

- `config.strategy` (optional): Fee bump strategy - "conservative" | "moderate" | "aggressive"
- `config.maxAttempts` (optional): Maximum retry attempts (default: 3)
- `config.initialLimits` (optional): Initial resource limits (uses defaults if not provided)
- `config.onBump` (optional): Callback invoked when limits are bumped

**Example:**

```typescript
const engine = new FeeBumpingEngine({
  strategy: "aggressive",
  maxAttempts: 5,
  onBump: (info) => {
    console.log(
      `Bumping ${info.error.resource} from ${info.previousLimits[info.error.resource]} to ${info.newLimits[info.error.resource]}`
    );
  },
});
```

#### Methods

##### bumpAndRetry<T>

Execute a transaction with automatic fee bumping.

```typescript
async bumpAndRetry<T>(
  txExecutor: (limits: ResourceLimits) => Promise<T>,
  initialLimits?: Partial<ResourceLimits>
): Promise<FeeBumpResult<T>>
```

**Parameters:**

- `txExecutor`: Function that executes the transaction with given limits
- `initialLimits` (optional): Override initial limits for this transaction

**Returns:** `FeeBumpResult<T>` containing:

- `success`: Whether the transaction succeeded
- `result`: Transaction result if successful
- `error`: Error message if failed
- `finalLimits`: Final resource limits used
- `attempts`: History of all attempts
- `estimatedFee`: Estimated fee in stroops

**Example:**

```typescript
const result = await engine.bumpAndRetry(
  async (limits) => {
    return await invokeContract({ ...params, resourceLimits: limits });
  },
  { cpuInstructions: 50_000_000 } // Custom initial limit
);
```

##### calculateAdjustment

Manually calculate adjusted limits for a given error.

```typescript
calculateAdjustment(
  error: string,
  currentLimits: ResourceLimits
): ResourceLimits | null
```

**Parameters:**

- `error`: Error message from failed transaction
- `currentLimits`: Current resource limits

**Returns:** Adjusted limits or null if error is not resource-related

**Example:**

```typescript
const adjusted = engine.calculateAdjustment(
  "cpu instructions exceeded 150000000 limit 100000000",
  currentLimits
);
```

##### estimateFee

Estimate the fee for given resource limits.

```typescript
estimateFee(limits: ResourceLimits): number
```

**Parameters:**

- `limits`: Resource limits to estimate fee for

**Returns:** Estimated fee in stroops

**Example:**

```typescript
const fee = engine.estimateFee(limits);
console.log(`Estimated fee: ${fee / 10_000_000} XLM`);
```

##### getDefaultLimits (static)

Get default resource limits.

```typescript
static getDefaultLimits(): ResourceLimits
```

**Returns:** Default resource limits

**Example:**

```typescript
const defaults = FeeBumpingEngine.getDefaultLimits();
```

### Factory Function

#### createFeeBumpingEngine

Create a fee bumping engine with optional configuration.

```typescript
function createFeeBumpingEngine(config?: FeeBumpConfig): FeeBumpingEngine;
```

**Example:**

```typescript
const engine = createFeeBumpingEngine({ strategy: "conservative" });
```

## Usage Examples

### Example 1: Basic Usage

```typescript
import { FeeBumpingEngine } from "@chen-pilot/sdk-core";

const engine = new FeeBumpingEngine();

const result = await engine.bumpAndRetry(async (limits) => {
  return await sorobanClient.invokeContract({
    contractId: "CXXX...",
    method: "swap",
    args: [tokenA, tokenB, amount],
    resourceLimits: limits,
  });
});

if (result.success) {
  console.log("Swap successful:", result.result);
} else {
  console.error("Swap failed:", result.error);
}
```

### Example 2: Custom Strategy and Monitoring

```typescript
const engine = new FeeBumpingEngine({
  strategy: "aggressive",
  maxAttempts: 5,
  onBump: (info) => {
    console.log(`[Attempt ${info.attempt}] Bumping ${info.error.resource}`);
    console.log(`  Required: ${info.error.required}`);
    console.log(`  New limit: ${info.newLimits[info.error.resource]}`);
  },
});

const result = await engine.bumpAndRetry(async (limits) => {
  return await complexContractOperation(limits);
});
```

### Example 3: Custom Initial Limits

```typescript
const engine = new FeeBumpingEngine();

// Use lower initial limits for a simple operation
const result = await engine.bumpAndRetry(
  async (limits) => {
    return await simpleTransfer(limits);
  },
  {
    cpuInstructions: 50_000_000,
    readBytes: 100_000,
    writeBytes: 50_000,
  }
);
```

### Example 4: Fee Estimation

```typescript
const engine = new FeeBumpingEngine();

// Estimate fee before execution
const limits = FeeBumpingEngine.getDefaultLimits();
const estimatedFee = engine.estimateFee(limits);

console.log(`Estimated fee: ${estimatedFee / 10_000_000} XLM`);

// Execute if fee is acceptable
if (estimatedFee < maxAcceptableFee) {
  const result = await engine.bumpAndRetry(txExecutor);
}
```

### Example 5: Error Handling

```typescript
const engine = new FeeBumpingEngine({ maxAttempts: 3 });

const result = await engine.bumpAndRetry(async (limits) => {
  return await riskyOperation(limits);
});

if (!result.success) {
  if (result.error?.includes("Max retry attempts")) {
    console.error("Transaction requires more resources than available");
    console.log("Final limits attempted:", result.finalLimits);
  } else {
    console.error("Transaction failed for non-resource reason:", result.error);
  }
}
```

## Best Practices

### 1. Choose the Right Strategy

- **Conservative**: Use for well-tested contracts with predictable resource usage
- **Moderate**: Default choice for most applications
- **Aggressive**: Use for complex or unpredictable contracts

### 2. Set Appropriate Max Attempts

```typescript
// For simple operations
const engine = new FeeBumpingEngine({ maxAttempts: 2 });

// For complex operations
const engine = new FeeBumpingEngine({ maxAttempts: 5 });
```

### 3. Monitor Fee Bumps

Use the `onBump` callback to track resource adjustments:

```typescript
const engine = new FeeBumpingEngine({
  onBump: (info) => {
    // Log to monitoring service
    logger.info("Fee bump", {
      attempt: info.attempt,
      resource: info.error.resource,
      increase:
        info.newLimits[info.error.resource] -
        info.previousLimits[info.error.resource],
    });
  },
});
```

### 4. Use Custom Initial Limits

Optimize costs by starting with appropriate limits:

```typescript
// For simple read operations
const readLimits = {
  cpuInstructions: 30_000_000,
  readBytes: 50_000,
  writeBytes: 0,
};

// For complex write operations
const writeLimits = {
  cpuInstructions: 150_000_000,
  readBytes: 300_000,
  writeBytes: 200_000,
};
```

### 5. Handle Non-Resource Errors

The engine only retries resource errors. Handle other errors separately:

```typescript
const result = await engine.bumpAndRetry(txExecutor);

if (!result.success) {
  if (result.attempts.length === 0) {
    // Non-resource error on first attempt
    console.error("Transaction failed immediately:", result.error);
  } else {
    // Resource error after retries
    console.error("Insufficient resources:", result.error);
  }
}
```

### 6. Estimate Fees Before Execution

```typescript
const engine = new FeeBumpingEngine();
const limits = FeeBumpingEngine.getDefaultLimits();
const fee = engine.estimateFee(limits);

// Show fee to user before execution
if (await userConfirmsFee(fee)) {
  const result = await engine.bumpAndRetry(txExecutor);
}
```

## Troubleshooting

### Transaction Still Fails After Max Attempts

**Problem:** Transaction fails even after maximum retry attempts.

**Solutions:**

1. Increase `maxAttempts`:

   ```typescript
   const engine = new FeeBumpingEngine({ maxAttempts: 5 });
   ```

2. Use a more aggressive strategy:

   ```typescript
   const engine = new FeeBumpingEngine({ strategy: "aggressive" });
   ```

3. Set higher initial limits:
   ```typescript
   const result = await engine.bumpAndRetry(txExecutor, {
     cpuInstructions: 200_000_000,
   });
   ```

### Fees Too High

**Problem:** Estimated fees are higher than expected.

**Solutions:**

1. Use conservative strategy:

   ```typescript
   const engine = new FeeBumpingEngine({ strategy: "conservative" });
   ```

2. Optimize contract code to use fewer resources

3. Start with lower initial limits:
   ```typescript
   const result = await engine.bumpAndRetry(txExecutor, {
     cpuInstructions: 50_000_000,
   });
   ```

### Non-Resource Errors Not Retried

**Problem:** Transaction fails with non-resource error and doesn't retry.

**Solution:** This is expected behavior. The engine only retries resource errors. Handle other errors separately:

```typescript
const result = await engine.bumpAndRetry(txExecutor);

if (!result.success && result.attempts.length === 0) {
  // Handle non-resource error
  console.error("Non-resource error:", result.error);
}
```

### Cascading Resource Failures

**Problem:** Fixing one resource limit causes another to fail.

**Solution:** The engine automatically bumps all resources proportionally (1.1x) to prevent this. If it still occurs, use a more aggressive strategy:

```typescript
const engine = new FeeBumpingEngine({ strategy: "aggressive" });
```

## Advanced Topics

### Custom Fee Calculation

The default fee estimation is simplified. For production use, integrate with actual network fee rates:

```typescript
class CustomFeeBumpingEngine extends FeeBumpingEngine {
  estimateFee(limits: ResourceLimits): number {
    // Use actual network fee rates
    const networkFeeRate = await getNetworkFeeRate();
    return calculateActualFee(limits, networkFeeRate);
  }
}
```

### Integration with Stellar SDK

```typescript
import { SorobanRpc, Contract } from "@stellar/stellar-sdk";

const engine = new FeeBumpingEngine();

const result = await engine.bumpAndRetry(async (limits) => {
  const contract = new Contract(contractId);
  const operation = contract.call("method", ...args);

  const transaction = new TransactionBuilder(account, {
    fee: limits.txSizeByte.toString(),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  transaction.sign(keypair);

  return await server.sendTransaction(transaction);
});
```

### Batch Operations

```typescript
const engine = new FeeBumpingEngine();

const results = await Promise.all(
  operations.map((op) =>
    engine.bumpAndRetry(async (limits) => {
      return await executeOperation(op, limits);
    })
  )
);
```

## Related Documentation

- [Soroban Resource Model](https://soroban.stellar.org/docs/fundamentals-and-concepts/resource-limits-fees)
- [Stellar SDK Documentation](https://stellar.github.io/js-stellar-sdk/)
- [SDK Core API Reference](./API.md)

## Support

For issues or questions:

- GitHub Issues: [github.com/gear5labs/chenpilot/issues](https://github.com/gear5labs/chenpilot/issues)
- Documentation: [Full SDK Documentation](./README.md)
