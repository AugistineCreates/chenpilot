/**
 * Asset Intelligence Layer - Public API
 * Main entry point for the Asset Intelligence Layer
 */

export { AssetIntelligence } from './core/AssetIntelligence';
export { AssetCache } from './core/AssetCache';
export { CacheInvalidator } from './core/CacheInvalidator';
export * from './core/types';

export { TrustScorer } from './trust/TrustScorer';
export { TrustSignals } from './trust/TrustSignals';
export { TrustRegistry } from './trust/TrustRegistry';

export { MemoryCache } from './cache/MemoryCache';
export { PersistentCache } from './cache/PersistentCache';
export { CacheKey } from './cache/CacheKey';
export { CachePolicy, EvictionPolicy } from './cache/CachePolicy';

export { AssetValidator } from './compatibility/AssetValidator';
export { NetworkCompatibility } from './compatibility/NetworkCompatibility';
export { VersionCompatibility } from './compatibility/VersionCompatibility';

export { AssetCacheAdapter, MetadataManagerAdapter, createMigrationAdapters, MIGRATION_GUIDE } from './MigrationAdapter';
