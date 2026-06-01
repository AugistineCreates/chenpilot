/**
 * SDK compatibility adapter.
 *
 * The @stellar/stellar-sdk has changed its namespace layout across versions.
 * All SDK surface-area access is centralised here so the rest of the subsystem
 * never imports from stellar-sdk directly and never has to deal with version
 * detection logic.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { SdkInitError } from "./errors";

export type SorobanNetwork = "testnet" | "mainnet";

// ─── Network constants ────────────────────────────────────────────────────────

export const DEFAULT_RPC_URLS: Record<SorobanNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

export const NETWORK_PASSPHRASES: Record<SorobanNetwork, string> = {
  testnet:
    (StellarSdk.Networks as Record<string, string>)?.TESTNET ??
    "Test SDF Network ; September 2015",
  mainnet:
    (StellarSdk.Networks as Record<string, string>)?.PUBLIC ??
    "Public Global Stellar Network ; September 2015",
};

// ─── RPC server factory ───────────────────────────────────────────────────────

export interface RpcServer {
  simulateTransaction(tx: StellarSdk.Transaction): Promise<unknown>;
  getLatestLedger(): Promise<{ sequence: number }>;
  getLedgerEntries(...keys: StellarSdk.xdr.LedgerKey[]): Promise<{
    entries: Array<{ liveUntilLedgerSeq?: number }>;
  }>;
}

/**
 * Build an RPC server instance, trying the current SDK namespace first and
 * falling back to the legacy layout.
 */
export function buildRpcServer(rpcUrl: string): RpcServer {
  const sdk = StellarSdk as unknown as Record<string, unknown>;

  // Current SDK: StellarSdk.SorobanRpc.Server
  if (
    sdk["SorobanRpc"] &&
    typeof (sdk["SorobanRpc"] as Record<string, unknown>)["Server"] ===
      "function"
  ) {
    const Ctor = (sdk["SorobanRpc"] as Record<string, unknown>)[
      "Server"
    ] as new (url: string, opts?: { allowHttp?: boolean }) => RpcServer;
    return new Ctor(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  }

  // Older SDK: StellarSdk.Soroban.Server
  if (
    sdk["Soroban"] &&
    typeof (sdk["Soroban"] as Record<string, unknown>)["Server"] === "function"
  ) {
    const Ctor = (sdk["Soroban"] as Record<string, unknown>)["Server"] as new (
      url: string,
      opts?: { allowHttp?: boolean }
    ) => RpcServer;
    return new Ctor(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  }

  throw new SdkInitError(
    `Cannot locate SorobanRpc.Server in the installed stellar-sdk. ` +
      `Ensure @stellar/stellar-sdk ≥ 11 is installed.`
  );
}

// ─── Simulation result type guards ───────────────────────────────────────────

export interface SimulationSuccess {
  result?: { retval?: unknown; auth?: unknown[] };
  minResourceFee?: string;
  transactionData?: {
    build(): { resources(): { instructions(): bigint; readBytes(): bigint } };
    toXDR(): string;
  };
}

export interface SimulationFailure {
  error: string;
}

export function isSimulationError(sim: unknown): sim is SimulationFailure {
  const sdk = StellarSdk as unknown as Record<string, unknown>;
  const api = (sdk["SorobanRpc"] as Record<string, unknown> | undefined)?.[
    "Api"
  ] as Record<string, unknown> | undefined;

  if (api?.["isSimulationError"]) {
    return (api["isSimulationError"] as (s: unknown) => boolean)(sim);
  }
  // Fallback: duck-type
  return typeof (sim as Record<string, unknown>)?.["error"] === "string";
}

export function isSimulationSuccess(sim: unknown): sim is SimulationSuccess {
  const sdk = StellarSdk as unknown as Record<string, unknown>;
  const api = (sdk["SorobanRpc"] as Record<string, unknown> | undefined)?.[
    "Api"
  ] as Record<string, unknown> | undefined;

  if (api?.["isSimulationSuccess"]) {
    return (api["isSimulationSuccess"] as (s: unknown) => boolean)(sim);
  }
  // Fallback: duck-type
  const s = sim as Record<string, unknown>;
  return (
    !s?.["error"] &&
    (s?.["result"] !== undefined || s?.["minResourceFee"] !== undefined)
  );
}

// ─── ScVal helpers ────────────────────────────────────────────────────────────

/**
 * Convert a native JS value to an ScVal, using the SDK helper when available.
 */
export function nativeToScVal(value: unknown): unknown {
  if (typeof StellarSdk.nativeToScVal === "function") {
    return StellarSdk.nativeToScVal(value as never);
  }
  return value;
}

/**
 * Convert an ScVal to a native JS value.
 */
export function scValToNative(scVal: unknown): unknown {
  if (typeof StellarSdk.scValToNative === "function") {
    return StellarSdk.scValToNative(scVal as never);
  }
  return scVal;
}

/**
 * Return true if the value looks like an already-constructed ScVal.
 */
export function isScVal(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return "switch" in (value as Record<string, unknown>);
}

// ─── Misc re-exports ──────────────────────────────────────────────────────────

export { StellarSdk };

export function resolveRpcUrl(
  network: SorobanNetwork,
  override?: string
): string {
  if (override) return override;
  if (network === "testnet") {
    return process.env.SOROBAN_RPC_URL_TESTNET ?? DEFAULT_RPC_URLS.testnet;
  }
  return process.env.SOROBAN_RPC_URL_MAINNET ?? DEFAULT_RPC_URLS.mainnet;
}
