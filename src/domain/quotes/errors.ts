// chenpilot/src/domain/quotes/errors.ts
// Issue #625 — Fail-closed error types for quote commitment enforcement.

/**
 * Thrown when the live execution parameters produce a SHA-256 digest that
 * differs from the digest the user originally approved.
 *
 * This is the primary fail-closed mechanism: if route, price, fees,
 * slippage, or any other commitment field has drifted since approval,
 * execution is blocked and the caller must obtain a fresh quote and
 * re-approval before retrying.
 *
 * @example
 * ```ts
 * import { QuoteDriftError } from '@chen-pilot/sdk-core';
 *
 * try {
 *   await executeTrade(plan);
 * } catch (err) {
 *   if (err instanceof QuoteDriftError) {
 *     // Present the user with a requote prompt
 *     const freshQuote = await requestNewQuote(params);
 *     // ... obtain new approval ...
 *   }
 * }
 * ```
 */
export class QuoteDriftError extends Error {
  public readonly code = "QUOTE_DRIFT" as const;
  public readonly approvedDigest: string;
  public readonly liveDigest: string;

  constructor(approvedDigest: string, liveDigest: string) {
    super(
      `Quote drift detected: approved digest ${approvedDigest.slice(0, 12)}… ` +
        `does not match live digest ${liveDigest.slice(0, 12)}…. ` +
        `A new approval is required before execution can proceed.`
    );
    this.name = "QuoteDriftError";
    this.approvedDigest = approvedDigest;
    this.liveDigest = liveDigest;
  }
}

/**
 * Thrown when execution is attempted after the quote commitment deadline
 * has elapsed.  The caller must request a fresh quote.
 *
 * @example
 * ```ts
 * import { QuoteExpiredError } from '@chen-pilot/sdk-core';
 *
 * try {
 *   await executeTrade(plan);
 * } catch (err) {
 *   if (err instanceof QuoteExpiredError) {
 *     console.log(`Quote expired at ${err.expiredAt.toISOString()}`);
 *     const freshQuote = await requestNewQuote(params);
 *   }
 * }
 * ```
 */
export class QuoteExpiredError extends Error {
  public readonly code = "QUOTE_EXPIRED" as const;
  public readonly deadline: number;
  public readonly expiredAt: Date;

  constructor(deadline: number) {
    const expiredAt = new Date(deadline * 1000);
    super(
      `Quote commitment expired at ${expiredAt.toISOString()}. ` +
        `Please request a new quote and obtain approval before retrying.`
    );
    this.name = "QuoteExpiredError";
    this.deadline = deadline;
    this.expiredAt = expiredAt;
  }
}
