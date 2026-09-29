/**
 * Cache Eviction Policies
 * Defines cache eviction strategies
 */

import { CacheEntry } from './MemoryCache';

export const EvictionPolicy = {
  LRU: 'lru' as const,
  LFU: 'lfu' as const,
  FIFO: 'fifo' as const,
  TTL: 'ttl' as const,
};
export type EvictionPolicy = (typeof EvictionPolicy)[keyof typeof EvictionPolicy];

export class CachePolicy {
  private policy: EvictionPolicy;

  constructor(policy: EvictionPolicy = 'lru') {
    this.policy = policy;
  }

  /**
   * Determine if entry should be evicted
   */
  shouldEvict(entry: CacheEntry, cacheSize: number, maxSize: number): boolean {
    if (cacheSize < maxSize) {
      return false;
    }

    switch (this.policy) {
      case 'ttl':
        return this.isExpired(entry);
      case 'lru':
        return this.isLeastRecentlyUsed(entry);
      case 'lfu':
        return this.isLeastFrequentlyUsed(entry);
      case 'fifo':
        return this.isOldest(entry);
      default:
        return false;
    }
  }

  /**
   * Get TTL for entry
   */
  getTTL(entry: CacheEntry): number {
    return entry.ttl;
  }

  /**
   * Get priority for entry (higher = more important)
   */
  getPriority(entry: CacheEntry): number {
    switch (this.policy) {
      case 'lru':
        return entry.hits; // More hits = higher priority
      case 'lfu':
        return entry.hits; // More hits = higher priority
      case 'fifo':
        return -entry.timestamp; // Newer = higher priority
      case 'ttl':
        return entry.ttl; // Longer TTL = higher priority
      default:
        return 0;
    }
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    const age = Date.now() - entry.timestamp;
    return age > entry.ttl;
  }

  /**
   * Check if entry is least recently used
   */
  private isLeastRecentlyUsed(entry: CacheEntry): boolean {
    // This would need to be evaluated in context of other entries
    // For now, return false (handled by cache implementation)
    return false;
  }

  /**
   * Check if entry is least frequently used
   */
  private isLeastFrequentlyUsed(entry: CacheEntry): boolean {
    // This would need to be evaluated in context of other entries
    // For now, return false (handled by cache implementation)
    return false;
  }

  /**
   * Check if entry is oldest
   */
  private isOldest(entry: CacheEntry): boolean {
    // This would need to be evaluated in context of other entries
    // For now, return false (handled by cache implementation)
    return false;
  }

  /**
   * Set eviction policy
   */
  setPolicy(policy: EvictionPolicy): void {
    this.policy = policy;
  }

  /**
   * Get current policy
   */
  getPolicy(): EvictionPolicy {
    return this.policy;
  }
}
