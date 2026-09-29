/**
 * Version Compatibility
 * Version compatibility checks for SDK and protocol
 */

import { CompatibilityResult } from '../core/types';

export interface VersionRule {
  minVersion: string;
  maxVersion?: string;
  requiredFeatures: string[];
  deprecatedFeatures: string[];
}

export class VersionCompatibility {
  private rules: Map<string, VersionRule>;

  constructor() {
    this.rules = new Map();
    this.initializeRules();
  }

  /**
   * Initialize version rules
   */
  private initializeRules(): void {
    // SDK version rules
    this.rules.set('sdk', {
      minVersion: '2.0.0',
      maxVersion: '3.0.0',
      requiredFeatures: ['soroban_support', 'asset_intelligence'],
      deprecatedFeatures: ['legacy_metadata', 'old_asset_cache'],
    });

    // Protocol version rules
    this.rules.set('protocol', {
      minVersion: '1.0.0',
      requiredFeatures: ['rbac', 'flash_loan_guard'],
      deprecatedFeatures: ['legacy_auth'],
    });
  }

  /**
   * Check version compatibility
   */
  async checkCompatibility(component: string, version: string): Promise<CompatibilityResult> {
    const rule = this.rules.get(component);
    
    if (!rule) {
      return {
        compatible: true,
        reasons: [],
        warnings: [`No version rules defined for component ${component}`],
        lastChecked: Date.now(),
      };
    }

    const reasons: string[] = [];
    const warnings: string[] = [];

    // Check minimum version
    if (!this.meetsMinVersion(version, rule.minVersion)) {
      reasons.push(`Version ${version} is below minimum required version ${rule.minVersion}`);
    }

    // Check maximum version
    if (rule.maxVersion && !this.meetsMaxVersion(version, rule.maxVersion)) {
      reasons.push(`Version ${version} exceeds maximum supported version ${rule.maxVersion}`);
    }

    // Check for deprecated features
    // TODO: Implement feature checking when feature list is available

    const compatible = reasons.length === 0;

    return {
      compatible,
      reasons,
      warnings,
      lastChecked: Date.now(),
    };
  }

  /**
   * Check if version meets minimum requirement
   */
  private meetsMinVersion(version: string, minVersion: string): boolean {
    return this.compareVersions(version, minVersion) >= 0;
  }

  /**
   * Check if version meets maximum requirement
   */
  private meetsMaxVersion(version: string, maxVersion: string): boolean {
    return this.compareVersions(version, maxVersion) <= 0;
  }

  /**
   * Compare two version strings
   * Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }

    return 0;
  }

  /**
   * Add version rule
   */
  addRule(component: string, rule: VersionRule): void {
    this.rules.set(component, rule);
  }

  /**
   * Update version rule
   */
  updateRule(component: string, updates: Partial<VersionRule>): void {
    const existing = this.rules.get(component);
    if (existing) {
      this.rules.set(component, { ...existing, ...updates });
    }
  }

  /**
   * Remove version rule
   */
  removeRule(component: string): void {
    this.rules.delete(component);
  }

  /**
   * Get version rule
   */
  getRule(component: string): VersionRule | undefined {
    return this.rules.get(component);
  }
}
