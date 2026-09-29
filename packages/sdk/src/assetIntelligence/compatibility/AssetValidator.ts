/**
 * Asset Validator
 * Asset validation logic for compatibility checks
 */

import { Asset, AssetMetadata, VerificationResult } from '../core/types';

export interface ValidationConfig {
  strictMode: boolean;
  allowedNetworks: string[];
  blockedIssuers: string[];
  requireAuth: boolean;
  requireTOML: boolean;
}

export class AssetValidator {
  private config: ValidationConfig;

  constructor(config: ValidationConfig) {
    this.config = config;
  }

  /**
   * Validate asset metadata
   */
  async validateMetadata(asset: Asset, metadata: AssetMetadata): Promise<VerificationResult> {
    const issues: string[] = [];
    let score = 100;

    // Check network
    if (!this.config.allowedNetworks.includes(asset.network)) {
      issues.push(`Network ${asset.network} not in allowed list`);
      score -= 30;
    }

    // Check blocked issuers
    if (asset.issuer && this.config.blockedIssuers.includes(asset.issuer)) {
      issues.push(`Issuer ${asset.issuer} is blocked`);
      score -= 50;
    }

    // Check auth requirements
    if (this.config.requireAuth && metadata.isAuthRequired && metadata.authRevoked) {
      issues.push('Asset requires authorization but auth is revoked');
      score -= 40;
    }

    // Check TOML requirement
    if (this.config.requireTOML && !metadata.tomlUrl) {
      issues.push('Asset requires TOML but none provided');
      score -= 20;
    }

    // Check required fields
    if (!metadata.name) {
      issues.push('Asset missing name');
      score -= 10;
    }

    if (!metadata.decimals && asset.issuer) {
      issues.push('Asset missing decimals');
      score -= 10;
    }

    const verified = score >= 70;
    const status = this.getStatus(score);

    return {
      verified,
      status,
      reasons: issues,
      score,
    };
  }

  /**
   * Validate asset code
   */
  validateCode(code: string): { valid: boolean; reason?: string } {
    if (!code || code.length === 0) {
      return { valid: false, reason: 'Asset code cannot be empty' };
    }

    if (code.length > 12) {
      return { valid: false, reason: 'Asset code cannot exceed 12 characters' };
    }

    if (!/^[A-Z0-9]+$/.test(code)) {
      return { valid: false, reason: 'Asset code must be alphanumeric uppercase' };
    }

    return { valid: true };
  }

  /**
   * Validate issuer address
   */
  validateIssuer(issuer: string): { valid: boolean; reason?: string } {
    if (!issuer) {
      return { valid: true }; // Native asset (XLM) has no issuer
    }

    if (issuer.length !== 56) {
      return { valid: false, reason: 'Issuer address must be 56 characters' };
    }

    if (!/^[A-Z0-9]+$/.test(issuer)) {
      return { valid: false, reason: 'Issuer address must be alphanumeric uppercase' };
    }

    return { valid: true };
  }

  /**
   * Validate asset structure
   */
  validateAsset(asset: Asset): { valid: boolean; reasons: string[] } {
    const reasons: string[] = [];

    const codeValidation = this.validateCode(asset.code);
    if (!codeValidation.valid && codeValidation.reason) {
      reasons.push(codeValidation.reason);
    }

    if (asset.issuer) {
      const issuerValidation = this.validateIssuer(asset.issuer);
      if (!issuerValidation.valid && issuerValidation.reason) {
        reasons.push(issuerValidation.reason);
      }
    }

    return {
      valid: reasons.length === 0,
      reasons,
    };
  }

  /**
   * Get status from score
   */
  private getStatus(score: number): 'verified' | 'unverified' | 'malicious' {
    if (score >= 70) {
      return 'verified';
    } else if (score >= 40) {
      return 'unverified';
    } else {
      return 'malicious';
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ValidationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ValidationConfig {
    return { ...this.config };
  }
}
