/**
 * Trust Score Calculation
 * Aggregates and calculates trust scores from multiple signals
 */

import { TrustSignal, TrustScore, Asset } from '../core/types';
import { TrustSignals } from './TrustSignals.js';
import { TrustRegistry } from './TrustRegistry.js';

export interface TrustConfig {
  weights: Record<string, number>;
  thresholds: {
    verified: number;
    unverified: number;
    malicious: number;
  };
}

export class TrustScorer {
  private trustSignals: TrustSignals;
  private trustRegistry: TrustRegistry;
  private config: TrustConfig;

  constructor(trustSignals: TrustSignals, trustRegistry: TrustRegistry, config: TrustConfig) {
    this.trustSignals = trustSignals;
    this.trustRegistry = trustRegistry;
    this.config = config;
  }

  /**
   * Calculate overall trust score for an asset
   */
  async calculateTrustScore(asset: Asset): Promise<TrustScore> {
    const signals = await this.trustSignals.getAllSignals(asset);
    const overall = this.calculateWeightedScore(signals);
    const verificationStatus = this.determineVerificationStatus(overall);

    return {
      overall,
      signals,
      verificationStatus,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Calculate weighted score from signals
   */
  private calculateWeightedScore(signals: TrustSignal[]): number {
    if (signals.length === 0) {
      return 50; // Neutral score if no signals
    }

    let totalWeight = 0;
    let weightedSum = 0;

    for (const signal of signals) {
      const weight = this.config.weights[signal.type] || 1;
      weightedSum += signal.value * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
  }

  /**
   * Determine verification status based on score
   */
  private determineVerificationStatus(score: number): 'verified' | 'unverified' | 'malicious' {
    if (score >= this.config.thresholds.verified) {
      return 'verified';
    } else if (score <= this.config.thresholds.malicious) {
      return 'malicious';
    } else {
      return 'unverified';
    }
  }

  /**
   * Check if asset is in trust registry
   */
  async isInRegistry(asset: Asset): Promise<boolean> {
    return this.trustRegistry.contains(asset);
  }

  /**
   * Get registry entry for asset
   */
  async getRegistryEntry(asset: Asset) {
    return this.trustRegistry.getEntry(asset);
  }

  /**
   * Update trust configuration
   */
  updateConfig(config: Partial<TrustConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
