# Asset Intelligence Layer Architecture

## Overview

The Asset Intelligence Layer unifies metadata fetching, caching, invalidation, trust signals, and compatibility behavior into a stable module that both SDK and backend can depend on.

## Architecture Goals

1. **Unified Interface**: Single entry point for all asset-related operations
2. **Intelligent Caching**: Multi-layer caching with automatic invalidation
3. **Trust Signals**: Centralized trust scoring and verification
4. **Compatibility**: Consistent behavior across SDK and backend
5. **Extensibility**: Easy to add new data sources and trust providers
6. **Performance**: Optimized for high-throughput operations

## Module Structure

```
packages/sdk/src/assetIntelligence/
├── index.ts                    # Public API entry point
├── core/
│   ├── AssetIntelligence.ts    # Main orchestrator
│   ├── AssetCache.ts           # Unified caching layer
│   ├── CacheInvalidator.ts     # Cache invalidation logic
│   └── types.ts                # Core type definitions
├── providers/
│   ├── MetadataProvider.ts     # Stellar metadata fetching
│   ├── PriceProvider.ts        # Price data fetching
│   ├── TrustProvider.ts        # Trust signal aggregation
│   └── CompatibilityProvider.ts # Compatibility checks
├── trust/
│   ├── TrustScorer.ts          # Trust score calculation
│   ├── TrustSignals.ts         # Individual signal implementations
│   └── TrustRegistry.ts        # Known asset registry
├── cache/
│   ├── MemoryCache.ts          # In-memory cache
│   ├── PersistentCache.ts      # Persistent disk cache
│   ├── CacheKey.ts             # Cache key generation
│   └── CachePolicy.ts          # Cache eviction policies
└── compatibility/
    ├── AssetValidator.ts       # Asset validation logic
    ├── NetworkCompatibility.ts  # Network-specific rules
    └── VersionCompatibility.ts # Version compatibility checks
```

## Core Components

### 1. AssetIntelligence (Main Orchestrator)

The main orchestrator that coordinates all asset intelligence operations.

```typescript
class AssetIntelligence {
  private cache: AssetCache;
  private metadataProvider: MetadataProvider;
  private priceProvider: PriceProvider;
  private trustProvider: TrustProvider;
  private compatibilityProvider: CompatibilityProvider;
  private invalidator: CacheInvalidator;

  async getAssetInfo(asset: Asset): Promise<AssetInfo>;
  async getAssetPrice(asset: Asset): Promise<PriceInfo>;
  async getTrustScore(asset: Asset): Promise<TrustScore>;
  async checkCompatibility(asset: Asset, context: CompatibilityContext): Promise<CompatibilityResult>;
  async invalidateAsset(asset: Asset): Promise<void>;
  async refreshAsset(asset: Asset): Promise<void>;
}
```

### 2. AssetCache (Unified Caching Layer)

Multi-layer caching with automatic invalidation.

```typescript
class AssetCache {
  private memoryCache: MemoryCache;
  private persistentCache: PersistentCache;
  private cachePolicy: CachePolicy;

  async get(key: CacheKey): Promise<AssetData | null>;
  async set(key: CacheKey, data: AssetData, ttl?: number): Promise<void>;
  async invalidate(key: CacheKey): Promise<void>;
  async invalidatePattern(pattern: string): Promise<void>;
  async clear(): Promise<void>;
}
```

**Cache Layers**:
- **L1 Memory Cache**: Fast in-memory cache (LRU eviction)
- **L2 Persistent Cache**: Disk-based cache for persistence
- **L3 Remote Cache**: Optional Redis/memcached for distributed systems

### 3. CacheInvalidator (Cache Invalidation Logic)

Intelligent cache invalidation based on events and time.

```typescript
class CacheInvalidator {
  async invalidateOnEvent(event: AssetEvent): Promise<void>;
  async invalidateOnTime(asset: Asset, maxAge: number): Promise<void>;
  async invalidateOnPriceChange(asset: Asset, threshold: number): Promise<void>;
  async scheduleInvalidation(asset: Asset, time: number): Promise<void>;
}
```

**Invalidation Triggers**:
- Time-based (TTL expiration)
- Event-based (asset updates, configuration changes)
- Price-based (significant price movements)
- Manual (explicit invalidation requests)

### 4. TrustProvider (Trust Signal Aggregation)

Aggregates trust signals from multiple sources.

```typescript
class TrustProvider {
  private trustScorer: TrustScorer;
  private trustRegistry: TrustRegistry;

  async getTrustScore(asset: Asset): Promise<TrustScore>;
  async getTrustSignals(asset: Asset): Promise<TrustSignal[]>;
  async verifyAsset(asset: Asset): Promise<VerificationResult>;
}
```

**Trust Signals**:
- Domain verification
- Issuer reputation
- Asset age
- Trading volume
- Community verification
- Blacklist status

### 5. CompatibilityProvider (Compatibility Checks)

Ensures asset compatibility with operations and networks.

```typescript
class CompatibilityProvider {
  async checkNetworkCompatibility(asset: Asset, network: Network): Promise<CompatibilityResult>;
  async checkOperationCompatibility(asset: Asset, operation: Operation): Promise<CompatibilityResult>;
  async checkVersionCompatibility(asset: Asset, version: string): Promise<CompatibilityResult>;
}
```

## Data Flow

### Get Asset Info Flow

```
Request → AssetIntelligence.getAssetInfo()
         ↓
    Check Cache (L1 → L2 → L3)
         ↓
    Cache Hit? → Return cached data
         ↓
    Cache Miss → Fetch from MetadataProvider
         ↓
    Fetch Trust Signals from TrustProvider
         ↓
    Check Compatibility from CompatibilityProvider
         ↓
    Store in Cache (all layers)
         ↓
    Return aggregated data
```

### Cache Invalidation Flow

```
Event → CacheInvalidator.invalidateOnEvent()
       ↓
   Determine affected assets
       ↓
   Generate cache keys
       ↓
   Invalidate in all cache layers
       ↓
   Emit invalidation event
       ↓
   Trigger refresh if needed
```

## Type Definitions

### Core Types

```typescript
interface Asset {
  code: string;
  issuer?: string;
  network: Network;
}

interface AssetInfo {
  asset: Asset;
  metadata: AssetMetadata;
  price: PriceInfo | null;
  trust: TrustScore;
  compatibility: CompatibilityMap;
  lastUpdated: number;
  cacheKey: string;
}

interface AssetMetadata {
  name?: string;
  description?: string;
  image?: string;
  homeDomain?: string;
  decimals?: number;
  isAuthRequired?: boolean;
  authRevoked?: boolean;
}

interface PriceInfo {
  price: number;
  priceChange24h?: number;
  volume24h?: number;
  lastTrade?: number;
  source: string;
}

interface TrustScore {
  overall: number; // 0-100
  signals: TrustSignal[];
  verificationStatus: 'verified' | 'unverified' | 'malicious';
  lastUpdated: number;
}

interface TrustSignal {
  type: string;
  value: number;
  weight: number;
  description: string;
  source: string;
}

interface CompatibilityResult {
  compatible: boolean;
  reasons: string[];
  warnings: string[];
}

interface CompatibilityContext {
  network: Network;
  operation?: Operation;
  version?: string;
}
```

## Configuration

### AssetIntelligenceConfig

```typescript
interface AssetIntelligenceConfig {
  // Cache configuration
  cache: {
    memory: {
      maxSize: number;
      ttl: number;
    };
    persistent: {
      enabled: boolean;
      path: string;
      ttl: number;
    };
    remote?: {
      enabled: boolean;
      host: string;
      port: number;
      ttl: number;
    };
  };

  // Provider configuration
  providers: {
    metadata: {
      horizonUrl: string;
      tomlUrl?: string;
    };
    price: {
      sources: PriceSource[];
      updateInterval: number;
    };
    trust: {
      sources: TrustSource[];
      weights: Record<string, number>;
    };
  };

  // Invalidation configuration
  invalidation: {
    priceChangeThreshold: number; // basis points
    maxAge: number; // milliseconds
    eventDriven: boolean;
  };

  // Compatibility configuration
  compatibility: {
    strictMode: boolean;
    allowedNetworks: Network[];
    blockedIssuers: string[];
  };
}
```

## Provider Implementations

### MetadataProvider

Fetches asset metadata from Stellar Horizon and TOML files.

```typescript
class MetadataProvider {
  async getMetadata(asset: Asset): Promise<AssetMetadata>;
  async getMetadataFromHorizon(asset: Asset): Promise<AssetMetadata>;
  async getMetadataFromTOML(asset: Asset): Promise<AssetMetadata>;
  private parseTOML(tomlContent: string): AssetMetadata;
}
```

### PriceProvider

Fetches price data from multiple sources with fallback.

```typescript
class PriceProvider {
  private sources: PriceSource[];

  async getPrice(asset: Asset): Promise<PriceInfo>;
  async getPrices(assets: Asset[]): Promise<Map<Asset, PriceInfo>>;
  private fetchFromSource(source: PriceSource, asset: Asset): Promise<PriceInfo>;
  private aggregatePrices(prices: PriceInfo[]): PriceInfo;
}
```

### TrustProvider

Aggregates trust signals from multiple sources.

```typescript
class TrustProvider {
  private trustScorer: TrustScorer;
  private trustRegistry: TrustRegistry;

  async getTrustScore(asset: Asset): Promise<TrustScore>;
  async getTrustSignals(asset: Asset): Promise<TrustSignal[]>;
  async verifyAsset(asset: Asset): Promise<VerificationResult>;
}
```

### CompatibilityProvider

Checks asset compatibility with operations and networks.

```typescript
class CompatibilityProvider {
  async checkNetworkCompatibility(asset: Asset, network: Network): Promise<CompatibilityResult>;
  async checkOperationCompatibility(asset: Asset, operation: Operation): Promise<CompatibilityResult>;
  async checkVersionCompatibility(asset: Asset, version: string): Promise<CompatibilityResult>;
}
```

## Cache Key Generation

### CacheKey

```typescript
class CacheKey {
  static forGeneral(asset: Asset): string;
  static forMetadata(asset: Asset): string;
  static forPrice(asset: Asset): string;
  static forTrust(asset: Asset): string;
  static forCompatibility(asset: Asset, context: CompatibilityContext): string;

  private static normalizeAsset(asset: Asset): string;
  private static hash(key: string): string;
}
```

**Key Format**: `asset:{network}:{code}:{issuer}:{type}:{context}`

## Cache Eviction Policies

### CachePolicy

```typescript
class CachePolicy {
  private policy: EvictionPolicy;

  shouldEvict(entry: CacheEntry): boolean;
  getTTL(entry: CacheEntry): number;
  getPriority(entry: CacheEntry): number;
}

type EvictionPolicy = 'lru' | 'lfu' | 'fifo' | 'ttl';
```

**Eviction Strategies**:
- **LRU (Least Recently Used)**: Evict least recently accessed items
- **LFU (Least Frequently Used)**: Evict least frequently accessed items
- **FIFO (First In First Out)**: Evict oldest items
- **TTL (Time To Live)**: Evict expired items

## Event System

### AssetEvent

```typescript
type AssetEvent =
  | { type: 'price_change'; asset: Asset; change: number }
  | { type: 'metadata_update'; asset: Asset }
  | { type: 'trust_change'; asset: Asset; score: number }
  | { type: 'compatibility_change'; asset: Asset }
  | { type: 'manual_invalidation'; asset: Asset };
```

### EventBus

```typescript
class EventBus {
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
  emit(event: AssetEvent): void;
}
```

## Error Handling

### AssetIntelligenceError

```typescript
class AssetIntelligenceError extends Error {
  code: ErrorCode;
  asset?: Asset;
  context?: Record<string, any>;
}

type ErrorCode =
  | 'ASSET_NOT_FOUND'
  | 'METADATA_UNAVAILABLE'
  | 'PRICE_UNAVAILABLE'
  | 'TRUST_CHECK_FAILED'
  | 'COMPATIBILITY_CHECK_FAILED'
  | 'CACHE_ERROR'
  | 'PROVIDER_ERROR';
```

## Performance Optimization

### Batching

```typescript
class AssetIntelligence {
  async getAssetInfos(assets: Asset[]): Promise<Map<Asset, AssetInfo>>;
  async getAssetPrices(assets: Asset[]): Promise<Map<Asset, PriceInfo>>;
  async getTrustScores(assets: Asset[]): Promise<Map<Asset, TrustScore>>;
}
```

### Parallel Fetching

```typescript
class AssetIntelligence {
  private async fetchAssetData(asset: Asset): Promise<AssetData> {
    const [metadata, price, trust] = await Promise.all([
      this.metadataProvider.getMetadata(asset),
      this.priceProvider.getPrice(asset),
      this.trustProvider.getTrustScore(asset),
    ]);

    return { metadata, price, trust };
  }
}
```

### Prefetching

```typescript
class AssetIntelligence {
  async prefetchAssets(assets: Asset[]): Promise<void>;
  async prefetchPopularAssets(): Promise<void>;
}
```

## Migration Strategy

### Phase 1: New Layer Implementation
- Implement core asset intelligence layer
- Add provider implementations
- Add caching layer
- Add trust signals
- Add compatibility checks

### Phase 2: SDK Migration
- Update SDK to use new layer
- Maintain backward compatibility with old API
- Add deprecation warnings
- Update documentation

### Phase 3: Backend Migration
- Update backend to use new layer
- Replace existing metadata/asset cache
- Update API endpoints
- Add monitoring

### Phase 4: Cleanup
- Remove old implementation
- Remove deprecation warnings
- Finalize documentation

## Testing

### Unit Tests
- Test each component in isolation
- Mock external dependencies
- Test error handling

### Integration Tests
- Test component interactions
- Test with real providers
- Test cache invalidation

### Performance Tests
- Test cache hit rates
- Test batch operations
- Test concurrent access

## Monitoring

### Metrics
- Cache hit/miss rates
- Provider response times
- Error rates
- Invalidation frequency

### Logging
- Cache operations
- Provider calls
- Invalidation events
- Errors

## Security Considerations

1. **Data Validation**: Validate all external data
2. **Cache Poisoning**: Protect against cache poisoning attacks
3. **Rate Limiting**: Rate limit provider calls
4. **Input Sanitization**: Sanitize all user inputs
5. **Secret Management**: Securely store API keys

## Future Enhancements

1. **Machine Learning**: Use ML for trust scoring
2. **Decentralized Metadata**: Use decentralized metadata sources
3. **Real-time Updates**: WebSocket support for real-time updates
4. **Multi-chain Support**: Support for non-Stellar assets
5. **User Preferences**: Personalized trust scores
