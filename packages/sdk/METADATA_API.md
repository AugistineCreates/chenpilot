# Stellar Metadata API

A simplified SDK API for storing and retrieving arbitrary key-value metadata on Stellar accounts.

## Overview

The Stellar Metadata Manager provides a clean, type-safe interface for persisting arbitrary key-value data on any Stellar account. This is useful for:

- **User Profiles**: Store profile information, preferences, and settings
- **KYC/AML Data**: Maintain verification status and compliance information
- **Application State**: Store configuration, feature flags, and application data
- **Session Management**: Store session tokens and temporary data with expiration
- **Audit Logs**: Track metadata changes on an account

## Features

- ✅ **Simple Key-Value Storage**: Get and set metadata with minimal API
- ✅ **Automatic Expiration**: Support for time-based metadata expiration
- ✅ **Batch Operations**: Retrieve multiple metadata entries efficiently
- ✅ **Type Safety**: Full TypeScript support with proper interfaces
- ✅ **Caching**: Automatic caching of retrieved metadata for performance
- ✅ **Large Value Support**: Automatically chunks large values (>64 bytes)
- ✅ **Flexible Types**: Support for JSON, strings, and arbitrary values
- ✅ **Testnet/Mainnet**: Works with both Stellar networks

## Installation

No additional installation needed - the metadata API is part of the SDK:

```bash
npm install @chen-pilot/sdk
# or
pnpm add @chen-pilot/sdk
```

## Architecture

The metadata system uses Stellar's `ManageData` operations to store data in account data entries. Each metadata entry is:

1. **Prefixed** with `md:` to avoid conflicts
2. **JSON-encoded** with metadata about the value (type, timestamps, expiration)
3. **Chunked** if larger than 64 bytes (ManageData limit)
4. **Indexed** with chunk count for retrieval and reconstruction

### Data Storage Format

```json
{
  "key": "user-profile",
  "value": "{ 'name': 'Alice', ... }",
  "type": "user-profile",
  "timestamp": 1706789400,
  "expiresAt": 1706875800
}
```

All metadata is base64-encoded when stored in the `data_attr` of Stellar accounts.

## API Reference

### StellarMetadataManager

Main class for all metadata operations.

#### Constructor

```typescript
const manager = new StellarMetadataManager({
  horizonUrl?: string;        // Horizon URL (default: public network)
  networkPassphrase?: string; // Network passphrase
  baseFee?: number;          // Fee in stroops (default: 100)
});
```

#### Methods

##### `prepareSetMetadata(params: MetadataSetParams): Promise<string>`

Prepare a transaction to store metadata on an account.

**Parameters:**

- `accountId`: Stellar account address
- `key`: Metadata key (alphanumeric, underscores, hyphens; max 128 chars)
- `value`: Metadata value (max 4KB)
- `type?`: Optional metadata type/category
- `expiresAt?`: Optional expiration timestamp (unix seconds)

**Returns:** Transaction XDR string (ready for signing and submission)

**Example:**

```typescript
const manager = createMetadataManager();

const txn = await manager.prepareSetMetadata({
  accountId: "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF",
  key: "user-profile",
  value: JSON.stringify({ name: "Alice", email: "alice@example.com" }),
  type: "user-profile",
});

// Sign and submit txn...
```

##### `getMetadata(params: MetadataGetParams): Promise<MetadataEntry | null>`

Retrieve metadata for an account.

**Parameters:**

- `accountId`: Stellar account address
- `key`: Metadata key to retrieve

**Returns:** MetadataEntry or null if not found (or expired)

**Example:**

```typescript
const metadata = await manager.getMetadata({
  accountId: "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF",
  key: "user-profile",
});

if (metadata) {
  console.log(`Value: ${metadata.value}`);
  console.log(`Type: ${metadata.type}`);
  console.log(`Created: ${new Date(metadata.createdAt * 1000).toISOString()}`);
}
```

##### `listMetadata(accountId: string): Promise<MetadataListResponse>`

List all metadata entries for an account.

**Parameters:**

- `accountId`: Stellar account address

**Returns:** MetadataListResponse with all non-expired entries

**Example:**

```typescript
const response = await manager.listMetadata(accountId);

console.log(`Total entries: ${response.total}`);
response.metadata.forEach((entry) => {
  console.log(`${entry.key}: ${entry.value.substring(0, 50)}`);
});
```

##### `prepareDeleteMetadata(accountId: string, key: string): Promise<string>`

Prepare a transaction to delete metadata from an account.

**Parameters:**

- `accountId`: Stellar account address
- `key`: Metadata key to delete

**Returns:** Transaction XDR string (ready for signing and submission)

**Example:**

```typescript
const txn = await manager.prepareDeleteMetadata(
  "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF",
  "user-profile"
);

// Sign and submit txn...
```

##### `getMetadataBatch(accountId: string, keys: string[]): Promise<Map<string, MetadataEntry | null>>`

Retrieve multiple metadata entries in one operation.

**Parameters:**

- `accountId`: Stellar account address
- `keys`: Array of metadata keys to retrieve

**Returns:** Map of keys to MetadataEntry (or null for missing entries)

**Example:**

```typescript
const results = await manager.getMetadataBatch(accountId, [
  "user-profile",
  "preferences",
  "session-token",
]);

results.forEach((entry, key) => {
  if (entry) {
    console.log(`${key}: ${entry.value}`);
  }
});
```

##### `clearCache(): void`

Clear the internal metadata cache.

**Example:**

```typescript
// After making external changes to account metadata
manager.clearCache();
```

### Types

#### MetadataSetParams

```typescript
interface MetadataSetParams {
  accountId: string; // Stellar account address
  key: string; // Metadata key (alphanumeric, max 128 chars)
  value: string; // Metadata value (max 4KB)
  type?: string; // Optional type/category
  expiresAt?: number; // Optional expiration (unix seconds)
}
```

#### MetadataEntry

```typescript
interface MetadataEntry {
  key: string; // Metadata key
  value: string; // Metadata value
  type?: string; // Optional metadata type
  createdAt: number; // Creation timestamp (unix seconds)
  updatedAt: number; // Last update timestamp (unix seconds)
  expiresAt?: number; // Optional expiration timestamp (unix seconds)
}
```

#### MetadataListResponse

```typescript
interface MetadataListResponse {
  accountId: string; // Account address
  metadata: MetadataEntry[]; // Array of metadata entries
  total: number; // Total entries count
  hasMore: boolean; // Whether more results available
}
```

## Usage Examples

### Store User Profile

```typescript
const manager = createMetadataManager();

// Prepare transaction
const txn = await manager.prepareSetMetadata({
  accountId: userAccount,
  key: "profile",
  value: JSON.stringify({
    name: "Alice Smith",
    email: "alice@example.com",
    joinDate: "2024-01-15",
  }),
  type: "user-profile",
});

// Sign and submit transaction
const signedTxn = await signTransaction(txn, userKeypair);
await horizonServer.submitTransaction(signedTxn);

// Later, retrieve the profile
const profile = await manager.getMetadata({
  accountId: userAccount,
  key: "profile",
});

if (profile) {
  const data = JSON.parse(profile.value);
  console.log(`Welcome back, ${data.name}!`);
}
```

### Store Session with Expiration

```typescript
// Store session token that expires in 24 hours
const expiresAt = Math.floor(Date.now() / 1000) + 86400;

const txn = await manager.prepareSetMetadata({
  accountId: userAccount,
  key: "session",
  value: generateSessionToken(),
  type: "session",
  expiresAt, // Automatically expires in 24 hours
});

// Submit transaction...

// Later, retrieve session
const session = await manager.getMetadata({
  accountId: userAccount,
  key: "session",
});

if (session && session.expiresAt) {
  if (session.expiresAt > Math.floor(Date.now() / 1000)) {
    console.log("Session is still valid");
  } else {
    console.log("Session has expired");
  }
}
```

### Store KYC Verification

```typescript
// Store KYC verification status
const kycData = {
  status: "verified",
  level: "professional",
  provider: "Stripe",
  documentHash: "sha256:...",
};

const validityPeriod = 365 * 24 * 60 * 60; // 1 year
const expiresAt = Math.floor(Date.now() / 1000) + validityPeriod;

const txn = await manager.prepareSetMetadata({
  accountId: userAccount,
  key: "kyc-verification",
  value: JSON.stringify(kycData),
  type: "kyc",
  expiresAt,
});

// Later, check KYC status
const kyc = await manager.getMetadata({
  accountId: userAccount,
  key: "kyc-verification",
});

if (kyc) {
  const data = JSON.parse(kyc.value);
  const isExpired = kyc.expiresAt! < Math.floor(Date.now() / 1000);

  if (!isExpired && data.status === "verified") {
    // Grant access to premium features
  }
}
```

### Multi-Entry Operations

```typescript
// Store multiple metadata entries
const entries = [
  { key: "user-id", value: "123456" },
  { key: "verification-status", value: "verified" },
  { key: "preferences", value: JSON.stringify({ theme: "dark" }) },
];

for (const entry of entries) {
  const txn = await manager.prepareSetMetadata({
    accountId: userAccount,
    ...entry,
    type: "user-data",
  });
  // Submit each transaction...
}

// Later, retrieve all at once
const results = await manager.getMetadataBatch(userAccount, [
  "user-id",
  "verification-status",
  "preferences",
]);

results.forEach((entry, key) => {
  if (entry) {
    console.log(`${key}: ${entry.value}`);
  }
});
```

### List All Metadata

```typescript
const response = await manager.listMetadata(userAccount);

console.log(`This account has ${response.total} metadata entries:\n`);

response.metadata.forEach((entry) => {
  console.log(`Key: ${entry.key}`);
  console.log(`Type: ${entry.type || "generic"}`);
  console.log(`Value: ${entry.value.substring(0, 100)}`);
  console.log(`Created: ${new Date(entry.createdAt * 1000).toISOString()}`);
  if (entry.expiresAt) {
    console.log(`Expires: ${new Date(entry.expiresAt * 1000).toISOString()}`);
  }
  console.log();
});
```

## Performance Considerations

### Caching

The metadata manager automatically caches retrieved entries. This means:

- Repeated `getMetadata()` calls for the same key are instant
- Cache is cleared when `prepareDeleteMetadata()` is called
- Call `clearCache()` if you make external changes to account metadata

### Chunking

Large values (>64 bytes) are automatically chunked for storage:

- Chunks are 64 bytes each and stored separately
- Chunk count is stored for reconstruction
- Retrieval automatically reconstructs chunked data

### Network

- List operations fetch the entire account from Horizon
- Consider pagination if accounts have many metadata entries
- Use batch operations when retrieving multiple entries

## Limitations

1. **Total Storage**: Each ManageData operation stores up to 64 bytes
2. **Value Size**: Maximum 4KB per metadata entry (enforced)
3. **Key Length**: Keys limited to 128 alphanumeric characters
4. **Network Fees**: Each set/delete operation costs 100 stroops base fee
5. **Expiration**: Expiration is checked client-side, not enforced server-side

## Security Considerations

1. **Public Data**: All metadata is stored publicly on the Stellar network
2. **Encryption**: Encrypt sensitive data before storing
3. **Private Keys**: Never store private keys or secrets as metadata
4. **Compliance**: Ensure metadata use complies with regulations (GDPR, etc.)

## Error Handling

```typescript
try {
  const metadata = await manager.getMetadata({
    accountId,
    key: "user-profile",
  });
} catch (error) {
  if (error.message.includes("not found")) {
    console.log("Account not found on network");
  } else if (error.message.includes("Network error")) {
    console.log("Network connection error");
  } else {
    console.log("Unexpected error:", error);
  }
}
```

## Testing

Run the metadata tests:

```bash
npm test -- src/__tests__/metadata.test.ts
```

Test coverage includes:

- ✅ Basic get/set operations
- ✅ Expiration handling
- ✅ Batch operations
- ✅ Error cases
- ✅ Caching behavior
- ✅ Large value chunking
- ✅ Edge cases (special characters, UTF-8, etc.)

## Factory Functions

### createMetadataManager(config?: MetadataManagerConfig)

Creates a new StellarMetadataManager instance:

```typescript
import { createMetadataManager } from "@chen-pilot/sdk";

const manager = createMetadataManager({
  horizonUrl: "https://horizon.stellar.org",
});
```

## Files

- `src/metadata.ts` - Main implementation
- `src/__tests__/metadata.test.ts` - Unit tests
- `examples/metadata.example.ts` - Usage examples
- `src/types/index.ts` - TypeScript type definitions

## Contributing

When extending the metadata API:

1. Maintain backward compatibility
2. Add tests for new functionality
3. Update type definitions in `types/index.ts`
4. Document new features in examples

## Next Steps

Potential enhancements:

- Query API for filtering metadata (e.g., by type)
- Encryption support for sensitive metadata
- Bulk transaction building for multiple entries
- TTL-based automatic cleanup
- Metadata versioning and history
- Event subscriptions for metadata changes
