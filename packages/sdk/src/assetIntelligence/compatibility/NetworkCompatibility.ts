/**
 * Network Compatibility
 * Network-specific compatibility rules
 */

import { Asset, Network, CompatibilityResult, CompatibilityContext } from '../core/types';

export interface NetworkRule {
  network: Network;
  allowedOperations: string[];
  blockedIssuers: string[];
  requiredFeatures: string[];
}

export class NetworkCompatibility {
  private rules: Map<Network, NetworkRule>;

  constructor() {
    this.rules = new Map();
    this.initializeRules();
  }

  /**
   * Initialize network rules
   */
  private initializeRules(): void {
    // Public network rules
    this.rules.set('public', {
      network: 'public',
      allowedOperations: ['payment', 'create_account', 'manage_sell_offer', 'manage_buy_offer', 'set_trustline', 'change_trust'],
      blockedIssuers: [],
      requiredFeatures: ['auth_required'],
    });

    // Testnet rules
    this.rules.set('testnet', {
      network: 'testnet',
      allowedOperations: ['payment', 'create_account', 'manage_sell_offer', 'manage_buy_offer', 'set_trustline', 'change_trust'],
      blockedIssuers: [],
      requiredFeatures: [],
    });

    // Futurenet rules
    this.rules.set('futurenet', {
      network: 'futurenet',
      allowedOperations: ['payment', 'create_account', 'manage_sell_offer', 'manage_buy_offer', 'set_trustline', 'change_trust'],
      blockedIssuers: [],
      requiredFeatures: [],
    });

    // Standalone rules
    this.rules.set('standalone', {
      network: 'standalone',
      allowedOperations: ['payment', 'create_account', 'manage_sell_offer', 'manage_buy_offer', 'set_trustline', 'change_trust'],
      blockedIssuers: [],
      requiredFeatures: [],
    });
  }

  /**
   * Check network compatibility
   */
  async checkCompatibility(asset: Asset, context: CompatibilityContext): Promise<CompatibilityResult> {
    const rule = this.rules.get(context.network);
    
    if (!rule) {
      return {
        compatible: false,
        reasons: [`Network ${context.network} not supported`],
        warnings: [],
        lastChecked: Date.now(),
      };
    }

    const reasons: string[] = [];
    const warnings: string[] = [];

    // Check if asset network matches context network
    if (asset.network !== context.network) {
      reasons.push(`Asset network ${asset.network} does not match context network ${context.network}`);
    }

    // Check if operation is allowed
    if (context.operation && !rule.allowedOperations.includes(context.operation)) {
      reasons.push(`Operation ${context.operation} not allowed on network ${context.network}`);
    }

    // Check if issuer is blocked
    if (asset.issuer && rule.blockedIssuers.includes(asset.issuer)) {
      reasons.push(`Issuer ${asset.issuer} is blocked on network ${context.network}`);
    }

    // Check required features (would need metadata)
    // TODO: Implement feature checking when metadata is available

    const compatible = reasons.length === 0;

    return {
      compatible,
      reasons,
      warnings,
      lastChecked: Date.now(),
    };
  }

  /**
   * Add network rule
   */
  addRule(rule: NetworkRule): void {
    this.rules.set(rule.network, rule);
  }

  /**
   * Update network rule
   */
  updateRule(network: Network, updates: Partial<NetworkRule>): void {
    const existing = this.rules.get(network);
    if (existing) {
      this.rules.set(network, { ...existing, ...updates });
    }
  }

  /**
   * Remove network rule
   */
  removeRule(network: Network): void {
    this.rules.delete(network);
  }

  /**
   * Get network rule
   */
  getRule(network: Network): NetworkRule | undefined {
    return this.rules.get(network);
  }

  /**
   * Get all network rules
   */
  getAllRules(): NetworkRule[] {
    return Array.from(this.rules.values());
  }
}
