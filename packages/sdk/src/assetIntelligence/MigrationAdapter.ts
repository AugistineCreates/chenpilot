/**
 * Migration Adapter
 * Bridges old assetCache and metadata implementations with new Asset Intelligence Layer
 */

import { AssetCache } from './core/AssetCache';
import { Asset, AssetMetadata, AssetIntelligenceConfig } from './core/types';
import { AssetIntelligence } from './core/AssetIntelligence';

// Old AssetInfo interface from assetCache.ts
interface LegacyAssetInfo {
  code: string;
  issuer: string;
  name?: string;
  description?: string;
  image?: string;
  homeDomain?: string;
  lastUpdated: number;
}

// Old StellarMetadataManager interface
interface LegacyMetadataManager {
  prepareSetMetadata(params: any): Promise<string>;
  getMetadata(params: any): Promise<any>;
  listMetadata(accountId: string): Promise<any>;
  prepareDeleteMetadata(accountId: string, key: string): Promise<string>;
  getMetadataBatch(accountId: string, keys: string[]): Promise<Map<string, any>>;
  clearCache(): void;
}

/**
 * Adapter for legacy AssetCache to use new Asset Intelligence Layer
 */
export class AssetCacheAdapter {
  private assetIntelligence: AssetIntelligence;

  constructor(assetIntelligence: AssetIntelligence) {
    this.assetIntelligence = assetIntelligence;
  }

  /**
   * Get asset info (legacy interface)
   */
  async get(asset: any): Promise<LegacyAssetInfo | undefined> {
    const sdkAsset = this.convertToAsset(asset);
    const assetData = await this.assetIntelligence.getAssetInfo(sdkAsset);
    
    if (!assetData) {
      return undefined;
    }

    return this.convertToLegacyInfo(assetData);
  }

  /**
   * Set asset info (legacy interface)
   */
  async set(asset: any, info: LegacyAssetInfo): Promise<void> {
    const sdkAsset = this.convertToAsset(asset);
    await this.assetIntelligence.refreshAsset(sdkAsset);
  }

  /**
   * Fetch and cache asset info (legacy interface)
   */
  async fetchAndCache(asset: any, horizonUrl?: string): Promise<LegacyAssetInfo | null> {
    const sdkAsset = this.convertToAsset(asset);
    const assetData = await this.assetIntelligence.getAssetInfo(sdkAsset);
    
    if (!assetData) {
      return null;
    }

    return this.convertToLegacyInfo(assetData);
  }

  /**
   * Clear cache (legacy interface)
   */
  async clear(): Promise<void> {
    // Asset Intelligence doesn't have a global clear, but we can clear all caches
    // This would be implemented in the main AssetIntelligence class
    console.warn('Global cache clear not recommended in Asset Intelligence Layer');
  }

  /**
   * Convert SDK Asset to legacy format
   */
  private convertToAsset(asset: any): Asset {
    if (asset.isNative && asset.isNative()) {
      return {
        code: 'XLM',
        network: 'public',
      };
    }

    return {
      code: asset.getCode(),
      issuer: asset.getIssuer(),
      network: 'public',
    };
  }

  /**
   * Convert AssetData to legacy AssetInfo
   */
  private convertToLegacyInfo(assetData: any): LegacyAssetInfo {
    return {
      code: assetData.asset.code,
      issuer: assetData.asset.issuer || '',
      name: assetData.metadata?.name,
      description: assetData.metadata?.description,
      image: assetData.metadata?.image,
      homeDomain: assetData.metadata?.homeDomain,
      lastUpdated: assetData.lastUpdated,
    };
  }
}

/**
 * Adapter for legacy StellarMetadataManager to use new Asset Intelligence Layer
 */
export class MetadataManagerAdapter {
  private assetIntelligence: AssetIntelligence;

  constructor(assetIntelligence: AssetIntelligence) {
    this.assetIntelligence = assetIntelligence;
  }

  /**
   * Prepare set metadata (legacy interface)
   * Note: This is a no-op in the new architecture as metadata is fetched, not set
   */
  async prepareSetMetadata(params: any): Promise<string> {
    console.warn('prepareSetMetadata is deprecated in Asset Intelligence Layer');
    throw new Error('prepareSetMetadata is deprecated. Use Asset Intelligence Layer for metadata operations.');
  }

  /**
   * Get metadata (legacy interface)
   */
  async getMetadata(params: any): Promise<any> {
    const asset: Asset = {
      code: 'N/A', // Metadata is account-based, not asset-based
      network: 'public',
    };

    const assetData = await this.assetIntelligence.getAssetInfo(asset);
    
    if (!assetData || !assetData.metadata) {
      return null;
    }

    return {
      key: params.key,
      value: assetData.metadata,
      type: 'generic',
      createdAt: assetData.lastUpdated,
      updatedAt: assetData.lastUpdated,
    };
  }

  /**
   * List metadata (legacy interface)
   */
  async listMetadata(accountId: string): Promise<any> {
    // Asset Intelligence is asset-based, not account-based
    // This would need to be implemented differently or deprecated
    console.warn('listMetadata is deprecated in Asset Intelligence Layer');
    return {
      accountId,
      metadata: [],
      total: 0,
      hasMore: false,
    };
  }

  /**
   * Prepare delete metadata (legacy interface)
   */
  async prepareDeleteMetadata(accountId: string, key: string): Promise<string> {
    console.warn('prepareDeleteMetadata is deprecated in Asset Intelligence Layer');
    throw new Error('prepareDeleteMetadata is deprecated. Use Asset Intelligence Layer for metadata operations.');
  }

  /**
   * Batch get metadata (legacy interface)
   */
  async getMetadataBatch(accountId: string, keys: string[]): Promise<Map<string, any>> {
    const results = new Map<string, any>();
    
    for (const key of keys) {
      const metadata = await this.getMetadata({ accountId, key });
      results.set(key, metadata);
    }

    return results;
  }

  /**
   * Clear cache (legacy interface)
   */
  clearCache(): void {
    console.warn('clearCache is deprecated in Asset Intelligence Layer');
  }
}

/**
 * Factory function to create migration adapters
 */
export function createMigrationAdapters(config: AssetIntelligenceConfig) {
  const assetIntelligence = new AssetIntelligence(config);
  
  return {
    assetCacheAdapter: new AssetCacheAdapter(assetIntelligence),
    metadataManagerAdapter: new MetadataManagerAdapter(assetIntelligence),
    assetIntelligence, // Return the new layer for direct use
  };
}

/**
 * Migration guide for updating existing code
 */
export const MIGRATION_GUIDE = {
  // Old: const cache = new AssetCache();
  // New: const { assetIntelligence } = createMigrationAdapters(config);
  
  // Old: const info = await cache.get(asset);
  // New: const info = await assetIntelligence.getAssetInfo(asset);
  
  // Old: await cache.set(asset, info);
  // New: await assetIntelligence.refreshAsset(asset);
  
  // Old: const metadata = await metadataManager.getMetadata(params);
  // New: const assetData = await assetIntelligence.getAssetInfo(asset);
  
  DEPRECATED_METHODS: [
    'AssetCache.fetchAndCache',
    'StellarMetadataManager.prepareSetMetadata',
    'StellarMetadataManager.prepareDeleteMetadata',
    'StellarMetadataManager.listMetadata',
  ],
  
  RECOMMENDED_REPLACEMENTS: {
    'AssetCache.get': 'AssetIntelligence.getAssetInfo',
    'AssetCache.set': 'AssetIntelligence.refreshAsset',
    'StellarMetadataManager.getMetadata': 'AssetIntelligence.getAssetInfo',
  },
};
