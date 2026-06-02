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
  | "INVOCATION_FAILED"
  | "TTL_EXTENSION_FAILED"
  | "UNKNOWN";

export class SorobanError extends Error {
  readonly code: SorobanErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: SorobanErrorCode, cause?: unknown) {
    super(message);
    this.name = "SorobanError";
    this.code = code;
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

export class InvocationError extends SorobanError {
  constructor(message: string, cause?: unknown) {
    super(message, "INVOCATION_FAILED", cause);
    this.name = "InvocationError";
  }
}
