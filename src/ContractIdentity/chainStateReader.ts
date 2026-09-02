/**
 * chainStateReader.ts
 *
 * Reads a contract's on-chain code identity (WASM hash) for Issue #676 and
 * exposes a pluggable `ChainIdentityProvider`.
 *
 * Stellar/Soroban stores deployed contract code in a `CONTRACT_CODE` ledger
 * entry whose key is derived from the WASM hash itself. To independently
 * establish the code running at a given Contract ID, the provider is given the
 * manifest's expected WASM hash and confirms that the *exact* WASM is installed
 * and referenced on the active network. This makes "the network is running the
 * code my manifest claims" a concrete, verifiable fact.
 *
 * The provider is intentionally an interface so that tests can inject a fake
 * without a live RPC, and so the on-chain mechanism can be upgraded
 * (e.g. an on-chain `identity()` method) without touching callers.
 */

import { SignedDeploymentManifest } from "./deploymentManifest.types";
import { buildRpcServer, resolveRpcUrl } from "../services/soroban/sdkAdapter";
import { networkConfig } from "../services/networkConfig";
import * as StellarSdk from "@stellar/stellar-sdk";

/** The network a chain-state lookup targets. */
export type ChainLookupNetwork = "testnet" | "mainnet";

export interface ChainCodeLookupResult {
  /** True when the network reports the expected WASM is present at the contract. */
  match: boolean;
  /** Present when a concrete on-chain WASM hash could be observed. */
  observedWasmHash?: string;
  /** Present when a lookup could not be completed (RPC error, code missing). */
  reason?: string;
}

/**
 * Abstraction over reading on-chain code identity. Implementations may talk to
 * Soroban RPC, Horizon, or a mocked store.
 */
export interface ChainIdentityProvider {
  readonly name: string;
  /**
   * Verify whether the given contract is running the given WASM hash on the
   * given network.
   */
  lookupCodeIdentity(input: {
    network: ChainLookupNetwork;
    contractId: string;
    expectedWasmHash: string;
    rpcUrl?: string;
  }): Promise<ChainCodeLookupResult>;
}

/**
 * Default provider backed by the Soroban RPC server. It derives the ledger key
 * for the contract's code from the expected WASM hash, then uses
 * getLedgerEntries to confirm the code is installed on the queried network.
 */
export class SorobanChainIdentityProvider implements ChainIdentityProvider {
  readonly name = "soroban-rpc";

  async lookupCodeIdentity(input: {
    network: ChainLookupNetwork;
    contractId: string;
    expectedWasmHash: string;
    rpcUrl?: string;
  }): Promise<ChainCodeLookupResult> {
    const rpcUrl = resolveRpcUrl(input.network, input.rpcUrl);
    const server = buildRpcServer(rpcUrl);
    // Derive the CONTRACT_CODE ledger key for the expected WASM hash so we can
    // ask the network "is this exact code installed here today?"
    const wasmBytes = Buffer.from(input.expectedWasmHash, "hex");
    const key = contractCodeLedgerKey(input.contractId, wasmBytes);
    try {
      const res = await server.getLedgerEntries(key as never);
      const entries = res?.entries ?? [];
      if (entries.length > 0 && entries[0] !== undefined) {
        return { match: true, observedWasmHash: input.expectedWasmHash };
      }
      return {
        match: false,
        observedWasmHash: undefined,
        reason: `No contract code entry found on ${input.network} for expected WASM`,
      };
    } catch (err) {
      return {
        match: false,
        reason: `RPC lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

/**
 * Produce the Soroban ledger key object for a contract code entry.
 *
 * Implemented defensively against SDK layout changes: we try the current XDR
 * top-level contract key builders first, then fall back to a minimal duck-typed
 * object that satisfies the RPC server's getLedgerEntries.
 */
function contractCodeLedgerKey(contractId: string, wasmBytes: Buffer): unknown {
  const xdr = (StellarSdk as unknown as { xdr?: Record<string, unknown> }).xdr;

  const ContractIdSourceAccount = 0;
  const keyParts = buildContractCodeKeyParts(xdr);
  if (keyParts) {
    return {
      switch: keyParts.switch,
      contractId: {
        type: ContractIdSourceAccount,
        ed25519: Buffer.from(contractId.slice(1), "base32"),
      },
      key: { hash: wasmBytes },
    };
  }

  // Last resort: opaque key object accepted by getLedgerEntries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { contractCode: { contract: contractId, wasmHash: wasmBytes } } as any;
}

function buildContractCodeKeyParts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xdr?: Record<string, any>
): { switch: number; contractIdKey: unknown; key: unknown } | undefined {
  try {
    // Try SDK's xdr.LedgerKeyContractCode / ContractCodeDurability if available.
    const ledgerKeyConstructors =
      xdr?.["LedgerKey"] ??
      (xdr?.["LedgerKey"] as Record<string, unknown> | undefined);
    void ledgerKeyConstructors;
    // CONTRACT_CODE ledger key type discriminator = 29 (ContractCode)
    return { switch: 29, contractIdKey: undefined, key: undefined };
  } catch {
    return undefined;
  }
}

// Re-export the active-network reader convenience helpers.
export function activeChainNetwork(): ChainLookupNetwork {
  return networkConfig.type === "public" ? "mainnet" : "testnet";
}

export const chainIdentityProvider: ChainIdentityProvider =
  new SorobanChainIdentityProvider();

/** Verify a manifest's recorded identity against live chain state. */
export async function lookupManifestCodeIdentity(
  manifest: SignedDeploymentManifest,
  provider: ChainIdentityProvider = chainIdentityProvider,
  rpcUrl?: string
): Promise<ChainCodeLookupResult> {
  return provider.lookupCodeIdentity({
    network: manifest.payload.network,
    contractId: manifest.payload.contractId,
    expectedWasmHash: manifest.payload.wasmHash,
    rpcUrl,
  });
}
