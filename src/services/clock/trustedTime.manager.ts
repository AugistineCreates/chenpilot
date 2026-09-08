import { injectable } from "tsyringe";
import logger from "../../config/logger";
import { ClockSkewService, clockSkewService } from "./clockSkew.service";
import { TrustedTimeComparison } from "./types";

/**
 * TrustedTimeManager: Centralizes all critical time comparisons.
 *
 * This service ensures that safety-critical decisions (JWT expiry, quote validity,
 * lease renewal, etc.) account for potential clock skew across the system.
 *
 * Pattern: Use this manager instead of direct Date comparisons for anything security-sensitive.
 *
 * Examples:
 * - JWT expiry checks
 * - Quote expiry validation
 * - Lock lease renewal
 * - Rate limit window checks
 * - Transaction deadline validation
 */

@injectable()
export class TrustedTimeManager {
  // Safety margin in milliseconds to add to all critical time comparisons
  private safetyMarginMs = 5000; // 5 seconds by default

  constructor(private clockSkew: ClockSkewService = clockSkewService) {}

  /**
   * Check if a timestamp has expired, accounting for clock skew.
   * Returns true if the timestamp is definitely expired (with safety margin).
   *
   * Example: expiry check for JWT or quote
   */
  hasExpired(expiryTime: Date, now?: Date): boolean {
    const currentTime = now || new Date();

    // Apply safety margin: consider expired if we're within margin of actual expiry
    const safeExpiryTime = new Date(
      expiryTime.getTime() - this.safetyMarginMs
    );

    const isExpired = currentTime > safeExpiryTime;

    if (isExpired) {
      logger.debug("Timestamp expired", {
        expiryTime: expiryTime.toISOString(),
        currentTime: currentTime.toISOString(),
        safetyMarginMs: this.safetyMarginMs,
      });
    }

    return isExpired;
  }

  /**
   * Check if a timestamp is still valid (not yet expired).
   * More conservative than hasExpired - errors on side of caution.
   */
  isValid(expiryTime: Date, now?: Date): boolean {
    return !this.hasExpired(expiryTime, now);
  }

  /**
   * Compare two times and determine if they're safely equal (within clock skew).
   * Useful when checking if times from different sources represent the same moment.
   */
  areTimesEqual(time1: Date, time2: Date, toleranceMs?: number): boolean {
    const diffMs = Math.abs(time2.getTime() - time1.getTime());
    const tolerance = toleranceMs ?? this.safetyMarginMs;

    return diffMs <= tolerance;
  }

  /**
   * Detailed comparison of two times with reasoning.
   */
  compareTimesDetailed(
    time1: Date,
    time2: Date,
    toleranceMs?: number
  ): TrustedTimeComparison {
    const diffMs = Math.abs(time2.getTime() - time1.getTime());
    const tolerance = toleranceMs ?? this.safetyMarginMs;
    const isSafe = diffMs <= tolerance;

    return {
      diffMs,
      isSafe,
      safetyMarginMs: tolerance,
      reason: isSafe
        ? `Times are within tolerance (${diffMs}ms <= ${tolerance}ms)`
        : `Times differ beyond tolerance (${diffMs}ms > ${tolerance}ms)`,
    };
  }

  /**
   * Get a deadline that's safe given current clock conditions.
   * Use this when creating time-bound operations (e.g., setting JWT expiry).
   *
   * Example: Create a JWT that expires in 15 minutes, accounting for clock drift
   */
  getFutureDeadline(durationMs: number): Date {
    // Subtract safety margin from the duration to ensure we're conservative
    const adjustedDurationMs = Math.max(0, durationMs - this.safetyMarginMs);
    return new Date(Date.now() + adjustedDurationMs);
  }

  /**
   * Get current time adjusted for clock skew.
   * Use for making comparisons with external system times.
   */
  getNow(): Date {
    return this.clockSkew.getTrustedNow();
  }

  /**
   * Set custom safety margin (in milliseconds).
   * Higher values are more conservative but less time-efficient.
   */
  setSafetyMargin(marginMs: number): void {
    if (marginMs < 0) {
      throw new Error("Safety margin cannot be negative");
    }
    this.safetyMarginMs = marginMs;
    logger.info("Safety margin updated", { marginMs });
  }

  /**
   * Get current safety margin being applied.
   */
  getSafetyMargin(): number {
    return this.safetyMarginMs;
  }

  /**
   * Check lease safety: ensure a lease hasn't expired accounting for skew.
   * Leases are time-based grants (e.g., distributed locks) that need extra care.
   */
  isLeaseSafe(leaseExpiryTime: Date, bufferMs?: number): boolean {
    const buffer = bufferMs ?? 2000; // 2 second default buffer
    const totalMargin = this.safetyMarginMs + buffer;

    const safeExpiryTime = new Date(leaseExpiryTime.getTime() - totalMargin);

    return new Date() < safeExpiryTime;
  }

  /**
   * Get the recommended renewal time for a lease before it expires.
   * Useful for distributed locks and similar time-based resources.
   */
  getLeaseRenewalDeadline(
    leaseExpiryTime: Date,
    renewalWindowMs?: number
  ): Date {
    const window = renewalWindowMs ?? 5000; // 5 second default window
    const totalMargin = this.safetyMarginMs + window;

    return new Date(leaseExpiryTime.getTime() - totalMargin);
  }

  /**
   * Validate that current time hasn't drifted too far from expected.
   * Returns true if within acceptable bounds.
   */
  isClockHealthy(): boolean {
    const skewStats = this.clockSkew.getStats();
    return skewStats.status !== "CRITICAL";
  }

  /**
   * Get diagnostic info about current time trust state.
   */
  getDiagnostics(): {
    safetyMarginMs: number;
    clockHealthy: boolean;
    maxSkewMs: number;
    currentTime: string;
    trustedTime: string;
  } {
    const skewStats = this.clockSkew.getStats();
    return {
      safetyMarginMs: this.safetyMarginMs,
      clockHealthy: this.isClockHealthy(),
      maxSkewMs: skewStats.maxOffsetMs,
      currentTime: new Date().toISOString(),
      trustedTime: this.getNow().toISOString(),
    };
  }
}

export const trustedTimeManager = new TrustedTimeManager();
