/**
 * Cache Key Generation
 * Generates consistent cache keys for asset data
 */

import { Asset, CompatibilityContext } from '../core/types';

export class CacheKey {
  /**
   * Generate cache key for general asset data
   */
  static forGeneral(asset: Asset): string {
    return this.generateKey(asset, 'general');
  }

  /**
   * Generate cache key for metadata
   */
  static forMetadata(asset: Asset): string {
    return this.generateKey(asset, 'metadata');
  }

  /**
   * Generate cache key for price data
   */
  static forPrice(asset: Asset): string {
    return this.generateKey(asset, 'price');
  }

  /**
   * Generate cache key for trust data
   */
  static forTrust(asset: Asset): string {
    return this.generateKey(asset, 'trust');
  }

  /**
   * Generate cache key for compatibility data
   */
  static forCompatibility(asset: Asset, context: CompatibilityContext): string {
    const contextStr = this.serializeContext(context);
    return this.generateKey(asset, `compatibility:${contextStr}`);
  }

  /**
   * Generate cache key for specific data type
   */
  static forDataType(asset: Asset, dataType: string): string {
    return this.generateKey(asset, dataType);
  }

  /**
   * Generate cache key with custom suffix
   */
  static withSuffix(asset: Asset, dataType: string, suffix: string): string {
    const baseKey = this.generateKey(asset, dataType);
    return `${baseKey}:${suffix}`;
  }

  /**
   * Generate base cache key for asset
   */
  private static generateKey(asset: Asset, dataType: string): string {
    const normalizedAsset = this.normalizeAsset(asset);
    const key = `asset:${normalizedAsset}:${dataType}`;
    return this.hash(key);
  }

  /**
   * Normalize asset to consistent string representation
   */
  private static normalizeAsset(asset: Asset): string {
    const issuer = asset.issuer || 'native';
    return `${asset.network}:${asset.code}:${issuer}`;
  }

  /**
   * Serialize compatibility context
   */
  private static serializeContext(context: CompatibilityContext): string {
    const parts = [
      context.network,
      context.operation || 'any',
      context.version || 'any',
    ];
    return parts.join(':');
  }

  /**
   * Simple hash function for cache keys
   */
  private static hash(key: string): string {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Parse asset from cache key
   */
  static parseAsset(key: string): Asset | null {
    try {
      const parts = key.split(':');
      if (parts.length < 4 || parts[0] !== 'asset') {
        return null;
      }
      
      // The hashed part makes parsing difficult without storing the mapping
      // This is a simplified version - in practice, you'd maintain a reverse mapping
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract data type from cache key
   */
  static getDataType(key: string): string | null {
    try {
      const parts = key.split(':');
      return parts[parts.length - 1] || null;
    } catch {
      return null;
    }
  }
}
