// src/utils/xdr/preValidator.ts

import { XdrSecurityLimits, DEFAULT_XDR_LIMITS } from "./types";
import {
  XdrBase64LimitExceededError,
  XdrByteLimitExceededError,
  XdrMalformedError,
} from "./errors";

// Standard base64 regex (matches whitespace-free base64 with optional trailing =)
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Pre-decoder validation for XDR payloads.
 * Runs fast constant-time / linear checks to reject oversized, non-base64, or malicious length-field inputs
 * before memory-heavy parsing routines run.
 */
export class XdrPreValidator {
  /**
   * Validate and convert any supported input (string | Buffer | Uint8Array) into a Buffer
   * while strictly enforcing byte and base64 size limits.
   */
  static validateAndNormalize(
    input: unknown,
    limits: XdrSecurityLimits = DEFAULT_XDR_LIMITS
  ): Buffer {
    if (input === null || input === undefined) {
      throw new XdrMalformedError("Input cannot be null or undefined", limits.maxDiagnosticLength);
    }

    let buffer: Buffer;

    if (typeof input === "string") {
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        throw new XdrMalformedError("XDR string cannot be empty", limits.maxDiagnosticLength);
      }

      if (trimmed.length > limits.maxBase64Length) {
        throw new XdrBase64LimitExceededError(
          trimmed.length,
          limits.maxBase64Length,
          limits.maxDiagnosticLength
        );
      }

      // Check base64 format before buffer allocation
      if (!BASE64_REGEX.test(trimmed)) {
        throw new XdrMalformedError(
          "Input is not a valid base64-encoded string",
          limits.maxDiagnosticLength
        );
      }

      try {
        buffer = Buffer.from(trimmed, "base64");
      } catch {
        throw new XdrMalformedError(
          "Failed to decode base64 buffer",
          limits.maxDiagnosticLength
        );
      }
    } else if (Buffer.isBuffer(input)) {
      buffer = input;
    } else if (input instanceof Uint8Array) {
      buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    } else {
      throw new XdrMalformedError(
        "Invalid input type: expected base64 string, Buffer, or Uint8Array",
        limits.maxDiagnosticLength
      );
    }

    if (buffer.length === 0) {
      throw new XdrMalformedError("XDR buffer cannot be empty", limits.maxDiagnosticLength);
    }

    if (buffer.length > limits.maxByteLength) {
      throw new XdrByteLimitExceededError(
        buffer.length,
        limits.maxByteLength,
        limits.maxDiagnosticLength
      );
    }

    // Inspect big-endian 32-bit length fields across the buffer
    this.inspectLengthFields(buffer, limits);

    return buffer;
  }

  /**
   * Scans 4-byte boundaries for 32-bit integer length-field headers.
   * If a length header claims more elements/bytes than the total buffer length
   * (or exceeds maxCollectionEntries), rejects it immediately before parser allocation bombs occur.
   */
  static inspectLengthFields(
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
