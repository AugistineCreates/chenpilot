"use strict";
/**
 * Metadata API for Stellar Accounts
 * Provides simplified storage and retrieval of arbitrary key-value data on Stellar accounts.
 * Uses Soroban contracts for persistent storage.
 */
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.StellarMetadataManager = void 0;
exports.createMetadataManager = createMetadataManager;
// @ts-ignore: dependency is provided at the workspace root
const stellar_sdk_1 = require("stellar-sdk");
/**
 * Simplified metadata manager for Stellar accounts
 */
class StellarMetadataManager {
  constructor(config) {
    this.metadataCache = new Map();
    this.horizonUrl =
      (config === null || config === void 0 ? void 0 : config.horizonUrl) ||
      "https://horizon.stellar.org";
    this.networkPassphrase =
      (config === null || config === void 0
        ? void 0
        : config.networkPassphrase) ||
      stellar_sdk_1.Networks.PUBLIC_NETWORK_PASSPHRASE;
    this.baseFee =
      (config === null || config === void 0 ? void 0 : config.baseFee) ||
      stellar_sdk_1.BASE_FEE;
    this.server = new stellar_sdk_1.Server(this.horizonUrl);
  }
  /**
   * Store metadata for an account using ManageData operation.
   * ManageData operations store up to 64 bytes of data per entry.
   * For larger metadata, data is chunked and indexed.
   *
   * @param params - Metadata set parameters
   * @returns Transaction XDR for signing
   */
  prepareSetMetadata(params) {
    return __awaiter(this, void 0, void 0, function* () {
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
        const account = yield this.server
          .accounts()
          .accountId(params.accountId)
          .call();
        const stellarAccount = new stellar_sdk_1.Account(
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
        const builder = new stellar_sdk_1.TransactionBuilder(stellarAccount, {
          fee: this.baseFee,
          networkPassphrase: this.networkPassphrase,
        });
        if (payload.length <= 64) {
          // Store as single ManageData operation
          builder.addOperation(
            stellar_sdk_1.Operation.manageData({
              name: dataKey,
              value: payload,
            })
          );
        } else {
          // Chunk data for storage
          const chunks = this.chunkData(payload);
          chunks.forEach((chunk, index) => {
            builder.addOperation(
              stellar_sdk_1.Operation.manageData({
                name: `${dataKey}:${index}`,
                value: chunk,
              })
            );
          });
          // Store chunk count
          builder.addOperation(
            stellar_sdk_1.Operation.manageData({
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
    });
  }
  /**
   * Retrieve metadata for an account
   *
   * @param params - Metadata get parameters
   * @returns Metadata entry if found, null otherwise
   */
  getMetadata(params) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
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
        const account = yield this.server
          .accounts()
          .accountId(params.accountId)
          .call();
        const datumKey = `md:${params.key}`;
        const datum =
          (_a = account.data_attr) === null || _a === void 0
            ? void 0
            : _a[datumKey];
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
        const entry = {
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
        this.metadataCache.get(params.accountId).push(entry);
        return entry;
      } catch (error) {
        if (String(error).includes("not found")) {
          return null;
        }
        throw new Error(`Failed to retrieve metadata: ${String(error)}`);
      }
    });
  }
  /**
   * List all metadata for an account
   *
   * @param accountId - Stellar account address
   * @returns List of metadata entries
   */
  listMetadata(accountId) {
    return __awaiter(this, void 0, void 0, function* () {
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
        const account = yield this.server
          .accounts()
          .accountId(accountId)
          .call();
        const dataAttr = account.data_attr || {};
        const metadata = [];
        for (const [key, value] of Object.entries(dataAttr)) {
          if (key.startsWith("md:") && !key.includes(":")) {
            try {
              const decodedValue = Buffer.from(
                String(value),
                "base64"
              ).toString("utf-8");
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
            } catch (_a) {
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
    });
  }
  /**
   * Delete metadata from an account
   *
   * @param accountId - Stellar account address
   * @param key - Metadata key to delete
   * @returns Transaction XDR for signing
   */
  prepareDeleteMetadata(accountId, key) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!accountId || !key) {
        throw new Error("accountId and key are required");
      }
      try {
        const account = yield this.server
          .accounts()
          .accountId(accountId)
          .call();
        const stellarAccount = new stellar_sdk_1.Account(
          accountId,
          String(account.sequence)
        );
        const dataKey = `md:${key}`;
        const builder = new stellar_sdk_1.TransactionBuilder(stellarAccount, {
          fee: this.baseFee,
          networkPassphrase: this.networkPassphrase,
        });
        // Delete ManageData operation (value=null removes the entry)
        builder.addOperation(
          stellar_sdk_1.Operation.manageData({
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
    });
  }
  /**
   * Batch get multiple metadata entries
   *
   * @param accountId - Stellar account address
   * @param keys - Array of metadata keys to retrieve
   * @returns Map of keys to metadata entries
   */
  getMetadataBatch(accountId, keys) {
    return __awaiter(this, void 0, void 0, function* () {
      const results = new Map();
      for (const key of keys) {
        try {
          const entry = yield this.getMetadata({ accountId, key });
          results.set(key, entry);
        } catch (_a) {
          results.set(key, null);
        }
      }
      return results;
    });
  }
  /**
   * Clear the metadata cache
   */
  clearCache() {
    this.metadataCache.clear();
  }
  /**
   * Chunk data for storage in ManageData operations
   * @private
   */
  chunkData(data, chunkSize = 64) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.substring(i, i + chunkSize));
    }
    return chunks;
  }
}
exports.StellarMetadataManager = StellarMetadataManager;
/**
 * Factory function for creating a metadata manager
 */
function createMetadataManager(config) {
  return new StellarMetadataManager(config);
}
exports.default = StellarMetadataManager;
