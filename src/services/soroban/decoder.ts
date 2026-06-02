/**
 * XDR decoding layer.
 *
 * Responsible for converting raw ScVal return values from simulation results
 * into native JavaScript types. Isolated here so the rest of the subsystem
 * never calls scValToNative directly.
 */

import { scValToNative } from "./sdkAdapter";
import { DecodeError } from "./errors";
import type { SimulationSuccess } from "./sdkAdapter";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Decode the return value from a successful simulation result.
 * Returns `null` when the contract method has no return value.
 */
export function decodeReturnValue(sim: SimulationSuccess): unknown {
  const retval = extractRetval(sim);
  if (retval === null || retval === undefined) return null;

  try {
    return scValToNative(retval);
  } catch (err) {
    throw new DecodeError(
      `Failed to decode ScVal return value: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }
}

/**
 * Decode an arbitrary ScVal to a native JS value.
 * Useful for decoding ledger entry values outside of a simulation context.
 */
export function decodeScVal(scVal: unknown): unknown {
  if (scVal === null || scVal === undefined) return null;
  try {
    return scValToNative(scVal);
  } catch (err) {
    throw new DecodeError(
      `Failed to decode ScVal: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function extractRetval(sim: SimulationSuccess): unknown {
  // Current SDK shape: sim.result.retval
  const result = sim.result as Record<string, unknown> | undefined;
  if (result?.["retval"] !== undefined) return result["retval"];

  // Older SDK shape: sim.result.result.retval
  const nested = result?.["result"] as Record<string, unknown> | undefined;
  if (nested?.["retval"] !== undefined) return nested["retval"];

  return null;
}
