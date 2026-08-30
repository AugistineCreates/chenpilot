// src/utils/xdr/errors.ts

/**
 * Strips secrets, raw hex/base64 payload fragments, and clamp messages
 * to ensure that rejected input returns a bounded diagnostic without leaking data.
 */
export function sanitizeDiagnostic(message: string, maxLen: number = 256): string {
  if (!message || typeof message !== "string") {
    return "XDR decoding failed";
  }

  // Redact Stellar secret seed patterns first
  let clean = message.replace(/S[A-Z2-7]{55}/g, "<redacted_secret_key>");

  // Redact long hexadecimal or base64 sequences (potential payload echoes)
  clean = clean.replace(/[A-Za-z0-9+/=]{32,}/g, "<redacted_payload>");

  // Collapse multiple whitespace and newlines
  clean = clean.replace(/\s+/g, " ").trim();

  // Clamp to maxLen
  if (clean.length > maxLen) {
    clean = clean.slice(0, maxLen - 3) + "...";
  }

  return clean || "XDR decoding failed";
}

/**
 * Base security error class for all XDR bounds and decoding violations.
 */
export class XdrSecurityError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = "XDR_SECURITY_VIOLATION", maxLen: number = 256) {
    super(sanitizeDiagnostic(message, maxLen));
    this.name = "XdrSecurityError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class XdrByteLimitExceededError extends XdrSecurityError {
  constructor(size: number, limit: number, maxLen: number = 256) {
    super(
      `XDR binary byte length (${size} bytes) exceeds maximum allowed limit (${limit} bytes)`,
      "XDR_BYTE_LIMIT_EXCEEDED",
      maxLen
    );
    this.name = "XdrByteLimitExceededError";
  }
}

export class XdrBase64LimitExceededError extends XdrSecurityError {
  constructor(length: number, limit: number, maxLen: number = 256) {
    super(
      `XDR base64 string length (${length} chars) exceeds maximum allowed limit (${limit} chars)`,
      "XDR_BASE64_LIMIT_EXCEEDED",
      maxLen
    );
    this.name = "XdrBase64LimitExceededError";
  }
}

export class XdrDepthLimitExceededError extends XdrSecurityError {
  constructor(depth: number, limit: number, maxLen: number = 256) {
    super(
      `XDR recursion depth (${depth}) exceeds maximum nesting limit (${limit})`,
      "XDR_DEPTH_LIMIT_EXCEEDED",
      maxLen
    );
    this.name = "XdrDepthLimitExceededError";
  }
}

export class XdrOperationLimitExceededError extends XdrSecurityError {
  constructor(count: number, limit: number, maxLen: number = 256) {
    super(
      `Transaction contains ${count} operations, exceeding limit of ${limit}`,
      "XDR_OPERATION_LIMIT_EXCEEDED",
      maxLen
    );
    this.name = "XdrOperationLimitExceededError";
  }
}

export class XdrCollectionLimitExceededError extends XdrSecurityError {
  constructor(entries: number, limit: number, maxLen: number = 256) {
    super(
      `XDR collection contains ${entries} entries, exceeding maximum allowed (${limit})`,
      "XDR_COLLECTION_LIMIT_EXCEEDED",
      maxLen
    );
    this.name = "XdrCollectionLimitExceededError";
  }
}

export class XdrComputationLimitExceededError extends XdrSecurityError {
  constructor(steps: number, limit: number, maxLen: number = 256) {
    super(
      `XDR decoding exceeded computation budget (${steps} >= ${limit} steps)`,
      "XDR_COMPUTATION_LIMIT_EXCEEDED",
      maxLen
    );
    this.name = "XdrComputationLimitExceededError";
  }
}

export class XdrMalformedError extends XdrSecurityError {
  constructor(details: string = "Malformed or invalid XDR payload", maxLen: number = 256) {
    super(details, "XDR_MALFORMED", maxLen);
    this.name = "XdrMalformedError";
  }
}
