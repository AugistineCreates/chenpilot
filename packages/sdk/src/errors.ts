/**
 * Standardized error taxonomy for the Chen Pilot SDK.
 *
 * Every error carries:
 *  - category: one of six top-level categories clients can switch on
 *  - code:     machine-readable error code (no string parsing needed)
 *  - message:  human-readable description
 *  - recoverable: whether the caller can safely retry the operation
 *  - details:  optional structured metadata
 */

// ─── Error categories ─────────────────────────────────────────────────────────

export enum ErrorCategory {
  /** Network / connection / DNS / timeout failures */
  TRANSPORT = "TRANSPORT",
  /** Input schema, type, or constraint violations */
  VALIDATION = "VALIDATION",
  /** Contract or off-chain simulation failures */
  SIMULATION = "SIMULATION",
  /** Rate limits, permissions, KYC, governance rules */
  POLICY = "POLICY",
  /** Chain or contract incompatibility */
  COMPATIBILITY = "COMPATIBILITY",
  /** Transaction submission, signing, or runtime failures */
  EXECUTION = "EXECUTION",
  /** Catch-all for errors that don't fit above */
  UNKNOWN = "UNKNOWN",
}

// ─── Error specification ──────────────────────────────────────────────────────

export interface SdkErrorSpec {
  category: ErrorCategory;
  code: string;
  message: string;
  recoverable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

// ─── Base error class ─────────────────────────────────────────────────────────

export class SdkError extends Error {
  public readonly category: ErrorCategory;
  public readonly code: string;
  public readonly recoverable: boolean;
  public readonly details?: Record<string, unknown>;
  public readonly cause?: unknown;

  constructor(spec: SdkErrorSpec) {
    super(spec.message);
    this.name = "SdkError";
    this.category = spec.category;
    this.code = spec.code;
    this.recoverable = spec.recoverable ?? false;
    this.details = spec.details;
    this.cause = spec.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      category: this.category,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      details: this.details,
    };
  }
}

// ─── Helpers for checking error properties ────────────────────────────────────

export function isSdkError(error: unknown): error is SdkError {
  return error instanceof SdkError;
}

export function getErrorCategory(error: unknown): ErrorCategory {
  if (error instanceof SdkError) return error.category;
  if (error instanceof TypeError) return ErrorCategory.TRANSPORT;
  return ErrorCategory.UNKNOWN;
}

export function isRecoverableError(error: unknown): boolean {
  if (error instanceof SdkError) return error.recoverable;
  return false;
}

// ─── Standard transport errors ────────────────────────────────────────────────

export function transportError(
  message: string,
  details?: Record<string, unknown>,
): SdkError {
  return new SdkError({
    category: ErrorCategory.TRANSPORT,
    code: "TRANSPORT_ERROR",
    message,
    recoverable: true,
    details,
  });
}

export function connectionTimeoutError(
  message = "Connection timed out",
): SdkError {
  return new SdkError({
    category: ErrorCategory.TRANSPORT,
    code: "CONNECTION_TIMEOUT",
    message,
    recoverable: true,
  });
}

export function networkError(message = "Network error"): SdkError {
  return new SdkError({
    category: ErrorCategory.TRANSPORT,
    code: "NETWORK_ERROR",
    message,
    recoverable: true,
  });
}

// ─── Standard validation errors ───────────────────────────────────────────────

export function validationError(
  message: string,
  details?: Record<string, unknown>,
): SdkError {
  return new SdkError({
    category: ErrorCategory.VALIDATION,
    code: "VALIDATION_ERROR",
    message,
    details,
  });
}

export function invalidInputError(
  field: string,
  expected: string,
  received?: string,
): SdkError {
  return new SdkError({
    category: ErrorCategory.VALIDATION,
    code: "INVALID_INPUT",
    message: `Invalid input for '${field}': expected ${expected}${
      received !== undefined ? `, got ${received}` : ""
    }`,
    details: { field, expected, received },
  });
}

export function missingFieldError(field: string): SdkError {
  return new SdkError({
    category: ErrorCategory.VALIDATION,
    code: "MISSING_FIELD",
    message: `Missing required field: '${field}'`,
    details: { field },
  });
}

// ─── Standard simulation errors ───────────────────────────────────────────────

export function simulationError(
  message: string,
  details?: Record<string, unknown>,
): SdkError {
  return new SdkError({
    category: ErrorCategory.SIMULATION,
    code: "SIMULATION_ERROR",
    message,
    details,
  });
}

// ─── Standard policy errors ───────────────────────────────────────────────────

export function policyError(
  message: string,
  details?: Record<string, unknown>,
): SdkError {
  return new SdkError({
    category: ErrorCategory.POLICY,
    code: "POLICY_VIOLATION",
    message,
    details,
  });
}

export function rateLimitError(retryAfterMs?: number): SdkError {
  return new SdkError({
    category: ErrorCategory.POLICY,
    code: "RATE_LIMITED",
    message: retryAfterMs
      ? `Rate limited. Retry after ${retryAfterMs}ms`
      : "Rate limited",
    recoverable: true,
    details: retryAfterMs !== undefined ? { retryAfterMs } : undefined,
  });
}

export function unauthorizedError(message = "Unauthorized"): SdkError {
  return new SdkError({
    category: ErrorCategory.POLICY,
    code: "UNAUTHORIZED",
    message,
  });
}

// ─── Standard compatibility errors ────────────────────────────────────────────

export function compatibilityError(
  message: string,
  details?: Record<string, unknown>,
): SdkError {
  return new SdkError({
    category: ErrorCategory.COMPATIBILITY,
    code: "COMPATIBILITY_ERROR",
    message,
    details,
  });
}

export function unsupportedChainError(chainId: string): SdkError {
  return new SdkError({
    category: ErrorCategory.COMPATIBILITY,
    code: "UNSUPPORTED_CHAIN",
    message: `Unsupported chain: ${chainId}`,
    details: { chainId },
  });
}

export function unsupportedOperationError(operation: string): SdkError {
  return new SdkError({
    category: ErrorCategory.COMPATIBILITY,
    code: "UNSUPPORTED_OPERATION",
    message: `Unsupported operation: ${operation}`,
    details: { operation },
  });
}

// ─── Standard execution errors ────────────────────────────────────────────────

export function executionError(
  message: string,
  details?: Record<string, unknown>,
): SdkError {
  return new SdkError({
    category: ErrorCategory.EXECUTION,
    code: "EXECUTION_ERROR",
    message,
    details,
  });
}

export function signingError(message = "Signing failed"): SdkError {
  return new SdkError({
    category: ErrorCategory.EXECUTION,
    code: "SIGNING_ERROR",
    message,
  });
}

export function insufficientFundsError(
  message = "Insufficient funds",
): SdkError {
  return new SdkError({
    category: ErrorCategory.EXECUTION,
    code: "INSUFFICIENT_FUNDS",
    message,
  });
}
