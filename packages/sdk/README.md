
# Chen Pilot SDK - SignatureProvider System

A comprehensive TypeScript SDK for managing signature providers across multiple blockchain networks including Bitcoin, Stellar, and Starknet.

## Features

- 🔐 **Multi-Chain Support**: Bitcoin, Stellar, and Starknet transaction signing
- 🔌 **Provider Abstraction**: Unified interface for hardware wallets, browser extensions, and mock providers
- 🤝 **Multi-Signature Coordination**: Complex M-of-N signature workflows
- ✅ **Signature Verification**: Cross-chain signature validation utilities
- 🏭 **Provider Factory**: Automatic discovery and creation of signature providers
- 🔄 **Error Recovery**: Intelligent error handling and recovery strategies
- 📊 **Metrics & Health Checks**: Provider monitoring and performance tracking
- 🎯 **Type Safety**: Full TypeScript support with comprehensive type definitions

# Chen Pilot SDK Core

Core SDK for Chen Pilot cross-chain operations with Stellar/Soroban support.

## Features

- **Contract Client**: Stable query, simulation, execution, idempotency, and typed binding surface
- **Simulation Approvals**: First-class fee estimates, auth entries, warnings, and approval checkpoints
- **Network Status Checks**: Monitor Stellar network health, latency, and protocol version
- **Event Subscriptions**: Subscribe to Soroban contract events
- **Recovery Engine**: Handle cross-chain transaction failures and retries
- **Plan Verification**: Verify and validate transaction plans
- **TypeScript Support**: Full type definitions included


## Installation

```bash
npm install @chen-pilot/sdk-core
```

## Quick Start


### Basic Usage

```typescript
import {
  SignatureProviderSDK,
  ProviderType,
  ChainId,
} from "@chen-pilot/sdk-core";

// Initialize the SDK
const sdk = new SignatureProviderSDK({
  enableMetrics: true,
  enableLogging: true,
  autoDiscovery: true,
});

await sdk.initialize();

// Create a provider
const provider = await sdk.createProvider(ProviderType.MOCK);

// Get accounts
const accounts = await provider.getAccounts(ChainId.STELLAR);

// Sign a transaction
const result = await provider.signTransaction({
  transactionData: {
    chainId: ChainId.STELLAR,
    transaction: {
      sourceAccount: accounts[0].address,
      fee: "100",
      sequenceNumber: "1",
      operations: [{ type: "payment", destination: "GTEST", amount: "10" }],
    },
  },
  accountAddress: accounts[0].address,
});

console.log("Signature:", result.signature);
```

### Using the SDK Builder

```typescript
import { createSDKBuilder, ProviderType } from "@chen-pilot/sdk-core";

const sdk = await createSDKBuilder()
  .withDefaultProviders([ProviderType.LEDGER, ProviderType.ALBEDO])
  .withMetrics(true)
  .withErrorRecovery({ enabled: true, maxRetries: 3 })
  .build();

const provider = await sdk.getBestProvider(ChainId.STELLAR);
```

### Convenience Functions

```typescript
import { SDKUtils, ProviderType, ChainId } from "@chen-pilot/sdk-core";

// Quick provider creation
const provider = await SDKUtils.quickCreateProvider(ProviderType.MOCK);

// Get providers for specific chain
const stellarProviders = await SDKUtils.getProvidersForChain(ChainId.STELLAR);

// System health check
const health = await SDKUtils.performSystemHealthCheck();
console.log(
  `${health.healthyProviders}/${health.totalProviders} providers healthy`
);
```

### Contract Client

Use `ContractClient` for external Soroban integrations. It keeps raw RPC payloads
available while returning decoded models and workflow metadata that callers can
present as approvals.

```typescript
import {
  ContractClient,
  createContractBinding,
  decodeObject,
} from "@chen-pilot/sdk-core";

type VaultState = {
  admin: string;
  paused: boolean;
};

const client = new ContractClient({
  network: "testnet",
  compatibility: {
    supportedNetworks: ["testnet"],
    minProtocolVersion: 20,
  },
});

const vault = createContractBinding(client, {
  state: {
    contractId: "CCONTRACT...",
    method: "state",
    kind: "query",
    decoder: decodeObject<VaultState>(["admin", "paused"]),
  },
  previewWithdraw: {
    contractId: "CCONTRACT...",
    method: "withdraw",
    kind: "simulate",
    decoder: (value) => String(value),
  },
} as const);

const state = await vault.state();
const preview = await vault.previewWithdraw("100");

for (const approval of preview.approvalRequirements) {
  console.log(approval.checkpoint, approval.reason);
}
```

Submit signed transactions with idempotency:

```typescript
const execution = await client.execute({
  contractId: "CCONTRACT...",
  method: "withdraw",
  signedTransactionXdr: signedEnvelope,
  idempotencyKey: "withdraw:user-123:request-456",
});

console.log(execution.status, execution.hash);
```

## Provider Types

### Mock Provider (Testing)

```typescript
import { MockSignatureProvider, ProviderType } from "@chen-pilot/sdk-core";

const mockProvider = await sdk.createProvider(ProviderType.MOCK, {
  enableLogging: true,
  signingDelay: 1000, // Simulate signing delay
  shouldFailSigning: false, // Control failure behavior
});
```

### Ledger Hardware Wallet

```typescript
import { LedgerSignatureProvider, ProviderType } from "@chen-pilot/sdk-core";

const ledgerProvider = await sdk.createProvider(ProviderType.LEDGER, {
  connectionTimeout: 10000,
  autoOpenApps: true,
  enableDebugLogging: true,
});

// Check if specific app is open
const isAppOpen = await ledgerProvider.isAppOpen(ChainId.BITCOIN);
```

### Albedo Browser Extension (Stellar)

```typescript
import { AlbedoSignatureProvider, ProviderType } from "@chen-pilot/sdk-core";

const albedoProvider = await sdk.createProvider(ProviderType.ALBEDO, {
  network: "mainnet",
  enableDebugLogging: true,
});

// Simplified payment interface
const paymentResult = await albedoProvider.pay({
  destination: "GDEST...",
  amount: "100",
  memo: "Payment memo",
});
```

## Multi-Signature Workflows

```typescript
import {
  MultiSignatureCoordinator,
  SignerInfo,
  MultiSignatureConfig,
} from "@chen-pilot/sdk-core";

const coordinator = new MultiSignatureCoordinator();

// Register providers
coordinator.registerProvider(provider1);
coordinator.registerProvider(provider2);
coordinator.registerProvider(provider3);

// Setup signers
const signers: SignerInfo[] = [
  {
    providerId: "provider-1",
    accountAddress: "GACCOUNT1...",
    required: true,
  },
  {
    providerId: "provider-2",
    accountAddress: "GACCOUNT2...",
    required: true,
  },
  {
    providerId: "provider-3",
    accountAddress: "GACCOUNT3...",
    required: false,
  },
];

const config: MultiSignatureConfig = {
  requiredSignatures: 2,
  totalSigners: 3,
  allowPartialSigning: true,
};

// Execute multi-signature workflow
const result = await coordinator.startWorkflow(
  transactionData,
  signers,
  config
);

console.log(
  `Workflow ${result.status}: ${result.signatures.length} signatures collected`
);
```

## Signature Verification

```typescript
import {
  SignatureVerificationUtils,
  SignatureVerificationRequest,
} from "@chen-pilot/sdk-core";

// Verify single signature
const verificationRequest: SignatureVerificationRequest = {
  signature: "signature_hex",
  publicKey: "public_key_hex",
  transactionData: { chainId: ChainId.STELLAR, transaction },
  chainId: ChainId.STELLAR,
};

const verification =
  await SignatureVerificationUtils.verifySignature(verificationRequest);
console.log("Signature valid:", verification.isValid);

// Verify multi-signature
const multiSigResult = await SignatureVerificationUtils.verifyMultiSignature(
  signatures,
  transactionData,
  ChainId.STELLAR,
  2 // threshold
);

console.log("Multi-sig valid:", multiSigResult.thresholdMet);
```

## Error Handling and Recovery

```typescript
import {
  signatureProviderErrorRecovery,
  ErrorRecoveryContext,
} from "@chen-pilot/sdk-core";

try {
  await provider.signTransaction(request);
} catch (error) {
  // Get recovery instructions
  const instructions =
    signatureProviderErrorRecovery.getRecoveryInstructions(error);
  console.log("Recovery instructions:", instructions);

  // Attempt recovery
  const recoveryContext: ErrorRecoveryContext = {
    providerId: provider.providerId,
    chainId: ChainId.STELLAR,
    retryCount: 0,
    maxRetries: 3,
  };

  const recoveryResult = await signatureProviderErrorRecovery.recover(
    error,
    recoveryContext
  );

  if (recoveryResult.shouldRetry) {
    console.log(`Retry after ${recoveryResult.retryAfterMs}ms`);
  }
}
```

## Provider Discovery and Selection

```typescript
import { SignatureProviderFactory, ProviderType } from "@chen-pilot/sdk-core";

const factory = new SignatureProviderFactory();

// Discover available providers
const discoveries = await factory.discoverProviders();
console.log(
  "Available providers:",
  discoveries.filter((d) => d.available)
);

// Get providers for specific chain
const bitcoinProviders = await factory.createProvidersForChain(ChainId.BITCOIN);

// Get best provider with preferences
const bestProvider = await factory.getBestProviderForChain(ChainId.STELLAR, {
  preferHardwareWallet: true,
  preferBrowserExtension: false,
});
```

## Monitoring and Metrics

```typescript
// Get provider health status
const healthChecks = await sdk.performHealthChecks();
healthChecks.forEach((check) => {
  console.log(
    `${check.providerId}: ${check.healthy ? "Healthy" : "Unhealthy"}`
  );
});

// Get provider metrics
const metrics = sdk.getProviderMetrics();
metrics.forEach((metric) => {
  console.log(
    `${metric.providerId}: ${metric.signatureCount} signatures, ${metric.errorCount} errors`
  );
});

// System-wide metrics
const systemMetrics = SDKUtils.getSystemMetrics();
console.log(
  `System: ${systemMetrics.totalProviders} providers, ${systemMetrics.totalSignatures} signatures`
);
```

## Type Safety Features

### Type Guards

```typescript
import { TypeGuards } from "@chen-pilot/sdk-core";

if (TypeGuards.isSignatureProvider(obj)) {
  // obj is now typed as SignatureProvider
  const capabilities = obj.getCapabilities();
}

if (TypeGuards.isSignatureResult(result)) {
  // result is now typed as SignatureResult
  console.log("Signature:", result.signature);
}
```

### Branded Types

```typescript
import { BrandedTypes, ProviderId, TransactionId } from "@chen-pilot/sdk-core";

const providerId: ProviderId = BrandedTypes.createProviderId("my-provider");
const transactionId: TransactionId = BrandedTypes.createTransactionId("tx-123");
```

### Chain-Specific Types

```typescript
import { ChainSpecificTransaction, ChainId } from "@chen-pilot/sdk-core";

// Type-safe transaction for specific chain
const stellarTx: ChainSpecificTransaction<ChainId.STELLAR> = {
  sourceAccount: "GACCOUNT...",
  fee: "100",
  sequenceNumber: "1",
  operations: [{ type: "payment" }],
};
```

## Configuration

### SDK Configuration

```typescript
interface SignatureProviderSDKConfig {
  defaultProviders?: ProviderType[];
  autoDiscovery?: boolean;
  enableMetrics?: boolean;
  enableLogging?: boolean;
  errorRecovery?: {
    enabled: boolean;
    maxRetries: number;
    retryDelay: number;
  };
  registry?: {
    autoRegister: boolean;
    validateProviders: boolean;
  };
}
```

### Provider-Specific Configuration

```typescript
// Mock Provider Config
interface MockProviderConfig {
  connectionDelay?: number;
  signingDelay?: number;
  shouldFailConnection?: boolean;
  shouldFailSigning?: boolean;
  rejectionRate?: number;
  enableLogging?: boolean;
}

// Ledger Provider Config
interface LedgerProviderConfig {
  connectionTimeout?: number;
  autoOpenApps?: boolean;
  defaultDerivationPaths?: Partial<Record<ChainId, string>>;
  enableDebugLogging?: boolean;
}

// Albedo Provider Config
interface AlbedoProviderConfig {
  network?: "testnet" | "mainnet";
  connectionTimeout?: number;
  enableDebugLogging?: boolean;
}
```

## Best Practices

### 1. Always Initialize the SDK

```typescript
const sdk = new SignatureProviderSDK();
await sdk.initialize(); // Always call before using
```

### 2. Handle Errors Gracefully

```typescript
try {
  const result = await provider.signTransaction(request);
} catch (error) {
  const instructions =
    signatureProviderErrorRecovery.getRecoveryInstructions(error);
  // Show instructions to user
}
```

### 3. Use Type Guards for Runtime Safety

```typescript
if (TypeGuards.isSignatureProvider(provider)) {
  // Safe to use provider methods
}
```

### 4. Dispose Resources

```typescript
// Always dispose when done
await sdk.dispose();
```

### 5. Use Provider Selection

```typescript
// Let the SDK choose the best provider
const provider = await sdk.getBestProvider(ChainId.STELLAR);
```

## API Reference

For complete API documentation, see the TypeScript definitions included with the package. All interfaces, types, and classes are fully documented with JSDoc comments.

## Examples

See the `examples/` directory for complete working examples:

- Basic provider usage
- Multi-signature workflows
- Error handling patterns
- Provider discovery and selection
- Signature verification
- SDK integration patterns

## Contributing

Please read our contributing guidelines and ensure all TypeScript code passes type checking:

```bash
npm run build  # Compiles TypeScript and generates .d.ts files
npm run test   # Runs test suite
```

## License

ISC License - see LICENSE file for details.

### Network Status

Check Stellar network health and status:

```typescript
import { getNetworkStatus } from "@chen-pilot/sdk-core";

const status = await getNetworkStatus({ network: "testnet" });

console.log("Network healthy:", status.health.isHealthy);
console.log("Latest ledger:", status.health.latestLedger);
console.log("Protocol version:", status.protocol.version);
```

See [NETWORK_STATUS.md](./NETWORK_STATUS.md) for complete documentation.

### Event Subscriptions

Subscribe to Soroban contract events:

```typescript
import { subscribeToEvents } from "@chen-pilot/sdk-core";

const subscription = await subscribeToEvents({
  network: "testnet",
  contractIds: ["CABC1234567890"],
  topicFilter: ["transfer"],
});

subscription.on("event", (event) => {
  console.log("Event received:", event);
});

subscription.on("error", (error) => {
  console.error("Subscription error:", error);
});
```

### Recovery Engine

Handle cross-chain transaction failures:

```typescript
import { RecoveryEngine } from "@chen-pilot/sdk-core";

const engine = new RecoveryEngine({
  maxRetries: 3,
  retryDelayMs: 5000,
});

const result = await engine.recover(context);
```

## API Documentation

### Network Status

- `checkNetworkHealth(config)` - Check if network is reachable
- `checkLedgerLatency(config)` - Check ledger latency
- `getProtocolVersion(config)` - Get protocol version
- `getNetworkStatus(config)` - Get complete network status

See [NETWORK_STATUS.md](./NETWORK_STATUS.md) for details.

### Event Subscriptions

- `subscribeToEvents(config)` - Subscribe to contract events
- `SorobanEventSubscription` - Event subscription class

### Recovery

- `RecoveryEngine` - Cross-chain recovery engine
- `RecoveryAction` - Recovery action types
- `RecoveryContext` - Recovery context interface

## Examples

Check the `examples/` directory for complete usage examples:

- `networkStatus.example.ts` - Network status monitoring
- More examples coming soon

## Testing

Run the test suite:

```bash
npm test
```

Run with coverage:

```bash
npm run test:coverage
```

## Development

Build the SDK:

```bash
npm run build
```

## TypeScript

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  NetworkStatus,
  NetworkHealth,
  LedgerLatency,
  ProtocolVersion,
  SorobanEvent,
  EventSubscription,
  RecoveryContext,
  RecoveryResult,
} from "@chen-pilot/sdk-core";
```

## License

ISC

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.

