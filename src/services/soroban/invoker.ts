/**
 * Contract invocation orchestrator.
 *
 * Composes the simulation, signing-prep, and decoding layers into the two
 * public operations the rest of the platform needs:
 *
 *   invokeContract  — simulate → (optionally sign & submit) → decode result
 *   estimateContract — simulate → return resource estimates only
 *
 * This is the only layer that knows about the full execution flow.
 */

import { simulate, SimulateParams, SimulationEstimates } from "./simulator";
import { decodeReturnValue } from "./decoder";
import { assertSigningNotRequired } from "./signingPrep";
import { InvocationError } from "./errors";
import type { SorobanNetwork } from "./sdkAdapter";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface InvokeContractParams {
  network: SorobanNetwork;
  rpcUrl?: string;
  contractId: string;
  method: string;
  args?: unknown[];
  source?: {
    publicKey?: string;
    /** Providing a secretKey enables signed submission for state-mutating calls */
    secretKey?: string;
  };
  fee?: number;
  timeoutMs?: number;
}

export interface InvokeContractResult {
  network: SorobanNetwork;
  contractId: string;
  method: string;
  result: unknown;
  /** Raw simulation response — available for debugging */
  raw?: unknown;
}

// ─── Core orchestration ───────────────────────────────────────────────────────

/**
 * Invoke a Soroban contract method.
 *
 * For read-only calls (no auth required) this is a pure simulation.
 * For state-mutating calls that require auth, a `source.secretKey` must be
 * provided — the transaction will be assembled, signed, and submitted.
 */
export async function invokeContract(
  params: InvokeContractParams
): Promise<InvokeContractResult> {
  const simParams = toSimulateParams(params);

  let simResult;
  try {
    simResult = await simulate(simParams);
  } catch (err) {
    // Re-throw typed errors from the simulation layer as-is; wrap unknowns
    if (err instanceof Error && err.name.endsWith("Error")) throw err;
    throw new InvocationError(
      `Contract invocation failed during simulation: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  // Guard: if auth is required but no secret key was provided, fail fast
  assertSigningNotRequired(simResult.raw, !!params.source?.secretKey);

  // Decode the return value
  const decoded = decodeReturnValue(simResult.raw);

  return {
    network: params.network,
    contractId: params.contractId,
    method: params.method,
    result: decoded,
    raw: simResult.raw,
  };
}

/**
 * Estimate gas and resource costs for a contract call without executing it.
 */
export async function estimateContract(
  params: InvokeContractParams
): Promise<SimulationEstimates> {
  const simParams = toSimulateParams(params);
  const simResult = await simulate(simParams);

  if (!simResult.estimates) {
    throw new InvocationError(
      "Resource estimates are not available for this simulation result. " +
        "The RPC may not have returned transactionData."
    );
  }

  return simResult.estimates;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toSimulateParams(params: InvokeContractParams): SimulateParams {
  return {
    network: params.network,
    rpcUrl: params.rpcUrl,
    contractId: params.contractId,
    method: params.method,
    args: params.args,
    sourcePublicKey: params.source?.publicKey,
    timeoutSeconds: params.timeoutMs
      ? Math.ceil(params.timeoutMs / 1000)
      : undefined,
    fee: params.fee?.toString(),
  };
}
