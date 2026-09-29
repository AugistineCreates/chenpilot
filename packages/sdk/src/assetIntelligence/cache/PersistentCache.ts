/**
 * Persistent Cache
 * Disk-based cache for persistence across restarts
 */

import { CacheEntry, CacheStats } from './MemoryCache.js';

// Node.js filesystem and path modules
declare const fs: {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  readFileSync: (path: string, encoding: string) => string;
  writeFileSync: (path: string, data: string, encoding: string) => void;
  unlinkSync: (path: string) => void;
  readdirSync: (path: string) => string[];
};

declare const path: {
  join: (...parts: string[]) => string;
};

export class PersistentCache {
  private cacheDir: string;
  private defaultTTL: number;
  private stats: CacheStats;

  constructor(cachePath: string, defaultTTL: number) {
    this.cacheDir = cachePath;
    this.defaultTTL = defaultTTL;
    this.stats = { size: 0, hits: 0, misses: 0 };
    
    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Get entry from persistent cache
   */
  async get(key: string): Promise<CacheEntry | null> {
    try {
      const filePath = this.getFilePath(key);
      
      if (!fs.existsSync(filePath)) {
        this.stats.misses++;
        return null;
      }

      const data = fs.readFileSync(filePath, 'utf8');
      const entry: CacheEntry = JSON.parse(data);

      if (this.isExpired(entry)) {
        fs.unlinkSync(filePath);
        this.updateSize();
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      return entry;
    } catch (error) {
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set entry in persistent cache
   */
  async set(key: string, entry: CacheEntry): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      const data = JSON.stringify(entry);
      fs.writeFileSync(filePath, data, 'utf8');
      this.updateSize();
    } catch (error) {
      console.error('Failed to write to persistent cache:', error);
    }
  }

  /**
   * Delete entry from persistent cache
   */
  async delete(key: string): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.updateSize();
      }
    } catch (error) {
      console.error('Failed to delete from persistent cache:', error);
    }
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    try {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        fs.unlinkSync(filePath);
      }
      this.stats.size = 0;
      this.stats.hits = 0;
      this.stats.misses = 0;
    } catch (error) {
      console.error('Failed to clear persistent cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    this.updateSize();
    return { ...this.stats };
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    const age = Date.now() - entry.timestamp;
    return age > entry.ttl;
  }

  /**
   * Get file path for cache key
   */
  private getFilePath(key: string): string {
    // Hash the key to create a valid filename
    const hash = this.hashKey(key);
    return path.join(this.cacheDir, `${hash}.json`);
  }

  /**
   * Hash cache key for filename
   */
  private hashKey(key: string): string {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Update cache size
   */
  private updateSize(): void {
    try {
      const files = fs.readdirSync(this.cacheDir);
      this.stats.size = files.length;
    } catch {
      this.stats.size = 0;
    }
  }
}
