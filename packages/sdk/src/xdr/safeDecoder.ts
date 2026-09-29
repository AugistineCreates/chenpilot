// packages/sdk/src/xdr/safeDecoder.ts

import * as StellarSdk from "@stellar/stellar-sdk";
import {
  XdrSecurityLimits,
  DEFAULT_XDR_LIMITS,
  SafeXdrDecodeOptions,
  SafeTransactionDecodeResult,
  SafeOperationDecodeResult,
} from "./types";
import {
  XdrOperationLimitExceededError,
  XdrMalformedError,
  sanitizeDiagnostic,
} from "./errors";
import { XdrPreValidator } from "./preValidator";
import { safeScValToNative } from "./safeScVal";

/**
 * Hardened XDR decoder that enforces byte, depth, operation, collection, and computation
 * limits before and during parsing across all Stellar data structures.
 */
export class SafeXdrDecoder {
  /**
   * Safely decode a Stellar Transaction from XDR (base64 string or binary Buffer).
   * Enforces pre-check byte limits and operation count bounds.
   */
  static decodeTransaction(
    xdrInput: string | Buffer | Uint8Array,
    options: SafeXdrDecodeOptions = {}
  ): StellarSdk.Transaction {
    const limits: XdrSecurityLimits = {
      ...DEFAULT_XDR_LIMITS,
      ...options.limits,
    };

    // 1. Pre-validation and buffer sanitization
    const buffer = XdrPreValidator.validateAndNormalize(xdrInput, limits);

    // 2. Decode transaction using SDK
    const networkPassphrase =
      options.networkPassphrase ?? StellarSdk.Networks.TESTNET;
    const base64Str = buffer.toString("base64");

    let tx: StellarSdk.Transaction;
    try {
      tx = new StellarSdk.Transaction(base64Str, networkPassphrase);
    } catch (cause) {
      const sanitized = sanitizeDiagnostic(
        cause instanceof Error ? cause.message : "Invalid transaction XDR",
        limits.maxDiagnosticLength
      );
      throw new XdrMalformedError(sanitized, limits.maxDiagnosticLength);
    }

    // 3. Operation count enforcement
    if (tx.operations && tx.operations.length > limits.maxOperations) {
      throw new XdrOperationLimitExceededError(
        tx.operations.length,
        limits.maxOperations,
        limits.maxDiagnosticLength
      );
    }

    return tx;
  }

  /**
   * Safely decode a transaction envelope with non-throwing result structure.
   */
  static tryDecodeTransaction(
    xdrInput: string | Buffer | Uint8Array,
    options: SafeXdrDecodeOptions = {}
  ): SafeTransactionDecodeResult<StellarSdk.Transaction> {
    try {
      const buffer = XdrPreValidator.validateAndNormalize(
        xdrInput,
        options.limits
      );
      const tx = this.decodeTransaction(buffer, options);
      return {
        success: true,
        transaction: tx,
        operationCount: tx.operations ? tx.operations.length : 0,
        byteLength: buffer.length,
      };
    } catch (err) {
      const maxLen =
        options.limits?.maxDiagnosticLength ??
        DEFAULT_XDR_LIMITS.maxDiagnosticLength;
      return {
        success: false,
        operationCount: 0,
        byteLength: 0,
        error: sanitizeDiagnostic(
          err instanceof Error ? err.message : String(err),
          maxLen
        ),
      };
    }
  }

  /**
   * Safely decode a single Stellar Operation from XDR.
   */
  static decodeOperation(
    operationXdr: string | Buffer | Uint8Array,
    options: SafeXdrDecodeOptions = {}
  ): StellarSdk.xdr.Operation {
    const limits: XdrSecurityLimits = {
      ...DEFAULT_XDR_LIMITS,
      ...options.limits,
    };

    const buffer = XdrPreValidator.validateAndNormalize(operationXdr, limits);

    try {
      return StellarSdk.xdr.Operation.fromXDR(buffer);
    } catch (cause) {
      const sanitized = sanitizeDiagnostic(
        cause instanceof Error ? cause.message : "Invalid operation XDR",
        limits.maxDiagnosticLength
      );
      throw new XdrMalformedError(sanitized, limits.maxDiagnosticLength);
    }
  }

  /**
   * Safely decode and describe a single Stellar Operation.
   */
  static tryDecodeOperation(
    operationXdr: string | Buffer | Uint8Array,
    options: SafeXdrDecodeOptions = {}
  ): SafeOperationDecodeResult<StellarSdk.xdr.Operation> {
    try {
      const op = this.decodeOperation(operationXdr, options);
      const switchVal = op.body().switch();
      return {
        success: true,
        operation: op,
        typeNumber: typeof switchVal.value === "number" ? switchVal.value : undefined,
        typeName: switchVal.name,
      };
    } catch (err) {
      const maxLen =
        options.limits?.maxDiagnosticLength ??
        DEFAULT_XDR_LIMITS.maxDiagnosticLength;
      return {
        success: false,
        error: sanitizeDiagnostic(
          err instanceof Error ? err.message : String(err),
          maxLen
        ),
      };
    }
  }

  /**
   * Safely decode an ScVal from XDR and convert to native JavaScript value.
   */
  static decodeScVal(
    scValInput: string | Buffer | Uint8Array,
    options: SafeXdrDecodeOptions = {}
  ): unknown {
    const limits: XdrSecurityLimits = {
      ...DEFAULT_XDR_LIMITS,
      ...options.limits,
    };

    const buffer = XdrPreValidator.validateAndNormalize(scValInput, limits);

    let scVal: StellarSdk.xdr.ScVal;
    try {
      scVal = StellarSdk.xdr.ScVal.fromXDR(buffer);
    } catch (cause) {
      const sanitized = sanitizeDiagnostic(
        cause instanceof Error ? cause.message : "Invalid ScVal XDR",
        limits.maxDiagnosticLength
      );
      throw new XdrMalformedError(sanitized, limits.maxDiagnosticLength);
    }

    return safeScValToNative(scVal, options);
  }
}
