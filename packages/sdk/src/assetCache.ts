import * as fs from "fs";
import * as path from "path";
import * as StellarSdk from "@stellar/stellar-sdk";

export interface AssetInfo {
  code: string;
  issuer: string;
  name?: string;
  description?: string;
  image?: string;
  homeDomain?: string;
  lastUpdated: number;
}

/**
 * Frequency-lowering, network-aware Asset cache.
 *
 * All entries are scoped to a network so an entry cached from mainnet can
 * never be served to a testnet client (and vice versa). When constructed
 * without a network scope, the cache is *unscoped* and reports itself as such
 * via {@link AssetCache.isNetworkScoped}.
 */
export class AssetCache {
  private cache = new Map<string, AssetInfo>();
  private cacheFile: string;
  private readonly network: string | null;

  constructor(
    cacheDir = path.join(process.cwd(), ".asset-cache"),
    network: string | null = null
  ) {
    this.cacheFile = path.join(cacheDir, "assets.json");
    this.network = network;
    this.loadCache();
  }

  /** The network this cache is scoped to, or `null` when unscoped. */
  get scope(): string | null {
    return this.network;
  }

  /** True when this cache is network-scoped (safe for identity checks). */
  isNetworkScoped(): boolean {
    return typeof this.network === "string" && this.network.length > 0;
  }

  private scopePrefix(key: string): string {
    return this.isNetworkScoped() ? `${this.network}:${key}` : key;
  }

  private getKey(asset: StellarSdk.Asset): string {
    if (asset.isNative()) {
      return "XLM";
    } else {
      return `${asset.getCode()}:${asset.getIssuer()}`;
    }
  }

  private loadCache(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const data = fs.readFileSync(this.cacheFile, "utf8");
        const cacheData = JSON.parse(data);
        for (const [key, info] of Object.entries(cacheData)) {
          // Skip entries from other network scopes when we are scoped.
          if (this.isNetworkScoped()) {
            const prefix = `${this.network}:`;
            if (!key.startsWith(prefix)) continue;
            this.cache.set(key, info as AssetInfo);
          } else {
            this.cache.set(key, info as AssetInfo);
          }
        }
      }
    } catch (error) {
      // Ignore errors, start with empty cache
    }
  }

  private saveCache(): void {
    try {
      const cacheDir = path.dirname(this.cacheFile);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      const cacheData = Object.fromEntries(this.cache);
      fs.writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      // Ignore errors
    }
  }

  get(asset: StellarSdk.Asset): AssetInfo | undefined {
    const key = this.scopePrefix(this.getKey(asset));
    return this.cache.get(key);
  }

  set(asset: StellarSdk.Asset, info: AssetInfo): void {
    const key = this.scopePrefix(this.getKey(asset));
    this.cache.set(key, { ...info, lastUpdated: Date.now() });
    this.saveCache();
  }

  async fetchAndCache(
    asset: StellarSdk.Asset,
    horizonUrl?: string
  ): Promise<AssetInfo | null> {
    const existing = this.get(asset);
    if (existing) {
      return existing;
    }

    // For now, just create basic info
    const info: AssetInfo = {
      code: asset.isNative() ? "XLM" : asset.getCode(),
      issuer: asset.isNative() ? "" : asset.getIssuer(),
      lastUpdated: Date.now(),
    };

    this.set(asset, info);
    return info;
  }

  clear(): void {
    this.cache.clear();
    this.saveCache();
  }

  /** Network scopes currently represented in this cache (deduplicated). */
  inspectNetworks(): string[] {
    const networks = new Set<string>();
    if (!this.isNetworkScoped() && this.cache.size === 0) {
      return [];
    }
    for (const key of this.cache.keys()) {
      if (this.isNetworkScoped()) {
        networks.add(this.network as string);
      } else {
        const separator = key.indexOf(":");
        if (separator > 0) {
          networks.add(key.slice(0, separator));
        } else {
          networks.add("unscoped");
        }
      }
    }
    return [...networks];
  }
}
