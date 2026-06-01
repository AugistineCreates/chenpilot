# Multi-Signature Account Configuration

Comprehensive guide for setting up and managing multi-signature accounts using the Chen Pilot SDK.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

Multi-signature (multi-sig) accounts require multiple parties to authorize transactions, providing enhanced security for critical operations. The SDK provides a fluent builder API for creating and managing complex multi-sig configurations with automatic validation.

### Key Features

- **Fluent Builder API**: Chain methods for intuitive configuration
- **Automatic Validation**: Catch configuration errors before deployment
- **Preset Configurations**: Quick setup for common scenarios
- **Weight-Based System**: Flexible authorization with weighted signers
- **Threshold Categories**: Different requirements for different operation types
- **Fee Estimation**: Calculate transaction costs upfront

## Quick Start

### Basic 2-of-3 Multi-Sig

```typescript
import { MultiSigBuilder, ThresholdCategory } from "@chen-pilot/sdk-core";

const builder = new MultiSigBuilder("GMASTER_ACCOUNT_ADDRESS")
  .addSigner("GSIGNER1_ADDRESS", 10)
  .addSigner("GSIGNER2_ADDRESS", 10)
  .addSigner("GSIGNER3_ADDRESS", 10)
  .setThreshold(ThresholdCategory.MEDIUM, 20);

const result = builder.build();

if (result.validation.valid) {
  console.log("Configuration ready:", result.config);
  console.log("Estimated fee:", result.estimatedFee, "stroops");
}
```

### Using Presets

```typescript
const builder = MultiSigBuilder.createPreset(
  "2-of-3",
  "GMASTER_ACCOUNT_ADDRESS",
  ["GSIGNER1_ADDRESS", "GSIGNER2_ADDRESS", "GSIGNER3_ADDRESS"]
);

const result = builder.build();
```

## Core Concepts

### Signers and Weights

Each signer has a weight (0-255) representing their authorization power. Multiple signers can combine their weights to meet thresholds.

```typescript
builder
  .addSigner("GCEO_ADDRESS", 50) // CEO has 50 weight
  .addSigner("GCFO_ADDRESS", 30) // CFO has 30 weight
  .addSigner("GBOARD_ADDRESS", 10); // Board member has 10 weight
```

### Threshold Categories

Three threshold levels control different operation types:

- **LOW**: Basic operations (e.g., viewing balances)
- **MEDIUM**: Standard operations (e.g., payments)
- **HIGH**: Critical operations (e.g., account changes)

```typescript
builder.setThresholds({
  low: 10, // Any board member
  medium: 50, // CEO alone
  high: 80, // CEO + CFO or CEO + multiple board members
});
```

### Validation

Automatic validation checks for:

- Invalid addresses or weights
- Thresholds exceeding total weight
- Threshold ordering issues
- Too many signers
- Zero-weight signers

```typescript
const validation = builder.validate();

if (!validation.valid) {
  console.error("Errors:", validation.errors);
}

if (validation.warnings.length > 0) {
  console.warn("Warnings:", validation.warnings);
}
```

## API Reference

### MultiSigBuilder

#### Constructor

```typescript
new MultiSigBuilder(
  masterAccount: string,
  options?: MultiSigBuilderOptions
)
```

**Options:**

- `autoValidate`: Validate on build (default: true)
- `allowDuplicates`: Allow duplicate signers (default: false)
- `maxSigners`: Maximum signers allowed (default: 20)

#### Methods

##### addSigner(address, weight)

Add a signer with specified weight.

```typescript
builder.addSigner("GSIGNER_ADDRESS", 25);
```

**Parameters:**

- `address` (string): Signer's public key
- `weight` (number): Weight 0-255

**Returns:** Builder instance for chaining

**Throws:** Error if weight invalid or duplicate signer

##### addSigners(signers)

Add multiple signers at once.

```typescript
builder.addSigners([
  { address: "GSIGNER1", weight: 10 },
  { address: "GSIGNER2", weight: 20 },
]);
```

##### removeSigner(address)

Remove a signer from configuration.

```typescript
builder.removeSigner("GSIGNER_ADDRESS");
```

##### updateSignerWeight(address, weight)

Update an existing signer's weight.

```typescript
builder.updateSignerWeight("GSIGNER_ADDRESS", 30);
```

##### setThreshold(category, value)

Set threshold for a specific category.

```typescript
builder.setThreshold(ThresholdCategory.MEDIUM, 25);
```

##### setThresholds(thresholds)

Set multiple thresholds at once.

```typescript
builder.setThresholds({
  low: 10,
  medium: 25,
  high: 40,
});
```

##### validate()

Validate current configuration.

```typescript
const validation = builder.validate();
// Returns: { valid: boolean, errors: string[], warnings: string[] }
```

##### build()

Build final configuration with validation.

```typescript
const result = builder.build();
// Returns: { config, validation, estimatedFee }
```

**Throws:** Error if autoValidate enabled and config invalid

##### reset()

Reset builder to initial state.

```typescript
builder.reset();
```

##### getConfig()

Get current configuration without building.

```typescript
const config = builder.getConfig();
```

#### Static Methods

##### createPreset(preset, masterAccount, signerAddresses)

Create preset configuration.

```typescript
const builder = MultiSigBuilder.createPreset("2-of-3", "GMASTER_ADDRESS", [
  "GSIGNER1",
  "GSIGNER2",
  "GSIGNER3",
]);
```

**Presets:**

- `"2-of-3"`: Requires 2 of 3 signers
- `"3-of-5"`: Requires 3 of 5 signers
- `"majority"`: Requires majority of signers
- `"unanimous"`: Requires all signers

### Utility Functions

#### validateMultiSigConfig(config)

Validate a configuration object.

```typescript
import { validateMultiSigConfig } from "@chen-pilot/sdk-core";

const validation = validateMultiSigConfig(config);
```

#### calculateTotalWeight(config)

Calculate total weight of all signers.

```typescript
import { calculateTotalWeight } from "@chen-pilot/sdk-core";

const total = calculateTotalWeight(config);
```

#### canMeetThreshold(signers, config, threshold)

Check if signers can meet a threshold.

```typescript
import { canMeetThreshold } from "@chen-pilot/sdk-core";

const canMeet = canMeetThreshold(["GSIGNER1", "GSIGNER2"], config, 30);
```

## Examples

### Example 1: Corporate Treasury

```typescript
const builder = new MultiSigBuilder("GTREASURY_MASTER")
  .addSigner("GTREASURER", 40)
  .addSigner("GFINANCE1", 20)
  .addSigner("GFINANCE2", 20)
  .setThresholds({
    low: 20, // Any finance member
    medium: 40, // Treasurer or both finance members
    high: 60, // Treasurer + at least one finance member
  });

const result = builder.build();
```

### Example 2: Weighted Governance

```typescript
const builder = new MultiSigBuilder("GDAO_MASTER")
  .addSigner("GFOUNDER", 50)
  .addSigner("GCORE_TEAM1", 25)
  .addSigner("GCORE_TEAM2", 25)
  .addSigner("GCOMMUNITY1", 10)
  .addSigner("GCOMMUNITY2", 10)
  .setThresholds({
    low: 10, // Any community member
    medium: 50, // Founder or both core team
    high: 75, // Founder + core team or core team + community
  });
```

### Example 3: Dynamic Updates

```typescript
// Start with basic config
const builder = new MultiSigBuilder("GMASTER")
  .addSigner("GSIGNER1", 10)
  .addSigner("GSIGNER2", 10);

// Later, add more signers
builder.addSigner("GSIGNER3", 15);

// Update existing signer
builder.updateSignerWeight("GSIGNER1", 20);

// Adjust thresholds
builder.setThreshold(ThresholdCategory.HIGH, 35);

const result = builder.build();
```

### Example 4: Validation Before Deployment

```typescript
const builder = new MultiSigBuilder("GMASTER", {
  autoValidate: false, // Manual validation
})
  .addSigner("GSIGNER1", 10)
  .addSigner("GSIGNER2", 10)
  .setThreshold(ThresholdCategory.HIGH, 50); // Too high!

const validation = builder.validate();

if (!validation.valid) {
  console.error("Configuration errors:");
  validation.errors.forEach((error) => console.error(`- ${error}`));

  // Fix the issues
  builder.setThreshold(ThresholdCategory.HIGH, 20);
}

const result = builder.build();
```

### Example 5: Checking Authorization

```typescript
const config = builder.build().config;

// Check if specific signers can authorize a transaction
const canAuthorize = canMeetThreshold(
  ["GSIGNER1", "GSIGNER2"],
  config,
  config.thresholds.medium
);

if (canAuthorize) {
  console.log("These signers can authorize the transaction");
} else {
  console.log("Additional signers required");
}
```

## Best Practices

### Security

1. **Use High Thresholds for Critical Operations**

   ```typescript
   builder.setThresholds({
     low: 10,
     medium: 30,
     high: 50, // Require significant authorization
   });
   ```

2. **Distribute Weights Appropriately**
   - Avoid single points of failure
   - Balance between security and usability
   - Consider organizational hierarchy

3. **Regular Audits**
   - Periodically review signer list
   - Remove inactive signers
   - Update weights as roles change

### Configuration

1. **Start with Presets**

   ```typescript
   // Use presets for common scenarios
   const builder = MultiSigBuilder.createPreset("2-of-3", master, signers);
   ```

2. **Validate Before Deployment**

   ```typescript
   const validation = builder.validate();
   if (!validation.valid) {
     // Handle errors before deploying
   }
   ```

3. **Consider Fee Costs**
   ```typescript
   const result = builder.build();
   console.log("Setup cost:", result.estimatedFee, "stroops");
   ```

### Operational

1. **Document Your Configuration**
   - Keep records of signer roles
   - Document threshold rationale
   - Maintain emergency procedures

2. **Test Configurations**
   - Verify signers can meet thresholds
   - Test with different signer combinations
   - Validate before production deployment

3. **Plan for Changes**
   - Design for future signer additions
   - Leave room for weight adjustments
   - Consider succession planning

## Troubleshooting

### Common Errors

#### "Threshold exceeds total weight"

**Problem:** Threshold higher than sum of all signer weights.

**Solution:**

```typescript
// Check total weight
const total = calculateTotalWeight(config);
console.log("Total weight:", total);

// Adjust threshold or add more signers
builder.setThreshold(ThresholdCategory.HIGH, total - 10);
```

#### "Signer already exists"

**Problem:** Attempting to add duplicate signer.

**Solution:**

```typescript
// Option 1: Update existing signer
builder.updateSignerWeight("GSIGNER", 30);

// Option 2: Allow duplicates
const builder = new MultiSigBuilder(master, {
  allowDuplicates: true,
});
```

#### "Too many signers"

**Problem:** Exceeded maximum signer limit.

**Solution:**

```typescript
// Increase limit or reduce signers
const builder = new MultiSigBuilder(master, {
  maxSigners: 30, // Increase limit
});
```

### Validation Warnings

#### "Medium threshold is lower than low threshold"

**Issue:** Threshold ordering doesn't follow expected pattern.

**Fix:**

```typescript
builder.setThresholds({
  low: 10,
  medium: 20, // Should be >= low
  high: 30, // Should be >= medium
});
```

#### "Signer(s) have zero weight"

**Issue:** Signers with zero weight cannot contribute to thresholds.

**Context:** Zero-weight signers are valid for observation/auditing purposes but cannot authorize transactions.

**Action:** Intentional if for auditors, otherwise increase weight.

### Performance Tips

1. **Minimize Signer Count**
   - Fewer signers = lower fees
   - Easier to manage
   - Faster validation

2. **Use Appropriate Weights**
   - Don't use unnecessarily large weights
   - Keep calculations simple
   - Use round numbers when possible

3. **Batch Updates**

   ```typescript
   // Add multiple signers at once
   builder.addSigners([...signers]);

   // Set all thresholds together
   builder.setThresholds({ low, medium, high });
   ```

## Advanced Topics

### Custom Validation Logic

```typescript
const builder = new MultiSigBuilder(master, {
  autoValidate: false,
});

// Build configuration
builder.addSigners(signers).setThresholds(thresholds);

// Custom validation
const validation = builder.validate();
const config = builder.getConfig();

// Add custom checks
if (config.signers.length < 3) {
  validation.errors.push("Minimum 3 signers required");
}

if (validation.valid && validation.errors.length === 0) {
  const result = builder.build();
}
```

### Integration with Stellar SDK

```typescript
import { MultiSigBuilder } from "@chen-pilot/sdk-core";
import { Server, TransactionBuilder, Operation } from "stellar-sdk";

const builder = new MultiSigBuilder(masterAccount)
  .addSigner(signer1, 10)
  .addSigner(signer2, 10)
  .setThreshold(ThresholdCategory.MEDIUM, 15);

const result = builder.build();

// Use with Stellar SDK
const server = new Server("https://horizon-testnet.stellar.org");
const account = await server.loadAccount(masterAccount);

const transaction = new TransactionBuilder(account, {
  fee: result.estimatedFee.toString(),
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.setOptions({
      lowThreshold: result.config.thresholds.low,
      medThreshold: result.config.thresholds.medium,
      highThreshold: result.config.thresholds.high,
      signer: {
        ed25519PublicKey: result.config.signers[0].address,
        weight: result.config.signers[0].weight,
      },
    })
  )
  .setTimeout(30)
  .build();
```

## Support

For issues, questions, or contributions:

- GitHub Issues: [github.com/gear5labs/chenpilot/issues](https://github.com/gear5labs/chenpilot/issues)
- Documentation: [Full SDK Documentation](../README.md)
- Examples: [Multi-Sig Examples](../examples/multiSigExample.ts)

## License

ISC
