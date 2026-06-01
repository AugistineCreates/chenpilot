"use strict";
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
exports.SorobanBatchBuilder = void 0;
exports.getExecutionLogs = getExecutionLogs;
// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_RPC_URLS = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};
// ─── Helpers ─────────────────────────────────────────────────────────────────
function resolveRpcUrl(network, rpcUrl) {
  if (rpcUrl) return rpcUrl;
  return DEFAULT_RPC_URLS[network];
}
function fetchRpc(rpcUrl, method, params, fetcher) {
  return __awaiter(this, void 0, void 0, function* () {
    const resp = yield fetcher(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!resp.ok) {
      throw new Error(`RPC HTTP ${resp.status}: ${resp.statusText}`);
    }
    const json = yield resp.json();
    if (json.error) {
      throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
    }
    if (json.result === undefined) {
      throw new Error("RPC returned no result");
    }
    return json.result;
  });
}
/**
 * Execute multiple RPC requests in a single batch HTTP request.
 * Uses JSON-RPC 2.0 batch protocol to combine requests.
 *
 * @param rpcUrl - The RPC endpoint URL
 * @param requests - Array of RPC requests to batch
 * @param fetcher - Optional fetch implementation
 * @returns Array of results corresponding to input requests
 */
function fetchBatchRpc(rpcUrl, requests, fetcher) {
  return __awaiter(this, void 0, void 0, function* () {
    if (requests.length === 0) {
      return [];
    }
    // Build batch request with unique IDs
    const jsonRpcRequests = requests.map((req, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: req.method,
      params: req.params,
    }));
    const resp = yield fetcher(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonRpcRequests),
    });
    if (!resp.ok) {
      throw new Error(`RPC HTTP ${resp.status}: ${resp.statusText}`);
    }
    const responses = yield resp.json();
    // Return results in original request order
    return responses
      .sort((a, b) => a.id - b.id)
      .map((response) => ({
        result: response.result,
        error: response.error,
      }));
  });
}
function formatEvents(raw) {
  return raw.map((ev, index) => {
    var _a, _b, _c;
    return {
      index,
      contractId: (_a = ev.contractId) !== null && _a !== void 0 ? _a : null,
      type: (_b = ev.type) !== null && _b !== void 0 ? _b : "contract",
      topics: Array.isArray(ev.topic) ? ev.topic : [],
      data: (_c = ev.value) !== null && _c !== void 0 ? _c : null,
    };
  });
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Retrieve and format execution logs for a Soroban contract call.
 *
 * Calls the `getTransaction` JSON-RPC method and maps the result into a
 * structured {@link ExecutionLog} containing status, ledger info, return value
 * and all emitted contract events.
 *
 * @param params - Network, transaction hash and optional RPC URL override.
 * @param fetcher - Optional `fetch` implementation (defaults to globalThis.fetch).
 *                  Inject a custom fetcher in tests to avoid real network calls.
 */
function getExecutionLogs(params_1) {
  return __awaiter(
    this,
    arguments,
    void 0,
    function* (params, fetcher = globalThis.fetch) {
      var _a, _b, _c, _d;
      if (!params.txHash || typeof params.txHash !== "string") {
        throw new Error("Missing or invalid txHash");
      }
      const rpcUrl = resolveRpcUrl(params.network, params.rpcUrl);
      const raw = yield fetchRpc(
        rpcUrl,
        "getTransaction",
        { hash: params.txHash },
        fetcher
      );
      if (raw.status === "NOT_FOUND") {
        return {
          txHash: params.txHash,
          status: "NOT_FOUND",
          ledger: null,
          createdAt: null,
          returnValue: null,
          events: [],
          errorMessage: `Transaction not found: ${params.txHash}`,
        };
      }
      const status = raw.status === "SUCCESS" ? "SUCCESS" : "FAILED";
      return {
        txHash: params.txHash,
        status,
        ledger: (_a = raw.ledger) !== null && _a !== void 0 ? _a : null,
        createdAt: (_b = raw.createdAt) !== null && _b !== void 0 ? _b : null,
        returnValue:
          (_c = raw.returnValue) !== null && _c !== void 0 ? _c : null,
        events: formatEvents(
          (_d = raw.events) !== null && _d !== void 0 ? _d : []
        ),
        errorMessage:
          status === "FAILED" ? `Transaction failed: ${params.txHash}` : null,
      };
    }
  );
}
/**
 * Batch request builder for executing multiple execution log queries
 * in a single HTTP request to optimize network usage.
 *
 * @example
 * const batch = new SorobanBatchBuilder("testnet")
 *   .addTransaction("tx-hash-1")
 *   .addTransaction("tx-hash-2");
 *
 * const results = await batch.execute();
 */
class SorobanBatchBuilder {
  constructor(network, rpcUrl) {
    this.txHashes = [];
    this.network = network;
    this.rpcUrl = rpcUrl;
  }
  /**
   * Add a transaction hash to the batch
   * @param txHash - Transaction hash to query
   * @returns This builder for chaining
   */
  addTransaction(txHash) {
    if (!txHash || typeof txHash !== "string") {
      throw new Error("Invalid transaction hash");
    }
    this.txHashes.push(txHash);
    return this;
  }
  /**
   * Add multiple transaction hashes to the batch
   * @param txHashes - Array of transaction hashes
   * @returns This builder for chaining
   */
  addTransactions(txHashes) {
    for (const hash of txHashes) {
      this.addTransaction(hash);
    }
    return this;
  }
  /**
   * Get the current number of transactions in the batch
   */
  size() {
    return this.txHashes.length;
  }
  /**
   * Clear all transactions from the batch
   */
  clear() {
    this.txHashes = [];
  }
  /**
   * Execute the batch request and retrieve all execution logs
   * @param fetcher - Optional fetch implementation
   * @returns Array of execution logs in the same order as added
   */
  execute() {
    return __awaiter(
      this,
      arguments,
      void 0,
      function* (fetcher = globalThis.fetch) {
        if (this.txHashes.length === 0) {
          return [];
        }
        const rpcUrl = resolveRpcUrl(this.network, this.rpcUrl);
        // Build batch requests
        const batchRequests = this.txHashes.map((hash) => ({
          method: "getTransaction",
          params: { hash },
        }));
        try {
          const results = yield fetchBatchRpc(rpcUrl, batchRequests, fetcher);
          // Map results back to ExecutionLog format
          return results.map((result, index) => {
            var _a, _b, _c, _d;
            const txHash = this.txHashes[index];
            if (result.error) {
              return {
                txHash,
                status: "NOT_FOUND",
                ledger: null,
                createdAt: null,
                returnValue: null,
                events: [],
                errorMessage: `RPC error ${result.error.code}: ${result.error.message}`,
              };
            }
            if (!result.result) {
              return {
                txHash,
                status: "NOT_FOUND",
                ledger: null,
                createdAt: null,
                returnValue: null,
                events: [],
                errorMessage: "RPC returned no result",
              };
            }
            const raw = result.result;
            if (raw.status === "NOT_FOUND") {
              return {
                txHash,
                status: "NOT_FOUND",
                ledger: null,
                createdAt: null,
                returnValue: null,
                events: [],
                errorMessage: `Transaction not found: ${txHash}`,
              };
            }
            const status = raw.status === "SUCCESS" ? "SUCCESS" : "FAILED";
            return {
              txHash,
              status,
              ledger: (_a = raw.ledger) !== null && _a !== void 0 ? _a : null,
              createdAt:
                (_b = raw.createdAt) !== null && _b !== void 0 ? _b : null,
              returnValue:
                (_c = raw.returnValue) !== null && _c !== void 0 ? _c : null,
              events: formatEvents(
                (_d = raw.events) !== null && _d !== void 0 ? _d : []
              ),
              errorMessage:
                status === "FAILED" ? `Transaction failed: ${txHash}` : null,
            };
          });
        } catch (error) {
          // If batch fails, return error for all transactions
          return this.txHashes.map((txHash) => ({
            txHash,
            status: "NOT_FOUND",
            ledger: null,
            createdAt: null,
            returnValue: null,
            events: [],
            errorMessage: `Batch request failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          }));
        }
      }
    );
  }
}
exports.SorobanBatchBuilder = SorobanBatchBuilder;
