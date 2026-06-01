/**
 * Pure simulation layer.
 *
 * Responsible for:
 *  - Building an unsigned transaction envelope from contract call parameters
 *  - Submitting it to the RPC simulateTransaction endpoint
 *  - Returning the raw simulation result (success or error) without decoding
 *
 * This layer has no knowledge of signing, decoding, or invocation orchestration.
 */

import {
  StellarSdk,
  SorobanNetwork,
  NETWORK_PASSPHRASES,
  buildRpcServer,
  resolveRpcUrl,
  isSimulationError,
  isSimulationSuccess,
  nativeToScVal,
  isScVal,
  SimulationSuccess,
} from "./sdkAdapter";
import {
  InvalidParamsError,
  SimulationError,
  SimulationErrorResponse,
} from "./errors";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SimulateParams {
  network: SorobanNetwork;
  rpcUrl?: string;
  contractId: string;
  method: string;
  args?: unknown[];
  /** Source account public key; a zero-sequence dummy is used when absent */
  sourcePublicKey?: string;
  /** Transaction timeout in seconds (default: 30) */
  timeoutSeconds?: number;
  /** Base fee in stroops (default: StellarSdk.BASE_FEE) */
  fee?: string;
}

export interface SimulationEstimates {
  minResourceFee: string;
  cpuInstructions: string;
  memoryBytes: string;
  /** XDR-encoded ledger footprint */
  footprintXdr: string;
}

export interface SimulationResult {
  /** Raw simulation response from the RPC */
  raw: SimulationSuccess;
  /** Gas / resource estimates when available */
  estimates?: SimulationEstimates;
  /** Auth entries required for this call */
  authEntries: unknown[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DUMMY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function normalizeArgs(args?: unknown[]): unknown[] {
  if (!args?.length) return [];
  return args.map((arg) => (isScVal(arg) ? arg : nativeToScVal(arg)));
}

function validateSimulateParams(p: SimulateParams): void {
  if (p.network !== "testnet" && p.network !== "mainnet") {
    throw new InvalidParamsError(
      `Invalid network "${p.network}". Must be "testnet" or "mainnet".`
    );
  }
  if (!p.contractId?.startsWith("C")) {
    throw new InvalidParamsError(
      `Invalid contractId "${p.contractId}". Soroban contract IDs start with "C".`
    );
  }
  if (!p.method) {
    throw new InvalidParamsError("method is required");
  }
}

// ─── Core simulation function ─────────────────────────────────────────────────

/**
 * Simulate a Soroban contract call and return the raw RPC result.
 *
 * Does NOT decode the return value or prepare signing data — those are
 * handled by the decoder and signingPrep layers respectively.
 */
export async function simulate(
  params: SimulateParams
): Promise<SimulationResult> {
  validateSimulateParams(params);

  const rpcUrl = resolveRpcUrl(params.network, params.rpcUrl);
  const server = buildRpcServer(rpcUrl);
  const passphrase = NETWORK_PASSPHRASES[params.network];

  const sourceKey = params.sourcePublicKey ?? DUMMY_SOURCE;
  const account = new StellarSdk.Account(sourceKey, "0");
  const contract = new StellarSdk.Contract(params.contractId);

  const normalizedArgs = normalizeArgs(params.args);
  const op = (
    contract as unknown as {
      call(method: string, ...args: unknown[]): unknown;
    }
  ).call(params.method, ...normalizedArgs);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: params.fee ?? StellarSdk.BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(op as never)
    .setTimeout(params.timeoutSeconds ?? 30)
    .build();

  let raw: unknown;
  try {
    raw = await server.simulateTransaction(
      tx as unknown as StellarSdk.Transaction
    );
  } catch (err) {
    throw new SimulationError(
      `RPC simulateTransaction call failed: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  if (isSimulationError(raw)) {
    throw new SimulationErrorResponse(raw.error);
  }

  if (!isSimulationSuccess(raw)) {
    throw new SimulationError("Unexpected simulation response shape");
  }

  const success = raw;

  // Extract resource estimates when present
  let estimates: SimulationEstimates | undefined;
  if (success.transactionData && success.minResourceFee) {
    try {
      const resources = success.transactionData.build().resources();
      estimates = {
        minResourceFee: success.minResourceFee,
        cpuInstructions: resources.instructions().toString(),
        memoryBytes: resources.readBytes().toString(),
        footprintXdr: success.transactionData.toXDR(),
      };
    } catch {
      // Resource extraction is best-effort; not all SDK versions expose it
    }
  }

  const authEntries: unknown[] = Array.isArray(success.result?.auth)
    ? (success.result!.auth as unknown[])
    : [];

  return { raw: success, estimates, authEntries };
}
