# Multi-Sig Quick Reference

Quick reference guide for multi-signature account configuration in Chen Pilot SDK.

## Installation

```bash
npm install @chen-pilot/sdk-core
```

## Import

```typescript
import {
  MultiSigBuilder,
  ThresholdCategory,
  validateMultiSigConfig,
  calculateTotalWeight,
  canMeetThreshold,
} from "@chen-pilot/sdk-core";
```

## Basic Usage

```typescript
// Create builder
const builder = new MultiSigBuilder("GMASTER_ADDRESS");

// Add signers
builder.addSigner("GSIGNER1", 10);
builder.addSigner("GSIGNER2", 20);

// Set thresholds
builder.setThreshold(ThresholdCategory.MEDIUM, 15);

// Build and validate
const result = builder.build();
```

## Presets

```typescript
// 2-of-3
MultiSigBuilder.createPreset("2-of-3", master, [s1, s2, s3]);

// 3-of-5
MultiSigBuilder.createPreset("3-of-5", master, [s1, s2, s3, s4, s5]);

// Majority
MultiSigBuilder.createPreset("majority", master, signers);

// Unanimous
MultiSigBuilder.createPreset("unanimous", master, signers);
```

## Builder Methods

| Method                                | Description          | Example                                                  |
| ------------------------------------- | -------------------- | -------------------------------------------------------- |
| `addSigner(address, weight)`          | Add single signer    | `builder.addSigner("G...", 10)`                          |
| `addSigners(signers)`                 | Add multiple signers | `builder.addSigners([{address, weight}])`                |
| `removeSigner(address)`               | Remove signer        | `builder.removeSigner("G...")`                           |
| `updateSignerWeight(address, weight)` | Update weight        | `builder.updateSignerWeight("G...", 20)`                 |
| `setThreshold(category, value)`       | Set threshold        | `builder.setThreshold(ThresholdCategory.MEDIUM, 15)`     |
| `setThresholds(config)`               | Set all thresholds   | `builder.setThresholds({low: 10, medium: 20, high: 30})` |
| `validate()`                          | Validate config      | `const validation = builder.validate()`                  |
| `build()`                             | Build final config   | `const result = builder.build()`                         |
| `reset()`                             | Reset builder        | `builder.reset()`                                        |
| `getConfig()`                         | Get current config   | `const config = builder.getConfig()`                     |

## Threshold Categories

```typescript
ThresholdCategory.LOW; // Basic operations
ThresholdCategory.MEDIUM; // Standard operations
ThresholdCategory.HIGH; // Critical operations
```

## Validation

```typescript
// Automatic validation (default)
const builder = new MultiSigBuilder(master);
const result = builder.build(); // Throws if invalid

// Manual validation
const builder = new MultiSigBuilder(master, { autoValidate: false });
const validation = builder.validate();

if (!validation.valid) {
  console.error("Errors:", validation.errors);
}
if (validation.warnings.length > 0) {
  console.warn("Warnings:", validation.warnings);
}
```

## Utility Functions

```typescript
// Validate external config
const validation = validateMultiSigConfig(config);

// Calculate total weight
const total = calculateTotalWeight(config);

// Check if signers can meet threshold
const canMeet = canMeetThreshold(["GSIGNER1", "GSIGNER2"], config, 30);
```

## Options

```typescript
new MultiSigBuilder(master, {
  autoValidate: true, // Validate on build (default: true)
  allowDuplicates: false, // Allow duplicate signers (default: false)
  maxSigners: 20, // Max signers allowed (default: 20)
});
```

## Common Patterns

### 2-of-3 Multi-Sig

```typescript
const builder = new MultiSigBuilder(master)
  .addSigner(s1, 1)
  .addSigner(s2, 1)
  .addSigner(s3, 1)
  .setThresholds({ low: 1, medium: 2, high: 2 });
```

### Weighted Governance

```typescript
const builder = new MultiSigBuilder(master)
  .addSigner(founder, 50)
  .addSigner(coreTeam1, 25)
  .addSigner(coreTeam2, 25)
  .setThresholds({ low: 25, medium: 50, high: 75 });
```

### Corporate Treasury

```typescript
const builder = new MultiSigBuilder(master)
  .addSigner(treasurer, 40)
  .addSigner(finance1, 20)
  .addSigner(finance2, 20)
  .setThresholds({ low: 20, medium: 40, high: 60 });
```

## Validation Rules

| Rule                     | Description                      |
| ------------------------ | -------------------------------- |
| Weight Range             | 0-255                            |
| Threshold Range          | 0-255                            |
| Threshold ≤ Total Weight | Threshold must be achievable     |
| No Duplicates            | By default, no duplicate signers |
| Max Signers              | Default limit of 20 signers      |
| Master Account           | Required and non-empty           |

## Fee Estimation

```typescript
const result = builder.build();
console.log("Fee:", result.estimatedFee, "stroops");

// Formula: BASE_FEE (100) × (1 + number_of_signers)
```

## Error Handling

```typescript
try {
  const result = builder.build();
} catch (error) {
  console.error("Invalid configuration:", error.message);
}
```

## Type Definitions

```typescript
interface MultiSigConfig {
  masterAccount: string;
  signers: Signer[];
  thresholds: ThresholdConfig;
}

interface Signer {
  address: string;
  weight: number;
}

interface ThresholdConfig {
  low: number;
  medium: number;
  high: number;
}

interface MultiSigBuildResult {
  config: MultiSigConfig;
  validation: MultiSigValidationResult;
  estimatedFee?: number;
}
```

## Examples

See [multiSigExample.ts](../examples/multiSigExample.ts) for complete examples.

## Documentation

See [MULTI_SIG.md](./MULTI_SIG.md) for comprehensive documentation.

## Support

- GitHub: [github.com/gear5labs/chenpilot](https://github.com/gear5labs/chenpilot)
- Issues: [github.com/gear5labs/chenpilot/issues](https://github.com/gear5labs/chenpilot/issues)
