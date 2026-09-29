import {
  ExecutionLog,
  ExecutionLogEntry,
  GetExecutionLogsParams,
  SorobanNetwork,
} from "./types";
import { throwIfAborted } from "./abort";
import type { AbortSignalLike } from "./types";

// ─── Internal types for raw RPC payloads ─────────────────────────────────────

interface RpcEvent {
  type?: string;
  contractId?: string;
  /** Stellar SDK may surface topics as `topic` (array) */
  topic?: unknown[];
  value?: unknown;
}

interface RpcGetTransactionResult {
  status: string;
  ledger?: number;
  createdAt?: number;
  /** Decoded return value when the RPC surfaces it directly. */
  returnValue?: unknown;
  events?: RpcEvent[];
  /** Raw XDR strings – present on older RPC implementations. */
  resultXdr?: string;
  resultMetaXdr?: string;
}

interface JsonRpcResponse<T> {
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

export interface BatchRequest {
  method: string;
  params: unknown;
}

export interface BatchResult<T> {
  result?: T;
  error?: { code: number; message: string };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RPC_URLS: Record<SorobanNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveRpcUrl(network: SorobanNetwork, rpcUrl?: string): string {
  if (rpcUrl) return rpcUrl;
  return DEFAULT_RPC_URLS[network];
}

async function fetchRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown,
  fetcher: typeof fetch,
  signal?: AbortSignalLike
): Promise<T> {
  throwIfAborted(signal);

  const resp = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: signal as AbortSignal | undefined,
  });

  if (!resp.ok) {
    throw new Error(`RPC HTTP ${resp.status}: ${resp.statusText}`);
  }

  const json = (await resp.json()) as JsonRpcResponse<T>;

  if (json.error) {
    throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
  }

  if (json.result === undefined) {
    throw new Error("RPC returned no result");
  }

  return json.result;
}

/**
 * Execute multiple RPC requests in a single batch HTTP request.
 * Uses JSON-RPC 2.0 batch protocol to combine requests.
 *
 * @param rpcUrl - The RPC endpoint URL
 * @param requests - Array of RPC requests to batch
 * @param fetcher - Optional fetch implementation
 * @param signal - Optional external signal to cancel the request
 * @returns Array of results corresponding to input requests
 */
async function fetchBatchRpc<T>(
  rpcUrl: string,
  requests: BatchRequest[],
  fetcher: typeof fetch,
  signal?: AbortSignalLike
): Promise<BatchResult<T>[]> {
  if (requests.length === 0) {
    return [];
  }

  throwIfAborted(signal);

  // Build batch request with unique IDs
  const jsonRpcRequests: JsonRpcRequest[] = requests.map((req, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: req.method,
    params: req.params,
  }));

  const resp = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonRpcRequests),
    signal: signal as AbortSignal | undefined,
  });

  if (!resp.ok) {
    throw new Error(`RPC HTTP ${resp.status}: ${resp.statusText}`);
  }

  const responses = (await resp.json()) as JsonRpcResponse<T>[];

  // Return results in original request order
  return responses
    .sort((a, b) => a.id - b.id)
    .map((response) => ({
      result: response.result,
      error: response.error,
    }));
}

function formatEvents(raw: RpcEvent[]): ExecutionLogEntry[] {
  return raw.map(
    (ev, index): ExecutionLogEntry => ({
      index,
      contractId: ev.contractId ?? null,
      type: ev.type ?? "contract",
      topics: Array.isArray(ev.topic) ? ev.topic : [],
      data: ev.value ?? null,
    })
  );
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
 * @param signal - Optional external signal to cancel the request.
 */
export async function getExecutionLogs(
  params: GetExecutionLogsParams,
  fetcher: typeof fetch = globalThis.fetch,
  signal?: AbortSignalLike
): Promise<ExecutionLog> {
  if (!params.txHash || typeof params.txHash !== "string") {
    throw new Error("Missing or invalid txHash");
  }

  const rpcUrl = resolveRpcUrl(params.network, params.rpcUrl);

  const raw = await fetchRpc<RpcGetTransactionResult>(
    rpcUrl,
    "getTransaction",
    { hash: params.txHash },
    fetcher,
    signal
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
    ledger: raw.ledger ?? null,
    createdAt: raw.createdAt ?? null,
    returnValue: raw.returnValue ?? null,
    events: formatEvents(raw.events ?? []),
    errorMessage:
      status === "FAILED" ? `Transaction failed: ${params.txHash}` : null,
  };
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
export class SorobanBatchBuilder {
  private txHashes: string[] = [];
  private network: SorobanNetwork;
  private rpcUrl?: string;

  constructor(network: SorobanNetwork, rpcUrl?: string) {
    this.network = network;
    this.rpcUrl = rpcUrl;
  }

  /**
   * Add a transaction hash to the batch
   * @param txHash - Transaction hash to query
   * @returns This builder for chaining
   */
  addTransaction(txHash: string): SorobanBatchBuilder {
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
  addTransactions(txHashes: string[]): SorobanBatchBuilder {
    for (const hash of txHashes) {
      this.addTransaction(hash);
    }
    return this;
  }

  /**
   * Get the current number of transactions in the batch
   */
  size(): number {
    return this.txHashes.length;
  }

  /**
   * Clear all transactions from the batch
   */
  clear(): void {
    this.txHashes = [];
  }

  /**
   * Execute the batch request and retrieve all execution logs
   * @param fetcher - Optional fetch implementation
   * @param signal - Optional external signal to cancel the request
   * @returns Array of execution logs in the same order as added
   */
  async execute(
    fetcher: typeof fetch = globalThis.fetch,
    signal?: AbortSignalLike
  ): Promise<ExecutionLog[]> {
    if (this.txHashes.length === 0) {
      return [];
    }

    const rpcUrl = resolveRpcUrl(this.network, this.rpcUrl);

    // Build batch requests
    const batchRequests: BatchRequest[] = this.txHashes.map((hash) => ({
      method: "getTransaction",
      params: { hash },
    }));

    try {
      const results = await fetchBatchRpc<RpcGetTransactionResult>(
        rpcUrl,
        batchRequests,
        fetcher,
        signal
      );

      // Map results back to ExecutionLog format
      return results.map((result, index) => {
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
          ledger: raw.ledger ?? null,
          createdAt: raw.createdAt ?? null,
          returnValue: raw.returnValue ?? null,
          events: formatEvents(raw.events ?? []),
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
}
