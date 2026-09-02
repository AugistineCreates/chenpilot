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
import { AuthRequiredError, SigningError, NetworkMismatchError } from "./errors";
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
 * Throws `NetworkMismatchError` when the transaction envelope was built for a
 * different network passphrase than the client claims to be on — before any
 * signature bytes are produced.
 *
 * Throws `SigningError` when the SDK's `assembleTransaction` helper is
 * unavailable or signing fails.
 */
export function prepareSignedTransaction(
  unsignedTx: StellarSdk.Transaction,
  sim: SimulationSuccess,
  context: SigningContext
): AssembledTransaction {
  assertNetworkMatches(unsignedTx, context.network);

  const keypair = parseKeypair(context.secretKey);

    return {
      signedXdr: assembled.toEnvelope().toXDR("base64"),
      signerPublicKey: keypair.publicKey(),
    };
  } finally {
    secret.destroy();
  }
}

/**
 * Guard: refuse to sign when the transaction envelope's network passphrase
 * disagrees with the client's declared network. This runs BEFORE any signing
 * step so no signature is ever produced for the wrong environment.
 */
function assertNetworkMatches(
  tx: StellarSdk.Transaction,
  network: SorobanNetwork
): void {
  const expected = NETWORK_PASSPHRASES[network];
  const transactionPassphrase = tx.networkPassphrase;
  if (
    typeof transactionPassphrase === "string" &&
    transactionPassphrase.length > 0 &&
    transactionPassphrase !== expected
  ) {
    throw new NetworkMismatchError({
      expectedNetwork: network,
      transactionNetwork: transactionPassphrase,
    });
  }
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

function parseKeypair(secret: SecretBuffer): StellarSdk.Keypair {
  try {
    // Keypair.fromSecret requires a plaintext string — this is the narrowest
    // possible scope for the string conversion.
    return secret.consumeString((plainKey) => StellarSdk.Keypair.fromSecret(plainKey));
  } catch (err) {
    // Do not include the secret key value in the error message.
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
