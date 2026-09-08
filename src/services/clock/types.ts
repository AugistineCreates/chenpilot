/**
 * Clock Skew Detection Types
 * Supports measurement of time offset across distributed nodes
 */

export interface ClockSample {
  /** Local node time when measurement was taken */
  localTime: Date;
  /** Reported time from remote source (e.g., Horizon ledger, peer node) */
  remoteTime: Date;
  /** Source identifier (e.g., 'horizon', 'peer-123', 'ntp') */
  source: string;
  /** Latency estimate in milliseconds */
  latencyMs?: number;
}

export interface ClockOffset {
  /** Calculated offset in milliseconds (remote - local) */
  offsetMs: number;
  /** Whether this offset is from a trusted source */
  trusted: boolean;
  /** Last time this offset was measured */
  lastUpdated: Date;
  /** Number of samples contributing to this offset */
  sampleCount: number;
}

export interface ClockSkewStats {
  /** Maximum measured offset in ms */
  maxOffsetMs: number;
  /** Minimum measured offset in ms */
  minOffsetMs: number;
  /** Median offset across all sources */
  medianOffsetMs: number;
  /** Standard deviation of offsets */
  stdDeviation: number;
  /** Overall health status */
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  /** Timestamp when stats were computed */
  computedAt: Date;
}

export interface ClockSkewConfig {
  /** Maximum acceptable offset in milliseconds before flagging DEGRADED (default: 5000 = 5s) */
  degradedThresholdMs: number;
  /** Maximum acceptable offset before flagging CRITICAL (default: 30000 = 30s) */
  criticalThresholdMs: number;
  /** Number of samples to keep in history (default: 100) */
  maxHistorySamples: number;
  /** Minimum samples needed for stats (default: 3) */
  minSamplesForStats: number;
}

export interface TrustedTimeComparison {
  /** Absolute difference between times */
  diffMs: number;
  /** Whether difference is within acceptable bounds */
  isSafe: boolean;
  /** Applied safety margin in milliseconds */
  safetyMarginMs: number;
  /** Reason for comparison result */
  reason: string;
}
