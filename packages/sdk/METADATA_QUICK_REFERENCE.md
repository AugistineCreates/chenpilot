# Stellar Metadata API - Quick Reference

## Basic Usage

### Create Manager

```typescript
import { createMetadataManager } from "@chen-pilot/sdk";

const manager = createMetadataManager({
  horizonUrl: "https://horizon-testnet.stellar.org",
});
```

### Set Metadata

```typescript
const txn = await manager.prepareSetMetadata({
  accountId: "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF",
  key: "user-profile",
  value: JSON.stringify({ name: "Alice" }),
  type: "profile",
  expiresAt: Math.floor(Date.now() / 1000) + 86400, // 24 hours
});

// Sign and submit txn to network
```

### Get Metadata

```typescript
const metadata = await manager.getMetadata({
  accountId: "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF",
  key: "user-profile",
});

if (metadata) {
  console.log(metadata.value); // Stored value
  console.log(metadata.type); // Metadata type
  console.log(metadata.createdAt); // Unix timestamp
  console.log(metadata.expiresAt); // Optional expiration
}
```

### Delete Metadata

```typescript
const txn = await manager.prepareDeleteMetadata(
  "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF",
  "user-profile"
);

// Sign and submit txn to network
```

### List All Metadata

```typescript
const response = await manager.listMetadata(
  "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF"
);

console.log(`Total: ${response.total}`);
response.metadata.forEach((entry) => {
  console.log(`${entry.key}: ${entry.value}`);
});
```

### Batch Retrieve

```typescript
const results = await manager.getMetadataBatch(accountId, [
  "key1",
  "key2",
  "key3",
]);

results.forEach((entry, key) => {
  if (entry) {
    console.log(`${key}: ${entry.value}`);
  }
});
```

## Common Patterns

### Store User Preferences

```typescript
const prefs = {
  theme: "dark",
  language: "en",
  notifications: true,
};

const txn = await manager.prepareSetMetadata({
  accountId,
  key: "preferences",
  value: JSON.stringify(prefs),
  type: "user-preferences",
});
```

### Store Session Token (24hr expiration)

```typescript
const txn = await manager.prepareSetMetadata({
  accountId,
  key: "session",
  value: sessionToken,
  type: "session",
  expiresAt: Math.floor(Date.now() / 1000) + 86400,
});
```

### Store KYC Status (365 day expiration)

```typescript
const txn = await manager.prepareSetMetadata({
  accountId,
  key: "kyc-verification",
  value: JSON.stringify(kycData),
  type: "kyc",
  expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
});
```

### Store Configuration

```typescript
const config = {
  apiVersion: "2.0",
  features: ["feature-a", "feature-b"],
  rateLimit: 100,
};

const txn = await manager.prepareSetMetadata({
  accountId,
  key: "app-config",
  value: JSON.stringify(config),
  type: "config",
});
```

## API Methods

| Method                                  | Purpose                   | Returns                            |
| --------------------------------------- | ------------------------- | ---------------------------------- |
| `prepareSetMetadata(params)`            | Create set transaction    | Transaction XDR                    |
| `getMetadata(params)`                   | Retrieve metadata         | MetadataEntry \| null              |
| `listMetadata(accountId)`               | List all metadata         | MetadataListResponse               |
| `prepareDeleteMetadata(accountId, key)` | Create delete transaction | Transaction XDR                    |
| `getMetadataBatch(accountId, keys)`     | Retrieve multiple         | Map<string, MetadataEntry \| null> |
| `clearCache()`                          | Clear internal cache      | void                               |

## Key Constraints

| Constraint                 | Value                              |
| -------------------------- | ---------------------------------- |
| Max key length             | 128 chars (alphanumeric, `-`, `_`) |
| Max value size             | 4 KB                               |
| Minimum fee                | 100 stroops                        |
| ManageData per-entry limit | 64 bytes (auto-chunked)            |
| Supported networks         | Testnet, Mainnet                   |

## Types

```typescript
// Set parameters
interface MetadataSetParams {
  accountId: string;
  key: string;
  value: string;
  type?: string;
  expiresAt?: number; // unix seconds
}

// Retrieved entry
interface MetadataEntry {
  key: string;
  value: string;
  type?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

// List response
interface MetadataListResponse {
  accountId: string;
  metadata: MetadataEntry[];
  total: number;
  hasMore: boolean;
}
```

## Error Handling

```typescript
try {
  const metadata = await manager.getMetadata({ accountId, key });
} catch (error) {
  if (String(error).includes("not found")) {
    // Account not found
  } else if (String(error).includes("Network error")) {
    // Network error
  } else {
    // Other error
  }
}
```

## Testing

```bash
# Run metadata tests
npm test -- src/__tests__/metadata.test.ts

# Run with coverage
npm test -- src/__tests__/metadata.test.ts --coverage
```

## Manager Configuration

```typescript
interface MetadataManagerConfig {
  horizonUrl?: string; // Default: public network
  networkPassphrase?: string; // Default: public network
  baseFee?: number; // Default: 100 stroops
}
```

## Notes

- All metadata is **public** on the Stellar network
- **Encrypt sensitive data** before storing
- Expiration is checked **client-side only**
- Large values are automatically **chunked** (>64 bytes)
- Retrieved metadata is **automatically cached**
- Call `clearCache()` after external changes

## See Also

- [Full Documentation](./METADATA_API.md)
- [Examples](./examples/metadata.example.ts)
- [Tests](./src/__tests__/metadata.test.ts)
