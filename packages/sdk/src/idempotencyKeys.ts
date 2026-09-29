/**
 * Idempotency-key helpers for SDK operations.
 *
 * Keys are deterministic: equivalent requests produce the same key, while
 * requests for different operation types cannot collide. The serialized
 * request is canonicalized by sorting object keys recursively.
 */

export type IdempotencyScalar = string | number | boolean | null;

export type IdempotencyValue =
  | IdempotencyScalar
  | IdempotencyValue[]
  | { [key: string]: IdempotencyValue | undefined };

export interface BtcToStellarSwapIdempotencyRequest {
  bitcoinTransactionId: string;
  stellarDestination: string;
  amount: string;
  fromAsset?: string;
  toAsset?: string;
}

export interface StellarToBtcSwapIdempotencyRequest {
  stellarTransactionId: string;
  bitcoinDestination: string;
  amount: string;
  fromAsset?: string;
  toAsset?: string;
}

export interface MultiHopSwapIdempotencyRequest {
  sourceChain: string;
  destinationChain: string;
  sourceAsset: string;
  destinationAsset: string;
  amount: string;
  destinationAddress: string;
  hops: readonly string[];
}

export type LendingOperation =
  | "deposit"
  | "borrow"
  | "repay"
  | "withdraw"
  | "liquidate";

export interface LendingOperationIdempotencyRequest {
  operation: LendingOperation;
  protocol: string;
  userAddress: string;
  asset: string;
  amount?: string;
  positionId?: string;
  collateralAsset?: string;
  metadata?: { [key: string]: IdempotencyValue | undefined };
}

function canonicalize(value: IdempotencyValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as IdempotencyValue)}`);

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function encode(value: string): string {
  // Encode without relying on Node.js-only APIs so the SDK remains usable in
  // browser and server environments.
  const encoded = encodeURIComponent(value);
  return encoded.replace(/%([0-9A-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

function toBase64Url(value: string): string {
  const globalWithBtoa = globalThis as typeof globalThis & {
    btoa?: (input: string) => string;
  };

  if (typeof globalWithBtoa.btoa === "function") {
    return globalWithBtoa
      .btoa(encode(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  // Preserve percent escapes in the fallback. Removing percent signs would
  // make distinct strings such as "é" and "c3a9" collide.
  return encodeURIComponent(value);
}

function createKey(operation: string, request: IdempotencyValue): string {
  return `chenpilot:idempotency:v1:${operation}:${toBase64Url(canonicalize(request))}`;
}

/**
 * Creates the idempotency key for a BTC-to-Stellar swap.
 *
 * The Bitcoin transaction identifier is the source-side unique reference.
 */
export function createBtcToStellarSwapIdempotencyKey(
  request: BtcToStellarSwapIdempotencyRequest
): string {
  return createKey("btc-to-stellar-swap", request as unknown as IdempotencyValue);
}

/** Creates the idempotency key for a Stellar-to-BTC swap. */
export function createStellarToBtcSwapIdempotencyKey(
  request: StellarToBtcSwapIdempotencyRequest
): string {
  return createKey("stellar-to-btc-swap", request as unknown as IdempotencyValue);
}

/** Creates the idempotency key for a multi-hop swap. */
export function createMultiHopSwapIdempotencyKey(
  request: MultiHopSwapIdempotencyRequest
): string {
  return createKey("multi-hop-swap", request as unknown as IdempotencyValue);
}

/**
 * Creates the idempotency key for any supported lending operation.
 * Include positionId for operations against an existing position.
 */
export function createLendingOperationIdempotencyKey(
  request: LendingOperationIdempotencyRequest
): string {
  return createKey(`lending-${request.operation}`, request as unknown as IdempotencyValue);
}

/** Creates a deposit idempotency key. */
export function createLendingDepositIdempotencyKey(
  request: Omit<LendingOperationIdempotencyRequest, "operation">
): string {
  return createLendingOperationIdempotencyKey({ ...request, operation: "deposit" });
}

/** Creates a borrow idempotency key. */
export function createLendingBorrowIdempotencyKey(
  request: Omit<LendingOperationIdempotencyRequest, "operation">
): string {
  return createLendingOperationIdempotencyKey({ ...request, operation: "borrow" });
}

/** Creates a repay idempotency key. */
export function createLendingRepayIdempotencyKey(
  request: Omit<LendingOperationIdempotencyRequest, "operation">
): string {
  return createLendingOperationIdempotencyKey({ ...request, operation: "repay" });
}

/** Creates a withdraw idempotency key. */
export function createLendingWithdrawIdempotencyKey(
  request: Omit<LendingOperationIdempotencyRequest, "operation">
): string {
  return createLendingOperationIdempotencyKey({ ...request, operation: "withdraw" });
}

/** Creates a liquidation idempotency key. */
export function createLendingLiquidationIdempotencyKey(
  request: Omit<LendingOperationIdempotencyRequest, "operation">
): string {
  return createLendingOperationIdempotencyKey({ ...request, operation: "liquidate" });
}
