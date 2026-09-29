/**
 * Trust Registry
 * Known asset registry for trust verification
 */

import { Asset } from '../core/types';

export interface RegistryEntry {
  asset: Asset;
  verified: boolean;
  trustLevel: 'high' | 'medium' | 'low';
  addedAt: number;
  lastUpdated: number;
  metadata?: {
    domain?: string;
    issuer?: string;
    notes?: string;
  };
}

export class TrustRegistry {
  private registry: Map<string, RegistryEntry>;

  constructor() {
    this.registry = new Map();
    this.initializeKnownAssets();
  }

  /**
   * Initialize registry with known trusted assets
   */
  private initializeKnownAssets(): void {
    // Add known stablecoins
    this.addEntry({
      asset: { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOPQVRZPQMVW6YDLRHEDGQYV2QJ7XFADK3K', network: 'public' },
      verified: true,
      trustLevel: 'high',
      addedAt: Date.now(),
      lastUpdated: Date.now(),
      metadata: { domain: 'circle.com' },
    });

    this.addEntry({
      asset: { code: 'USDT', issuer: 'GAP5LETOV6YIE62YAM56STDANPRVO7RA3NS7ATKCNQJUVQQ3EMBQV4A', network: 'public' },
      verified: true,
      trustLevel: 'high',
      addedAt: Date.now(),
      lastUpdated: Date.now(),
      metadata: { domain: 'tether.to' },
    });

    // Add known DEX tokens
    this.addEntry({
      asset: { code: 'XLM', issuer: undefined, network: 'public' },
      verified: true,
      trustLevel: 'high',
      addedAt: Date.now(),
      lastUpdated: Date.now(),
    });
  }

  /**
   * Add entry to registry
   */
  addEntry(entry: RegistryEntry): void {
    const key = this.getAssetKey(entry.asset);
    this.registry.set(key, entry);
  }

  /**
   * Remove entry from registry
   */
  removeEntry(asset: Asset): void {
    const key = this.getAssetKey(asset);
    this.registry.delete(key);
  }

  /**
   * Check if asset is in registry
   */
  contains(asset: Asset): boolean {
    const key = this.getAssetKey(asset);
    return this.registry.has(key);
  }

  /**
   * Get registry entry for asset
   */
  getEntry(asset: Asset): RegistryEntry | undefined {
    const key = this.getAssetKey(asset);
    return this.registry.get(key);
  }

  /**
   * Get all verified assets
   */
  getVerifiedAssets(): RegistryEntry[] {
    return Array.from(this.registry.values()).filter(entry => entry.verified);
  }

  /**
   * Get all assets by trust level
   */
  getByTrustLevel(trustLevel: 'high' | 'medium' | 'low'): RegistryEntry[] {
    return Array.from(this.registry.values()).filter(entry => entry.trustLevel === trustLevel);
  }

  /**
   * Update entry
   */
  updateEntry(asset: Asset, updates: Partial<RegistryEntry>): void {
    const key = this.getAssetKey(asset);
    const existing = this.registry.get(key);
    
    if (existing) {
      this.registry.set(key, {
        ...existing,
        ...updates,
        lastUpdated: Date.now(),
      });
    }
  }

  /**
   * Get asset key for registry
   */
  private getAssetKey(asset: Asset): string {
    return `${asset.network}:${asset.code}:${asset.issuer || 'native'}`;
  }

  /**
   * Get registry size
   */
  size(): number {
    return this.registry.size;
  }

  /**
   * Clear registry
   */
  clear(): void {
    this.registry.clear();
  }
}
