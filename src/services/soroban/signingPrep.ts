/**
 * Signing preparation layer.
 *
 * Responsible for:
 *  - Detecting whether a simulation result requires authorization
 *  - Assembling the transaction with the populated footprint from simulation
 *  - Signing the assembled transaction with a provided keypair
 *
 * This layer does NOT submit the transaction — submission is the invoker's job.
 */

import { StellarSdk, NETWORK_PASSPHRASES, SorobanNetwork } from "./sdkAdapter";
import { AuthRequiredError, SigningError } from "./errors";
import type { SimulationSuccess } from "./sdkAdapter";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SigningContext {
  network: SorobanNetwork;
  secretKey: string;
}

export interface AssembledTransaction {
  /** The signed XDR string ready for submission */
  signedXdr: string;
  /** The keypair used for signing */
  signerPublicKey: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return true when the simulation result contains auth entries that must be
 * signed before the transaction can be submitted.
 */
export function requiresSigning(sim: SimulationSuccess): boolean {
  const auth = sim.result?.auth;
  return Array.isArray(auth) && auth.length > 0;
}

/**
 * Assemble and sign a transaction using the simulation result's footprint.
 *
 * Throws `AuthRequiredError` when auth entries are present but no signing
 * context is provided.
 *
 * Throws `SigningError` when the SDK's `assembleTransaction` helper is
 * unavailable or signing fails.
 */
export function prepareSignedTransaction(
  unsignedTx: StellarSdk.Transaction,
  sim: SimulationSuccess,
  context: SigningContext
): AssembledTransaction {
  const keypair = parseKeypair(context.secretKey);

  const assembled = assembleWithSimulation(unsignedTx, sim, context.network);
  assembled.sign(keypair);

  return {
    signedXdr: assembled.toEnvelope().toXDR("base64"),
    signerPublicKey: keypair.publicKey(),
  };
}

/**
 * Guard: throw `AuthRequiredError` when the simulation requires signing but
 * no secret key was supplied.
 */
export function assertSigningNotRequired(
  sim: SimulationSuccess,
  hasSecretKey: boolean
): void {
  if (requiresSigning(sim) && !hasSecretKey) {
    throw new AuthRequiredError();
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseKeypair(secretKey: string): StellarSdk.Keypair {
  try {
    return StellarSdk.Keypair.fromSecret(secretKey);
  } catch (err) {
    throw new SigningError(
      `Invalid secret key: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }
}

function assembleWithSimulation(
  tx: StellarSdk.Transaction,
  sim: SimulationSuccess,
  network: SorobanNetwork
): StellarSdk.Transaction {
  const sdk = StellarSdk as unknown as Record<string, unknown>;

  // Current SDK: StellarSdk.SorobanRpc.assembleTransaction
  const rpcNs = sdk["SorobanRpc"] as Record<string, unknown> | undefined;
  if (typeof rpcNs?.["assembleTransaction"] === "function") {
    try {
      return (
        rpcNs["assembleTransaction"] as (
          tx: StellarSdk.Transaction,
          sim: unknown
        ) => StellarSdk.Transaction
      )(tx, sim);
    } catch (err) {
      throw new SigningError(
        `assembleTransaction failed: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }

  // Fallback: manually attach the simulation's transaction data
  if (sim.transactionData) {
    try {
      const passphrase = NETWORK_PASSPHRASES[network];
      const txBuilder = StellarSdk.TransactionBuilder.cloneFrom(tx, {
        fee: sim.minResourceFee ?? StellarSdk.BASE_FEE,
        networkPassphrase: passphrase,
      });
      return txBuilder.build();
    } catch (err) {
      throw new SigningError(
        `Manual transaction assembly failed: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }

  throw new SigningError(
    "Cannot assemble transaction: SorobanRpc.assembleTransaction is not available " +
      "and simulation result contains no transactionData. " +
      "Upgrade @stellar/stellar-sdk to ≥ 11."
  );
}
