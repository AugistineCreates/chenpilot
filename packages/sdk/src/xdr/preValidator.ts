// packages/sdk/src/xdr/preValidator.ts

import {
  XdrSecurityLimits,
  DEFAULT_XDR_LIMITS,
} from "./types";
import {
  XdrByteLimitExceededError,
  XdrBase64LimitExceededError,
  XdrMalformedError,
} from "./errors";

const BASE64_CHAR_REGEX = /^[A-Za-z0-9+/=_-]+$/;

/**
 * Validates and sanitizes raw input before passing to underlying XDR deserializers.
 */
export class XdrPreValidator {
  /**
   * Validate a base64 string or raw buffer against configured security limits.
   * Returns a Buffer ready for parsing, or throws an XdrSecurityError.
   */
  static validateAndNormalize(
    input: unknown,
    customLimits?: Partial<XdrSecurityLimits>
  ): Buffer {
    const limits: XdrSecurityLimits = {
      ...DEFAULT_XDR_LIMITS,
      ...customLimits,
    };

    if (input === null || input === undefined) {
      throw new XdrMalformedError("Input payload is null or undefined");
    }

    let buffer: Buffer;

    if (Buffer.isBuffer(input)) {
      buffer = input;
    } else if (input instanceof Uint8Array) {
      buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    } else if (typeof input === "string") {
      buffer = this.validateAndConvertBase64(input, limits);
    } else {
      throw new XdrMalformedError(
        `Invalid input type '${typeof input}', expected string or Buffer`
      );
    }

    // Validate raw byte length
    if (buffer.length > limits.maxByteLength) {
      throw new XdrByteLimitExceededError(
        buffer.length,
        limits.maxByteLength,
        limits.maxDiagnosticLength
      );
    }

    if (buffer.length === 0) {
      throw new XdrMalformedError("Input payload is empty (0 bytes)");
    }

    // Inspect structural length headers for length-field mismatch / allocation bomb attacks
    this.inspectLengthFields(buffer, limits);

    return buffer;
  }

  /**
   * Validates base64 string format and limits before buffer allocation.
   */
  private static validateAndConvertBase64(
    str: string,
    limits: XdrSecurityLimits
  ): Buffer {
    const trimmed = str.trim();

    if (trimmed.length > limits.maxBase64Length) {
      throw new XdrBase64LimitExceededError(
        trimmed.length,
        limits.maxBase64Length,
        limits.maxDiagnosticLength
      );
    }

    if (trimmed.length === 0) {
      throw new XdrMalformedError("Base64 string is empty");
    }

    if (!BASE64_CHAR_REGEX.test(trimmed)) {
      throw new XdrMalformedError(
        "Invalid characters in base64 XDR encoding"
      );
    }

    // Estimated binary length check before Buffer.from allocation
    const estimatedBytes = Math.ceil((trimmed.length * 3) / 4);
    if (estimatedBytes > limits.maxByteLength + 4) {
      throw new XdrByteLimitExceededError(
        estimatedBytes,
        limits.maxByteLength,
        limits.maxDiagnosticLength
      );
    }

    try {
      // Normalize URL-safe base64 if needed
      let normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
      while (normalized.length % 4 !== 0) {
        normalized += "=";
      }
      return Buffer.from(normalized, "base64");
    } catch (cause) {
      throw new XdrMalformedError(
        `Failed to decode base64 string: ${cause instanceof Error ? cause.message : "invalid encoding"}`
      );
    }
  }

  /**
   * Scan 32-bit big-endian length-field headers in binary XDR buffer.
   * Detects pathological lengths (e.g. 2 GB length claimed in a 10-byte buffer).
   */
  public static inspectLengthFields(
    buffer: Buffer,
    limits: XdrSecurityLimits = DEFAULT_XDR_LIMITS
  ): void {
    if (buffer.length < 4) {
      return;
    }

    // Check the primary length prefix at offset 0
    const topLength = buffer.readUInt32BE(0);
    if (
      topLength >= 0x7fffffff ||
      (topLength > limits.maxByteLength &&
        topLength > buffer.length * 10 &&
        topLength > 65536)
    ) {
      throw new XdrMalformedError(
        `Oversized length-field detected in XDR header: claimed length ${topLength} exceeds buffer capacity`,
        limits.maxDiagnosticLength
      );
    }
  }
}
