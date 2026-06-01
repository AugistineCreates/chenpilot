// ─── Contract-execution subsystem ────────────────────────────────────────────
export type { SorobanNetwork } from "./sdkAdapter";
export {
  DEFAULT_RPC_URLS,
  NETWORK_PASSPHRASES,
  resolveRpcUrl,
} from "./sdkAdapter";

export type { InvokeContractParams, InvokeContractResult } from "./invoker";
export { invokeContract, estimateContract } from "./invoker";

export type {
  SimulateParams,
  SimulationEstimates,
  SimulationResult,
} from "./simulator";
export { simulate } from "./simulator";

export { decodeReturnValue, decodeScVal } from "./decoder";

export {
  requiresSigning,
  assertSigningNotRequired,
  prepareSignedTransaction,
} from "./signingPrep";
export type { SigningContext, AssembledTransaction } from "./signingPrep";

export {
  SorobanError,
  InvalidParamsError,
  SdkInitError,
  SimulationError,
  SimulationErrorResponse,
  AuthRequiredError,
  DecodeError,
  SigningError,
  InvocationError,
} from "./errors";
export type { SorobanErrorCode } from "./errors";

// ─── Existing subsystem modules ───────────────────────────────────────────────
export * from "./ttlManager";
export * from "./swapLock";
export * from "./reentrancyGuard";
export * from "./xdrScoping";
