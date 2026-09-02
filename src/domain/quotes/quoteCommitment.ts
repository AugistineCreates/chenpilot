// chenpilot/src/domain/quotes/quoteCommitment.ts
// Issue #625 — Cryptographic quote commitment digest
// Binds simulation, approval, and execution to a single immutable economic intent.

import crypto from "crypto";
import { QuoteDriftError, QuoteExpiredError } from "./errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Complete economic intent that a user approves before execution.
 *
 * Every field that could materially affect the trade outcome is included
 * so that any drift between quote-time and execution-time is detectable.
 * The digest of this payload is the **single source of truth** that
 * simulation, approval, and execution all reference.
 *
 * ### Lifecycle
 *
 * 1. **Simulation** — the backend builds a `QuoteCommitmentPayload` from
 *    the best available route, price, and fee data, then calls
 *    {@link generateQuoteDigest} to produce an immutable SHA-256 digest.
 * 2. **Approval** — the digest and deadline are presented to the user.
 *    Accepting the quote is equivalent to signing this digest.
 * 3. **Execution** — immediately before submitting the on-chain
 *    transaction, the executor rebuilds the payload from *live* data and
 *    calls {@link validateQuoteCommitment}.  If any field has drifted the
 *    live digest will differ and a {@link QuoteDriftError} is thrown.
 *
 * ### Requote flow (SDK clients)
 *
 * When a `QuoteDriftError` or `QuoteExpiredError` is caught the SDK
 * should:
 *
 * 1. Discard the stale quote.
 * 2. Request a new quote via the `/quote` endpoint.
 * 3. Present the updated terms to the user for re-approval.
 * 4. Retry execution with the freshly approved digest.
 *
 * ### Expiration window
 *
 * The `deadline` field is a Unix-epoch timestamp (seconds).  A
 * recommended default is **30 seconds** for DEX swaps and **120 seconds**
 * for multi-hop routes.  Clients may override this within the bounds
 * enforced by the backend.
 *
 * @example
 * ```ts
 * import {
 *   QuoteCommitmentPayload,
 *   generateQuoteDigest,
 *   validateQuoteCommitment,
 * } from '@chen-pilot/sdk-core';
 *
 * const payload: QuoteCommitmentPayload = {
 *   fromAsset: 'XLM',
 *   toAsset:   'USDC',
 *   fromAmount: '100.0000000',
 *   toAmount:   '12.3456789',
 *   route:     ['XLM', 'USDC'],
 *   fees:      '0.0000100',
 *   deadline:  Math.floor(Date.now() / 1000) + 30,
 *   network:   'Test SDF Network ; September 2015',
 *   slippage:  1.0,
 * };
 *
 * const digest = generateQuoteDigest(payload);
 *
 * // Later, at execution time:
 * validateQuoteCommitment(digest, payload); // throws on drift or expiry
 * ```
 */
export interface QuoteCommitmentPayload {
  /** Source asset identifier (e.g. `"XLM"`, `"USDC"`, `"CODE:ISSUER"`) */
  fromAsset: string;
  /** Destination asset identifier */
  toAsset: string;
  /** Exact source amount as a decimal string (stroops-safe) */
  fromAmount: string;
  /** Expected destination amount as a decimal string */
  toAmount: string;
  /** Ordered route path — asset codes or pool IDs traversed */
  route: string[];
  /**
   * Total fees (network + DEX) as a decimal string.
   * Includes base fee and any fee-bump component.
   */
  fees: string;
  /**
   * Unix-epoch **seconds** after which this commitment is void.
   * Execution past this point will throw {@link QuoteExpiredError}.
   */
  deadline: number;
  /** Network identifier — typically the Stellar network passphrase */
  network: string;
  /**
   * Maximum tolerable slippage as a percentage.
   * `1.0` means 1 %.  Used to compute `destMin` in path-payment ops.
   */
  slippage: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const HASH_ALGORITHM = "sha256";
const COMMITMENT_VERSION = "1";

/**
 * Recursively sort all object keys so that field-insertion order
 * can never change the serialised form.
 * @internal
 */
function sortObjectKeys(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>)
      .sort()
      .forEach((key) => {
        sorted[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
      });
    return sorted;
  }

  // Primitives pass through untouched
  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic SHA-256 hex digest of the full economic intent.
 *
 * The digest is computed over a version-tagged, canonicalised JSON string:
 *
 * ```
 * SHA-256( JSON.stringify({ v: "1", ...sortedPayload }) )
 * ```
 *
 * Identical payloads always yield the same digest regardless of
 * property-insertion order.  Changing **any** field — even whitespace in
 * an amount string — produces a completely different hash, which is the
 * mechanism that lets the executor reject drifted quotes.
 *
 * @param payload - The full quote commitment to hash.
 * @returns 64-char lowercase hex SHA-256 digest.
 *
 * @see {@link validateQuoteCommitment} for the fail-closed verification gate.
 * @see {@link verifyQuoteDigest} for a boolean-only comparison.
 */
export function generateQuoteDigest(payload: QuoteCommitmentPayload): string {
  // Tag with a version so we can evolve the canonical form without
  // silently producing collisions against older digests.
  const envelope = {
    v: COMMITMENT_VERSION,
    ...payload,
  };

  const canonical = JSON.stringify(sortObjectKeys(envelope));

  return crypto.createHash(HASH_ALGORITHM).update(canonical).digest("hex");
}

/**
 * Verify that a previously recorded digest still matches a payload.
 *
 * This is a **soft** check — it returns a boolean rather than throwing.
 * Prefer {@link validateQuoteCommitment} for fail-closed enforcement in
 * execution paths.
 *
 * @param digest   - The hex digest produced at quote / approval time.
 * @param payload  - The payload presented at execution time.
 * @returns `true` only when the payload reproduces the exact same digest.
 */
export function verifyQuoteDigest(
  digest: string,
  payload: QuoteCommitmentPayload
): boolean {
  return generateQuoteDigest(payload) === digest;
}

/**
 * **Fail-closed** validation gate for the execution phase.
 *
 * Call this immediately before submitting an on-chain transaction.
 * It checks two conditions and throws on the first violation:
 *
 * 1. **Deadline** — if `Date.now()` is past `livePayload.deadline`,
 *    a {@link QuoteExpiredError} is thrown.
 * 2. **Digest match** — if the SHA-256 digest of `livePayload` differs
 *    from `approvedDigest`, a {@link QuoteDriftError} is thrown.
 *
 * If both checks pass the function returns `void` and execution may
 * proceed.
 *
 * @param approvedDigest - The digest the user approved during the
 *                         approval phase.
 * @param livePayload    - The commitment payload rebuilt from current
 *                         (live) market data at execution time.
 *
 * @throws {QuoteExpiredError} When the commitment deadline has elapsed.
 * @throws {QuoteDriftError}   When any commitment field has changed.
 *
 * @example
 * ```ts
 * // Inside SwapTool.executeWithLock():
 * validateQuoteCommitment(payload.approvedDigest, liveCommitment);
 * // If we reach here, it's safe to submit the transaction.
 * ```
 */
export function validateQuoteCommitment(
  approvedDigest: string,
  livePayload: QuoteCommitmentPayload
): void {
  // 1. Deadline check — fast-fail before doing any hashing
  const nowEpochSec = Math.floor(Date.now() / 1000);
  if (nowEpochSec > livePayload.deadline) {
    throw new QuoteExpiredError(livePayload.deadline);
  }

  // 2. Digest comparison — detect any field-level drift
  const liveDigest = generateQuoteDigest(livePayload);
  if (liveDigest !== approvedDigest) {
    throw new QuoteDriftError(approvedDigest, liveDigest);
  }
}
