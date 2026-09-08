import { injectable } from "tsyringe";
import logger from "../../config/logger";
import {
  ClockSample,
  ClockOffset,
  ClockSkewStats,
  ClockSkewConfig,
} from "./types";

/**
 * ClockSkewService: Measures and tracks clock offset across nodes.
 * 
 * Provides metrics for detecting system clock skew which can cause:
 * - JWT expiry issues
 * - Quote expiry problems
 * - Lock lease safety violations
 * - Cross-node coordination failures
 * 
 * Usage:
 * - Call recordSample() when obtaining time from external sources
 * - Query getStats() to determine current health
 * - Use getTrustedTime() for safety-critical comparisons
 */

@injectable()
export class ClockSkewService {
  private samples: ClockSample[] = [];
  private offsets: Map<string, ClockOffset> = new Map();

  private readonly config: ClockSkewConfig = {
    degradedThresholdMs: 5000, // 5 seconds
    criticalThresholdMs: 30000, // 30 seconds
    maxHistorySamples: 100,
    minSamplesForStats: 3,
  };

  constructor(config?: Partial<ClockSkewConfig>) {
    if (config) {
      Object.assign(this.config, config);
    }
  }

  /**
   * Record a clock sample from an external source.
   * Useful when receiving timestamps from Horizon, peer nodes, NTP, etc.
   */
  recordSample(sample: ClockSample): void {
    const offsetMs = sample.remoteTime.getTime() - sample.localTime.getTime();

    // Trim history if needed
    if (this.samples.length >= this.config.maxHistorySamples) {
      this.samples = this.samples.slice(-this.config.maxHistorySamples + 1);
    }

    this.samples.push(sample);

    // Update per-source offset tracking
    const existingOffset = this.offsets.get(sample.source);
    const newOffset: ClockOffset = {
      offsetMs,
      trusted: this.isTrustedSource(sample.source),
      lastUpdated: new Date(),
      sampleCount: (existingOffset?.sampleCount ?? 0) + 1,
    };

    this.offsets.set(sample.source, newOffset);

    logger.debug("Clock sample recorded", {
      source: sample.source,
      offsetMs,
      trusted: newOffset.trusted,
    });
  }

  /**
   * Get current clock skew statistics across all sources.
   */
  getStats(): ClockSkewStats {
    const offsets = Array.from(this.offsets.values());

    if (offsets.length === 0) {
      return {
        maxOffsetMs: 0,
        minOffsetMs: 0,
        medianOffsetMs: 0,
        stdDeviation: 0,
        status: "HEALTHY",
        computedAt: new Date(),
      };
    }

    const offsetValues = offsets.map((o) => o.offsetMs).sort((a, b) => a - b);
    const maxOffsetMs = Math.max(...offsetValues.map(Math.abs));
    const minOffsetMs = Math.min(...offsetValues.map(Math.abs));
    const medianOffsetMs =
      offsetValues[Math.floor(offsetValues.length / 2)];

    // Calculate standard deviation
    const mean = offsetValues.reduce((a, b) => a + b, 0) / offsetValues.length;
    const variance =
      offsetValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      offsetValues.length;
    const stdDeviation = Math.sqrt(variance);

    let status: "HEALTHY" | "DEGRADED" | "CRITICAL" = "HEALTHY";
    if (maxOffsetMs > this.config.criticalThresholdMs) {
      status = "CRITICAL";
    } else if (maxOffsetMs > this.config.degradedThresholdMs) {
      status = "DEGRADED";
    }

    return {
      maxOffsetMs,
      minOffsetMs,
      medianOffsetMs,
      stdDeviation,
      status,
      computedAt: new Date(),
    };
  }

  /**
   * Get offset for a specific source.
   */
  getOffsetForSource(source: string): ClockOffset | undefined {
    return this.offsets.get(source);
  }

  /**
   * Get all tracked sources and their offsets.
   */
  getAllOffsets(): Map<string, ClockOffset> {
    return new Map(this.offsets);
  }

  /**
   * Determine if two times are safely comparable given current skew.
   * Adds safety margin to account for potential clock drift.
   */
  isSafeComparison(time1: Date, time2: Date): boolean {
    const stats = this.getStats();
    const diffMs = Math.abs(time2.getTime() - time1.getTime());

    // Safety margin: max offset + 1 second buffer
    const safetyMarginMs = Math.abs(stats.medianOffsetMs) + 1000;

    return diffMs > safetyMarginMs;
  }

  /**
   * Get trusted current time accounting for measured skew.
   * Use this for safety-critical time checks (JWT expiry, quote expiry, etc).
   */
  getTrustedNow(): Date {
    const stats = this.getStats();

    // If we have significant skew, adjust our "now" forward by median offset
    // This is conservative: we assume time might be behind
    const adjustmentMs = Math.max(0, stats.medianOffsetMs);

    return new Date(Date.now() + adjustmentMs);
  }

  /**
   * Get the safety margin to apply for time-critical operations.
   */
  getSafetyMargin(): number {
    const stats = this.getStats();
    // Conservative: use absolute max offset + 2 second buffer
    return Math.abs(stats.maxOffsetMs) + 2000;
  }

  /**
   * Check if current skew poses safety risk.
   */
  isSkewCritical(): boolean {
    const stats = this.getStats();
    return stats.status === "CRITICAL";
  }

  /**
   * Reset all tracking data (useful for testing/diagnostics).
   */
  reset(): void {
    this.samples = [];
    this.offsets.clear();
  }

  /**
   * Determine if a source is trusted for skew measurement.
   */
  private isTrustedSource(source: string): boolean {
    const trustedSources = ["horizon", "soroban-rpc", "ntp"];
    return trustedSources.some((t) => source.toLowerCase().includes(t));
  }
}

export const clockSkewService = new ClockSkewService();
