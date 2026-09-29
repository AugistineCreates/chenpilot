// src/utils/xdr/safeDecoder.ts

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
 * Safe, hardened XDR decoder for the Chenpilot backend.
 * Enforces pre-validation, byte bounds, depth limits, operation bounds,
 * computation budgeting, and sanitised non-leaking diagnostics.
 */
export class SafeXdrDecoder {
  /**
   * Safely decode a TransactionEnvelope from XDR string or Buffer with security bounds.
   */
  static decodeEnvelope(
    envelopeXdr: string | Buffer | Uint8Array,
    options: SafeXdrDecodeOptions = {}
  ): StellarSdk.xdr.TransactionEnvelope {
    const limits: XdrSecurityLimits = {
      ...DEFAULT_XDR_LIMITS,
      ...options.limits,
    };

    // Pre-validate length, base64 charset, and length headers
    const buffer = XdrPreValidator.validateAndNormalize(envelopeXdr, limits);

    let envelope: StellarSdk.xdr.TransactionEnvelope;
    try {
      envelope = StellarSdk.xdr.TransactionEnvelope.fromXDR(buffer);
    } catch (cause) {
      const sanitized = sanitizeDiagnostic(
        cause instanceof Error ? cause.message : "Invalid transaction envelope XDR",
        limits.maxDiagnosticLength
      );
      throw new XdrMalformedError(sanitized, limits.maxDiagnosticLength);
    }

    // Enforce operation limits on the decoded envelope
    const opCount = this.countOperationsInEnvelope(envelope);
    if (opCount > limits.maxOperations) {
      throw new XdrOperationLimitExceededError(
        opCount,
        limits.maxOperations,
        limits.maxDiagnosticLength
      );
    }

    return envelope;
  }

  /**
   * Safely decode a transaction into a high-level StellarSdk.Transaction object.
   */
  static decodeTransaction(
    envelopeXdr: string | Buffer | Uint8Array,
    options: SafeXdrDecodeOptions = {}
  ): StellarSdk.Transaction | StellarSdk.FeeBumpTransaction {
    const envelope = this.decodeEnvelope(envelopeXdr, options);
    const networkPassphrase =
      options.networkPassphrase ?? StellarSdk.Networks.TESTNET;

    try {
      return StellarSdk.TransactionBuilder.fromXDR(
        envelope.toXDR("base64"),
        networkPassphrase
      );
    } catch (cause) {
      const maxLen =
        options.limits?.maxDiagnosticLength ??
        DEFAULT_XDR_LIMITS.maxDiagnosticLength;
      const sanitized = sanitizeDiagnostic(
        cause instanceof Error ? cause.message : "Failed to build transaction from envelope",
        maxLen
      );
      throw new XdrMalformedError(sanitized, maxLen);
    }
  }

  /**
   * Safely try to decode a transaction without throwing unhandled exceptions.
   */
  static tryDecodeTransaction(
    envelopeXdr: string | Buffer | Uint8Array,
    options: SafeXdrDecodeOptions = {}
  ): SafeTransactionDecodeResult {
    try {
      const envelope = this.decodeEnvelope(envelopeXdr, options);
      const networkPassphrase =
        options.networkPassphrase ?? StellarSdk.Networks.TESTNET;
      const tx = StellarSdk.TransactionBuilder.fromXDR(
        envelope.toXDR("base64"),
        networkPassphrase
      );
      const operationCount = this.countOperationsInEnvelope(envelope);

      return {
        success: true,
        transaction: tx,
        envelope,
        operationCount,
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

    return safeScValToNative(scVal, limits);
  }

  /**
   * Count operations across different envelope types (V0, V1, FeeBump).
   */
  private static countOperationsInEnvelope(
    envelope: StellarSdk.xdr.TransactionEnvelope
  ): number {
    switch (envelope.switch()) {
      case StellarSdk.xdr.EnvelopeType.envelopeTypeTxV0():
        return envelope.v0().tx().operations().length;
      case StellarSdk.xdr.EnvelopeType.envelopeTypeTx():
        return envelope.v1().tx().operations().length;
      case StellarSdk.xdr.EnvelopeType.envelopeTypeTxFeeBump(): {
        const inner = envelope.feeBump().tx().innerTx();
        switch (inner.switch()) {
          case StellarSdk.xdr.EnvelopeType.envelopeTypeTx():
            return inner.v1().tx().operations().length;
          default:
            return 1;
        }
      }
      default:
        return 1;
    }
  }
}
