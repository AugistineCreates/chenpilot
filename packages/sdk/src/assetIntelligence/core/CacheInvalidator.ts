/**
 * Cache Invalidation Logic
 * Intelligent cache invalidation based on events and time
 */

import { AssetCache } from './AssetCache';
import { Asset, AssetEvent } from './types';

export interface InvalidationConfig {
  priceChangeThreshold: number; // basis points
  maxAge: number; // milliseconds
  eventDriven: boolean;
}

export class CacheInvalidator {
  private cache: AssetCache;
  private config: InvalidationConfig;
  private scheduledInvalidations: Map<string, NodeJS.Timeout>;

  constructor(cache: AssetCache, config: InvalidationConfig) {
    this.cache = cache;
    this.config = config;
    this.scheduledInvalidations = new Map();
  }

  /**
   * Invalidate cache based on asset event
   */
  async invalidateOnEvent(event: AssetEvent): Promise<void> {
    switch (event.type) {
      case 'price_change':
        await this.handlePriceChange(event.asset, event.data?.change);
        break;
      case 'metadata_update':
        await this.handleMetadataUpdate(event.asset);
        break;
      case 'trust_change':
        await this.handleTrustChange(event.asset);
        break;
      case 'compatibility_change':
        await this.handleCompatibilityChange(event.asset);
        break;
      case 'manual_invalidation':
        await this.handleManualInvalidation(event.asset);
        break;
    }
  }

  /**
   * Invalidate cache based on time (max age)
   */
  invalidateOnTime(asset: Asset, maxAge?: number): number {
    const age = maxAge || this.config.maxAge;
    const assetKey = this.getAssetKey(asset);
    
    // Cancel any existing scheduled invalidation
    const existingTimeout = this.scheduledInvalidations.get(assetKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.scheduledInvalidations.delete(assetKey);
    }

    // Schedule new invalidation
    const timeout = setTimeout(async () => {
      await this.cache.invalidate(asset);
      this.scheduledInvalidations.delete(assetKey);
    }, age);

    this.scheduledInvalidations.set(assetKey, timeout);
    return age;
  }

  /**
   * Invalidate cache based on price change
   */
  async invalidateOnPriceChange(asset: Asset, threshold?: number): Promise<void> {
    const changeThreshold = threshold || this.config.priceChangeThreshold;
    // This would typically be called with the actual price change
    // For now, we'll invalidate price data
    await this.cache.invalidate(asset, 'price');
  }

  /**
   * Schedule cache invalidation at specific time
   */
  async scheduleInvalidation(asset: Asset, time: number): Promise<void> {
    const now = Date.now();
    const delay = time - now;

    if (delay <= 0) {
      await this.cache.invalidate(asset);
      return;
    }

    const assetKey = this.getAssetKey(asset);
    
    // Cancel any existing scheduled invalidation
    const existingTimeout = this.scheduledInvalidations.get(assetKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(async () => {
      await this.cache.invalidate(asset);
      this.scheduledInvalidations.delete(assetKey);
    }, delay);

    this.scheduledInvalidations.set(assetKey, timeout);
  }

  /**
   * Cancel scheduled invalidation for asset
   */
  cancelScheduledInvalidation(asset: Asset): void {
    const assetKey = this.getAssetKey(asset);
    const timeout = this.scheduledInvalidations.get(assetKey);
    
    if (timeout) {
      clearTimeout(timeout);
      this.scheduledInvalidations.delete(assetKey);
    }
  }

  /**
   * Cancel all scheduled invalidations
   */
  cancelAllScheduledInvalidations(): void {
    for (const timeout of this.scheduledInvalidations.values()) {
      clearTimeout(timeout);
    }
    this.scheduledInvalidations.clear();
  }

  /**
   * Handle price change event
   */
  private async handlePriceChange(asset: Asset, change?: number): Promise<void> {
    const threshold = this.config.priceChangeThreshold;
    
    if (change !== undefined && Math.abs(change) >= threshold) {
      // Significant price change - invalidate all data
      await this.cache.invalidate(asset);
    } else {
      // Small price change - invalidate only price data
      await this.cache.invalidate(asset, 'price');
    }
  }

  /**
   * Handle metadata update event
   */
  private async handleMetadataUpdate(asset: Asset): Promise<void> {
    await this.cache.invalidate(asset, 'metadata');
    // Also invalidate compatibility as it depends on metadata
    await this.cache.invalidate(asset, 'compatibility');
  }

  /**
   * Handle trust change event
   */
  private async handleTrustChange(asset: Asset): Promise<void> {
    await this.cache.invalidate(asset, 'trust');
  }

  /**
   * Handle compatibility change event
   */
  private async handleCompatibilityChange(asset: Asset): Promise<void> {
    await this.cache.invalidate(asset, 'compatibility');
  }

  /**
   * Handle manual invalidation event
   */
  private async handleManualInvalidation(asset: Asset): Promise<void> {
    await this.cache.invalidate(asset);
  }

  /**
   * Get asset key for scheduled invalidations
   */
  private getAssetKey(asset: Asset): string {
    return `${asset.network}:${asset.code}:${asset.issuer || 'native'}`;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.cancelAllScheduledInvalidations();
  }
}
