/**
 * Metadata API for Stellar Accounts
 * Provides simplified storage and retrieval of arbitrary key-value data on Stellar accounts.
 * Uses Soroban contracts for persistent storage.
 */

// @ts-ignore: dependency is provided at the workspace root
import {
  Server,
  Account as StellarAccount,
  TransactionBuilder,
  Networks,
  Operation,
  BASE_FEE,
} from "stellar-sdk";

/**
 * Metadata operation parameters for set/get operations
 */
export interface MetadataSetParams {
  /** Stellar account address to store metadata on */
  accountId: string;
  /** Metadata key (must be alphanumeric, max 128 chars) */
  key: string;
  /** Metadata value (max 4KB as string) */
  value: string;
  /** Optional metadata type for categorization */
  type?: string;
  /** Optional expiration timestamp (unix seconds) */
  expiresAt?: number;
}

/**
 * Parameters for retrieving metadata
 */
export interface MetadataGetParams {
  /** Stellar account address to retrieve metadata from */
  accountId: string;
  /** Metadata key to retrieve */
  key: string;
}

/**
 * Retrieved metadata entry
 */
export interface MetadataEntry {
  key: string;
  value: string;
  type?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

/**
 * Response from metadata list operation
 */
export interface MetadataListResponse {
  accountId: string;
  metadata: MetadataEntry[];
  total: number;
  hasMore: boolean;
}

/**
 * Configuration for metadata manager
 */
export interface MetadataManagerConfig {
  horizonUrl?: string;
  networkPassphrase?: string;
  /** Default fee in stroops per operation */
  baseFee?: number;
}

/**
 * Simplified metadata manager for Stellar accounts
 */
export class StellarMetadataManager {
  private server: any;
  private horizonUrl: string;
  private networkPassphrase: string;
  private baseFee: number;
  private metadataCache: Map<string, MetadataEntry[]> = new Map();

  constructor(config?: MetadataManagerConfig) {
    this.horizonUrl = config?.horizonUrl || "https://horizon.stellar.org";
    this.networkPassphrase =
      config?.networkPassphrase || Networks.PUBLIC_NETWORK_PASSPHRASE;
    this.baseFee = config?.baseFee || BASE_FEE;
    this.server = new Server(this.horizonUrl);
  }

  /**
   * Store metadata for an account using ManageData operation.
   * ManageData operations store up to 64 bytes of data per entry.
   * For larger metadata, data is chunked and indexed.
   *
   * @param params - Metadata set parameters
   * @returns Transaction XDR for signing
   */
  async prepareSetMetadata(params: MetadataSetParams): Promise<string> {
    if (!params.key || !params.accountId) {
      throw new Error("accountId and key are required");
    }

    // Validate key format
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(params.key)) {
      throw new Error(
        "Key must be alphanumeric with underscores/hyphens, max 128 chars"
      );
    }

    if (params.value.length > 4096) {
      throw new Error("Value exceeds 4KB limit");
    }

    try {
      // Fetch current account sequence
      const account = await this.server
        .accounts()
        .accountId(params.accountId)
        .call();
      const stellarAccount = new StellarAccount(
        params.accountId,
        String(account.sequence)
      );

      // Prepare metadata payload
      const metadata = {
        key: params.key,
        value: params.value,
        type: params.type || "generic",
        timestamp: Math.floor(Date.now() / 1000),
        expiresAt: params.expiresAt,
      };

      const payload = JSON.stringify(metadata);

      // If value fits in ManageData limit (64 bytes), store directly
      const dataKey = `md:${params.key}`;
      const builder = new TransactionBuilder(stellarAccount, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      });

      if (payload.length <= 64) {
        // Store as single ManageData operation
        builder.addOperation(
          Operation.manageData({
            name: dataKey,
            value: payload,
          })
        );
      } else {
        // Chunk data for storage
        const chunks = this.chunkData(payload);
        chunks.forEach((chunk, index) => {
          builder.addOperation(
            Operation.manageData({
              name: `${dataKey}:${index}`,
              value: chunk,
            })
          );
        });
        // Store chunk count
        builder.addOperation(
          Operation.manageData({
            name: `${dataKey}:count`,
            value: String(chunks.length),
          })
        );
      }

      const transaction = builder.setTimeout(300).build();
      return transaction.toXDR();
    } catch (error) {
      throw new Error(
        `Failed to prepare metadata transaction: ${String(error)}`
      );
    }
  }

  /**
   * Retrieve metadata for an account
   *
   * @param params - Metadata get parameters
   * @returns Metadata entry if found, null otherwise
   */
  async getMetadata(params: MetadataGetParams): Promise<MetadataEntry | null> {
    if (!params.key || !params.accountId) {
      throw new Error("accountId and key are required");
    }

    try {
      // Check cache first
      const cached = this.metadataCache.get(params.accountId);
      if (cached) {
        const entry = cached.find((e) => e.key === params.key);
        if (entry) {
          // Check expiration
          if (
            entry.expiresAt &&
            entry.expiresAt < Math.floor(Date.now() / 1000)
          ) {
            return null;
          }
          return entry;
        }
      }

      // Fetch from Horizon
      const account = await this.server
        .accounts()
        .accountId(params.accountId)
        .call();

      const datumKey = `md:${params.key}`;
      const datum = account.data_attr?.[datumKey];

      if (!datum) {
        return null;
      }

      // Decode base64 to string
      const decodedValue = Buffer.from(datum, "base64").toString("utf-8");
      const metadata = JSON.parse(decodedValue);

      // Check expiration
      if (
        metadata.expiresAt &&
        metadata.expiresAt < Math.floor(Date.now() / 1000)
      ) {
        return null;
      }

      const entry: MetadataEntry = {
        key: params.key,
        value: metadata.value,
        type: metadata.type,
        createdAt: metadata.timestamp,
        updatedAt: metadata.timestamp,
        expiresAt: metadata.expiresAt,
      };

      // Update cache
      if (!this.metadataCache.has(params.accountId)) {
        this.metadataCache.set(params.accountId, []);
      }
      this.metadataCache.get(params.accountId)!.push(entry);

      return entry;
    } catch (error) {
      if (String(error).includes("not found")) {
        return null;
      }
      throw new Error(`Failed to retrieve metadata: ${String(error)}`);
    }
  }

  /**
   * List all metadata for an account
   *
   * @param accountId - Stellar account address
   * @returns List of metadata entries
   */
  async listMetadata(accountId: string): Promise<MetadataListResponse> {
    if (!accountId) {
      throw new Error("accountId is required");
    }

    try {
      // Check cache first
      const cached = this.metadataCache.get(accountId);
      if (cached && cached.length > 0) {
        return {
          accountId,
          metadata: cached.filter(
            (e) => !e.expiresAt || e.expiresAt > Math.floor(Date.now() / 1000)
          ),
          total: cached.length,
          hasMore: false,
        };
      }

      // Fetch from Horizon
      const account = await this.server.accounts().accountId(accountId).call();
      const dataAttr = account.data_attr || {};
      const metadata: MetadataEntry[] = [];

      for (const [key, value] of Object.entries(dataAttr)) {
        if (key.startsWith("md:") && !key.includes(":")) {
          try {
            const decodedValue = Buffer.from(String(value), "base64").toString(
              "utf-8"
            );
            const parsed = JSON.parse(decodedValue);

            // Skip expired entries
            if (
              parsed.expiresAt &&
              parsed.expiresAt < Math.floor(Date.now() / 1000)
            ) {
              continue;
            }

            metadata.push({
              key: parsed.key,
              value: parsed.value,
              type: parsed.type,
              createdAt: parsed.timestamp,
              updatedAt: parsed.timestamp,
              expiresAt: parsed.expiresAt,
            });
          } catch {
            // Skip malformed entries
          }
        }
      }

      // Update cache
      this.metadataCache.set(accountId, metadata);

      return {
        accountId,
        metadata,
        total: metadata.length,
        hasMore: false,
      };
    } catch (error) {
      throw new Error(`Failed to list metadata: ${String(error)}`);
    }
  }

  /**
   * Delete metadata from an account
   *
   * @param accountId - Stellar account address
   * @param key - Metadata key to delete
   * @returns Transaction XDR for signing
   */
  async prepareDeleteMetadata(accountId: string, key: string): Promise<string> {
    if (!accountId || !key) {
      throw new Error("accountId and key are required");
    }

    try {
      const account = await this.server.accounts().accountId(accountId).call();
      const stellarAccount = new StellarAccount(
        accountId,
        String(account.sequence)
      );

      const dataKey = `md:${key}`;
      const builder = new TransactionBuilder(stellarAccount, {
        fee: this.baseFee,
        networkPassphrase: this.networkPassphrase,
      });

      // Delete ManageData operation (value=null removes the entry)
      builder.addOperation(
        Operation.manageData({
          name: dataKey,
          value: null,
        })
      );

      const transaction = builder.setTimeout(300).build();

      // Clear cache
      this.metadataCache.delete(accountId);

      return transaction.toXDR();
    } catch (error) {
      throw new Error(
        `Failed to prepare delete metadata transaction: ${String(error)}`
      );
    }
  }

  /**
   * Batch get multiple metadata entries
   *
   * @param accountId - Stellar account address
   * @param keys - Array of metadata keys to retrieve
   * @returns Map of keys to metadata entries
   */
  async getMetadataBatch(
    accountId: string,
    keys: string[]
  ): Promise<Map<string, MetadataEntry | null>> {
    const results = new Map<string, MetadataEntry | null>();

    for (const key of keys) {
      try {
        const entry = await this.getMetadata({ accountId, key });
        results.set(key, entry);
      } catch {
        results.set(key, null);
      }
    }

    return results;
  }

  /**
   * Clear the metadata cache
   */
  clearCache(): void {
    this.metadataCache.clear();
  }

  /**
   * Chunk data for storage in ManageData operations
   * @private
   */
  private chunkData(data: string, chunkSize: number = 64): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.substring(i, i + chunkSize));
    }
    return chunks;
  }
}

/**
 * Factory function for creating a metadata manager
 */
export function createMetadataManager(
  config?: MetadataManagerConfig
): StellarMetadataManager {
  return new StellarMetadataManager(config);
}

export default StellarMetadataManager;
