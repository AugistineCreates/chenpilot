// src/utils/xdr/types.ts

import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Security limits for XDR decoding across all backend and SDK runtimes.
 * Prevents memory exhaustion, stack overflow, quadratic iteration, and large allocations.
 */
export interface XdrSecurityLimits {
  /** Maximum allowed size in raw binary bytes (default: 256KB = 262,144 bytes) */
  maxByteLength: number;
  /** Maximum allowed size for base64 encoded strings (default: 350,000 chars) */
  maxBase64Length: number;
  /** Maximum recursion depth for nested structures like ScVal vec/map (default: 32) */
  maxDepth: number;
  /** Maximum number of operations allowed in a single transaction envelope (default: 100) */
  maxOperations: number;
  /** Maximum collection elements in vector / map ScVal entries (default: 1000) */
  maxCollectionEntries: number;
  /** Maximum computation budget (node visits / traversal operations) (default: 50,000) */
  maxComputationSteps: number;
  /** Maximum character length of sanitised error diagnostic messages (default: 256) */
  maxDiagnosticLength: number;
}

/**
 * Default security limits for standard operations and transaction envelopes.
 */
export const DEFAULT_XDR_LIMITS: Readonly<XdrSecurityLimits> = Object.freeze({
  maxByteLength: 256 * 1024, // 256 KB
  maxBase64Length: 350 * 1024, // ~350 KB
  maxDepth: 32,
  maxOperations: 100,
  maxCollectionEntries: 1000,
  maxComputationSteps: 50_000,
  maxDiagnosticLength: 256,
});

/**
 * Strict limits for unauthenticated endpoints, webhooks, or untrusted external inputs.
 */
export const STRICT_XDR_LIMITS: Readonly<XdrSecurityLimits> = Object.freeze({
  maxByteLength: 64 * 1024, // 64 KB
  maxBase64Length: 90 * 1024, // ~90 KB
  maxDepth: 16,
  maxOperations: 25,
  maxCollectionEntries: 200,
  maxComputationSteps: 10_000,
  maxDiagnosticLength: 128,
});

/**
 * Permissive limits for trusted ledger indexing or large historical contract state replays.
 */
export const PERMISSIVE_XDR_LIMITS: Readonly<XdrSecurityLimits> = Object.freeze({
  maxByteLength: 2 * 1024 * 1024, // 2 MB
  maxBase64Length: 3 * 1024 * 1024, // ~3 MB
  maxDepth: 64,
  maxOperations: 300,
  maxCollectionEntries: 5000,
  maxComputationSteps: 200_000,
  maxDiagnosticLength: 512,
});

/**
 * Options for safe XDR decoding functions.
 */
export interface SafeXdrDecodeOptions {
  /** Optional custom limits to override defaults */
  limits?: Partial<XdrSecurityLimits>;
  /** Network passphrase required when building full Transaction objects (default: Testnet) */
  networkPassphrase?: string;
}

/**
 * Result returned by safe tryDecode methods.
 */
export interface SafeTransactionDecodeResult<T = StellarSdk.Transaction | StellarSdk.FeeBumpTransaction> {
  success: boolean;
  transaction?: T;
  envelope?: StellarSdk.xdr.TransactionEnvelope;
  operationCount?: number;
  error?: string;
}

/**
 * Result returned by safe tryDecodeOperation methods.
 */
export interface SafeOperationDecodeResult<T = StellarSdk.xdr.Operation> {
  success: boolean;
  operation?: T;
  typeNumber?: number;
  typeName?: string;
  error?: string;
}
