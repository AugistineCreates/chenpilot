// packages/sdk/src/xdr/errors.ts

/**
 * Sanitize and bound diagnostic messages so they never echo raw payloads or exceed buffer limits.
 */
export function sanitizeDiagnostic(
  message: string,
  maxLength: number = 256
): string {
  if (!message) return "XDR decoding failed: unknown error";

  // Replace newlines and excessive whitespace with a single space
  let sanitized = message.replace(/[\r\n\t]+/g, " ").trim();

  // Redact Stellar secret seed patterns first
  sanitized = sanitized.replace(/S[A-Z2-7]{55}/g, "<redacted_secret_key>");

  // Redact long hexadecimal or base64 sequences (potential payload echoes)
  sanitized = sanitized.replace(/[A-Za-z0-9+/=]{32,}/g, "<redacted_payload>");

  // Ensure diagnostic is strictly bounded to maxLength
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength - 3) + "...";
  }

  return sanitized;
}

/**
 * Base class for all XDR security & resource exhaustion errors.
 * Guarantees bounded message length and zero payload leakage.
 */
export class XdrSecurityError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    maxLength: number = 256
  ) {
    const boundedMessage = sanitizeDiagnostic(message, maxLength);
    super(boundedMessage);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details ? { ...details } : undefined;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when raw binary payload size exceeds allowed limit.
 */
export class XdrByteLimitExceededError extends XdrSecurityError {
  constructor(byteLength: number, limit: number, maxLength?: number) {
    super(
      "XDR_BYTE_LIMIT_EXCEEDED",
      `XDR decoding rejected: payload size (${byteLength} bytes) exceeds limit of ${limit} bytes`,
      { byteLength, limit },
      maxLength
    );
  }
}

/**
 * Thrown when base64 string length exceeds allowed limit.
 */
export class XdrBase64LimitExceededError extends XdrSecurityError {
  constructor(length: number, limit: number, maxLength?: number) {
    super(
      "XDR_BASE64_LIMIT_EXCEEDED",
      `XDR decoding rejected: base64 string length (${length}) exceeds limit of ${limit} characters`,
      { length, limit },
      maxLength
    );
  }
}

/**
 * Thrown when ScVal or XDR nesting depth exceeds maximum depth limit.
 */
export class XdrDepthLimitExceededError extends XdrSecurityError {
  constructor(depth: number, limit: number, maxLength?: number) {
    super(
      "XDR_DEPTH_LIMIT_EXCEEDED",
      `XDR decoding rejected: structural nesting depth (${depth}) exceeds maximum limit of ${limit}`,
      { depth, limit },
      maxLength
    );
  }
}

/**
 * Thrown when transaction operations exceed maximum allowed operation count.
 */
export class XdrOperationLimitExceededError extends XdrSecurityError {
  constructor(operationCount: number, limit: number, maxLength?: number) {
    super(
      "XDR_OPERATION_LIMIT_EXCEEDED",
      `XDR decoding rejected: operation count (${operationCount}) exceeds maximum allowed limit of ${limit}`,
      { operationCount, limit },
      maxLength
    );
  }
}

/**
 * Thrown when collection entries in a vec, map, or array exceed limits.
 */
export class XdrCollectionLimitExceededError extends XdrSecurityError {
  constructor(entryCount: number, limit: number, maxLength?: number) {
    super(
      "XDR_COLLECTION_LIMIT_EXCEEDED",
      `XDR decoding rejected: collection entry count (${entryCount}) exceeds maximum limit of ${limit}`,
      { entryCount, limit },
      maxLength
    );
  }
}

/**
 * Thrown when AST traversal exceeds computation step budget.
 */
export class XdrComputationLimitExceededError extends XdrSecurityError {
  constructor(steps: number, limit: number, maxLength?: number) {
    super(
      "XDR_COMPUTATION_LIMIT_EXCEEDED",
      `XDR decoding rejected: computational steps (${steps}) exceeded budget limit of ${limit}`,
      { steps, limit },
      maxLength
    );
  }
}

/**
 * Thrown when XDR is malformed, truncated, or contains invalid length fields.
 */
export class XdrMalformedError extends XdrSecurityError {
  constructor(reason: string, maxLength?: number) {
    super(
      "XDR_MALFORMED",
      `XDR decoding rejected: malformed payload structure or invalid length-field: ${reason}`,
      { reason },
      maxLength
    );
  }
}
