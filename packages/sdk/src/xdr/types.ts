// packages/sdk/src/xdr/types.ts

/**
 * Security limits enforced before and during XDR decoding to prevent
 * adversarial resource exhaustion (memory bomb, stack overflow, computation starvation).
 */
export interface XdrSecurityLimits {
  /**
   * Maximum allowable raw binary byte length for decoded XDR.
   * Default: 65,536 bytes (64 KB). Max safe limit: 1,048,576 bytes (1 MB).
   */
  maxByteLength: number;

  /**
   * Maximum allowable string length for base64-encoded XDR input.
   * Default: 88,000 characters (~64 KB decoded binary).
   */
  maxBase64Length: number;

  /**
   * Maximum allowed structural nesting depth during ScVal / AST traversal.
   * Prevents call stack exhaustion.
   * Default: 16. Max allowable: 32.
   */
  maxDepth: number;

  /**
   * Maximum allowed operations in a transaction envelope or batch.
   * Stellar network consensus protocol limit is 100.
   * Default: 100.
   */
  maxOperations: number;

  /**
   * Maximum elements allowed in any single collection (vec, map, array, claimants).
   * Default: 1,000.
   */
  maxCollectionEntries: number;

  /**
   * Maximum total computational steps / node visits across a single decode operation.
   * Default: 10,000.
   */
  maxComputationSteps: number;

  /**
   * Maximum character length of error diagnostic messages.
   * Ensures bounded log memory and prevents echoing large attacker payloads.
   * Default: 256.
   */
  maxDiagnosticLength: number;
}

/**
 * Default security limits for standard operations.
 */
export const DEFAULT_XDR_LIMITS: XdrSecurityLimits = {
  maxByteLength: 65536, // 64 KB
  maxBase64Length: 88000,
  maxDepth: 16,
  maxOperations: 100,
  maxCollectionEntries: 1000,
  maxComputationSteps: 10000,
  maxDiagnosticLength: 256,
};

/**
 * Strict limits for unauthenticated or public-facing API endpoints.
 */
export const STRICT_XDR_LIMITS: XdrSecurityLimits = {
  maxByteLength: 32768, // 32 KB
  maxBase64Length: 44000,
  maxDepth: 8,
  maxOperations: 25,
  maxCollectionEntries: 250,
  maxComputationSteps: 2500,
  maxDiagnosticLength: 128,
};

/**
 * Permissive limits for internal indexer / archive processing.
 */
export const PERMISSIVE_XDR_LIMITS: XdrSecurityLimits = {
  maxByteLength: 1048576, // 1 MB
  maxBase64Length: 1400000,
  maxDepth: 32,
  maxOperations: 100,
  maxCollectionEntries: 5000,
  maxComputationSteps: 50000,
  maxDiagnosticLength: 512,
};

/**
 * Options supplied to safe decoding functions.
 */
export interface SafeXdrDecodeOptions {
  /** Custom security limits (merged with DEFAULT_XDR_LIMITS) */
  limits?: Partial<XdrSecurityLimits>;
  /** Network passphrase for transaction hash calculation (e.g. Testnet or Public) */
  networkPassphrase?: string;
  /** Whether to throw on decoding errors (default: true) */
  strict?: boolean;
}

/**
 * Result of a safe transaction envelope decode.
 */
export interface SafeTransactionDecodeResult<T = unknown> {
  success: boolean;
  transaction?: T;
  operationCount: number;
  byteLength: number;
  error?: string;
}

/**
 * Result of a safe operation decode.
 */
export interface SafeOperationDecodeResult<T = unknown> {
  success: boolean;
  operation?: T;
  typeNumber?: number;
  typeName?: string;
  explanation?: string;
  error?: string;
}
