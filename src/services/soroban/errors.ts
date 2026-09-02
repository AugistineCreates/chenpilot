/**
 * Typed error hierarchy for the Soroban contract-execution subsystem.
 * Every error carries a machine-readable `code` so callers can branch
 * without string-matching error messages.
 */

export type SorobanErrorCode =
  | "INVALID_PARAMS"
  | "SDK_INIT_FAILED"
  | "SIMULATION_FAILED"
  | "SIMULATION_ERROR_RESPONSE"
  | "AUTH_REQUIRED"
  | "DECODE_FAILED"
  | "SIGNING_FAILED"
  | "NETWORK_MISMATCH"
  | "INVOCATION_FAILED"
  | "TTL_EXTENSION_FAILED"
  | "UNKNOWN";

/**
 * Top-level error categories shared with the SDK taxonomy.
 */
export type ErrorCategory =
  | "TRANSPORT"
  | "VALIDATION"
  | "SIMULATION"
  | "POLICY"
  | "COMPATIBILITY"
  | "EXECUTION"
  | "UNKNOWN";

/**
 * Maps a SorobanErrorCode to its top-level ErrorCategory.
 */
export function sorobanCodeToCategory(code: SorobanErrorCode): ErrorCategory {
  switch (code) {
    case "INVALID_PARAMS":
      return "VALIDATION";
    case "SDK_INIT_FAILED":
      return "COMPATIBILITY";
    case "SIMULATION_FAILED":
    case "SIMULATION_ERROR_RESPONSE":
      return "SIMULATION";
    case "AUTH_REQUIRED":
      return "POLICY";
    case "DECODE_FAILED":
      return "VALIDATION";
    case "SIGNING_FAILED":
      return "EXECUTION";
    case "NETWORK_MISMATCH":
      return "POLICY";
    case "INVOCATION_FAILED":
      return "EXECUTION";
    case "TTL_EXTENSION_FAILED":
      return "EXECUTION";
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

const categoryByCode: Record<SorobanErrorCode, ErrorCategory> = {
  INVALID_PARAMS: "VALIDATION",
  SDK_INIT_FAILED: "COMPATIBILITY",
  SIMULATION_FAILED: "SIMULATION",
  SIMULATION_ERROR_RESPONSE: "SIMULATION",
  AUTH_REQUIRED: "POLICY",
  DECODE_FAILED: "VALIDATION",
  SIGNING_FAILED: "EXECUTION",
  NETWORK_MISMATCH: "POLICY",
  INVOCATION_FAILED: "EXECUTION",
  TTL_EXTENSION_FAILED: "EXECUTION",
  UNKNOWN: "UNKNOWN",
};

export function getSorobanCategory(code: SorobanErrorCode): ErrorCategory {
  return categoryByCode[code] ?? "UNKNOWN";
}

export class SorobanError extends Error {
  readonly code: SorobanErrorCode;
  readonly errorCategory: ErrorCategory;
  readonly cause?: unknown;

  constructor(message: string, code: SorobanErrorCode, cause?: unknown) {
    super(message);
    this.name = "SorobanError";
    this.code = code;
    this.errorCategory = categoryByCode[code] ?? "UNKNOWN";
    this.cause = cause;
  }
}

export class InvalidParamsError extends SorobanError {
  constructor(message: string) {
    super(message, "INVALID_PARAMS");
    this.name = "InvalidParamsError";
  }
}

export class SdkInitError extends SorobanError {
  constructor(message: string, cause?: unknown) {
    super(message, "SDK_INIT_FAILED", cause);
    this.name = "SdkInitError";
  }
}

export class SimulationError extends SorobanError {
  constructor(message: string, cause?: unknown) {
    super(message, "SIMULATION_FAILED", cause);
    this.name = "SimulationError";
  }
}

export class SimulationErrorResponse extends SorobanError {
  constructor(detail: string) {
    super(
      `Soroban simulation returned error: ${detail}`,
      "SIMULATION_ERROR_RESPONSE"
    );
    this.name = "SimulationErrorResponse";
  }
}

export class AuthRequiredError extends SorobanError {
  constructor() {
    super(
      "Soroban invocation requires authorization; provide a secretKey to sign",
      "AUTH_REQUIRED"
    );
    this.name = "AuthRequiredError";
  }
}

export class DecodeError extends SorobanError {
  constructor(message: string, cause?: unknown) {
    super(message, "DECODE_FAILED", cause);
    this.name = "DecodeError";
  }
}

export class SigningError extends SorobanError {
  constructor(message: string, cause?: unknown) {
    super(message, "SIGNING_FAILED", cause);
    this.name = "SigningError";
  }
}

/**
 * Raised when a transaction was assembled with a network passphrase that does
 * not match the network the client is configured/verified for. This guard
 * sits between "assemble with a passphrase" and "sign the envelope", because
 * signing for the wrong network is irreversible.
 */
export class NetworkMismatchError extends SorobanError {
  readonly expectedNetwork?: string;
  readonly transactionNetwork?: string;

  constructor(opts?: {
    expectedNetwork?: string;
    transactionNetwork?: string;
  }) {
    const expected = opts?.expectedNetwork ?? "unknown";
    const transaction = opts?.transactionNetwork ?? "unknown";
    super(
      `Refusing to sign: the transaction network ("${transaction}") does not match ` +
        `the client network ("${expected}"). No signature was produced.`,
      "NETWORK_MISMATCH"
    );
    this.name = "NetworkMismatchError";
    this.expectedNetwork = opts?.expectedNetwork;
    this.transactionNetwork = opts?.transactionNetwork;
  }
}

export class InvocationError extends SorobanError {
  constructor(message: string, cause?: unknown) {
    super(message, "INVOCATION_FAILED", cause);
    this.name = "InvocationError";
  }
}
