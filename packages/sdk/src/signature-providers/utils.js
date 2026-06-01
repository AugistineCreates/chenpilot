"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureProviderUtils = void 0;
const types_1 = require("../types");
const errors_1 = require("./errors");
/**
 * Utility functions for working with SignatureProviders
 */
class SignatureProviderUtils {
  /**
   * Check if a provider supports a specific chain
   */
  static supportsChain(provider, chainId) {
    return provider.getCapabilities().supportedChains.includes(chainId);
  }
  /**
   * Check if a provider supports multiple chains
   */
  static supportsMultipleChains(provider, chainIds) {
    const supportedChains = provider.getCapabilities().supportedChains;
    return chainIds.every((chainId) => supportedChains.includes(chainId));
  }
  /**
   * Check if a provider supports message signing
   */
  static supportsMessageSigning(provider) {
    return provider.getCapabilities().supportsMessageSigning;
  }
  /**
   * Check if a provider requires user interaction
   */
  static requiresUserInteraction(provider) {
    return provider.getCapabilities().requiresUserInteraction;
  }
  /**
   * Get the maximum concurrent signatures a provider can handle
   */
  static getMaxConcurrentSignatures(provider) {
    return provider.getCapabilities().maxConcurrentSignatures;
  }
  /**
   * Validate that a provider can handle a specific operation
   */
  static validateProviderCapability(
    provider,
    chainId,
    requiresMessageSigning = false
  ) {
    const capabilities = provider.getCapabilities();
    if (!capabilities.supportedChains.includes(chainId)) {
      throw new errors_1.UnsupportedChainError(chainId, provider.providerId);
    }
    if (requiresMessageSigning && !capabilities.supportsMessageSigning) {
      throw new errors_1.UnsupportedOperationError(
        "message signing",
        provider.providerId
      );
    }
  }
  /**
   * Compare providers by their capabilities (for sorting/ranking)
   */
  static compareProviders(a, b) {
    const aCaps = a.getCapabilities();
    const bCaps = b.getCapabilities();
    // Prioritize by number of supported chains
    const chainDiff =
      bCaps.supportedChains.length - aCaps.supportedChains.length;
    if (chainDiff !== 0) return chainDiff;
    // Then by concurrent signature capacity
    const concurrentDiff =
      bCaps.maxConcurrentSignatures - aCaps.maxConcurrentSignatures;
    if (concurrentDiff !== 0) return concurrentDiff;
    // Finally by provider name (alphabetical)
    return a.metadata.name.localeCompare(b.metadata.name);
  }
  /**
   * Get a human-readable description of provider capabilities
   */
  static getCapabilityDescription(capabilities) {
    const parts = [];
    parts.push(
      `Supports ${capabilities.supportedChains.length} chain(s): ${capabilities.supportedChains.join(", ")}`
    );
    if (capabilities.supportsMultipleAccounts) {
      parts.push("Multiple accounts supported");
    }
    if (capabilities.supportsMessageSigning) {
      parts.push("Message signing supported");
    }
    if (capabilities.requiresUserInteraction) {
      parts.push("Requires user interaction");
    }
    parts.push(
      `Max concurrent signatures: ${capabilities.maxConcurrentSignatures}`
    );
    return parts.join("; ");
  }
  /**
   * Filter providers by specific criteria
   */
  static filterProviders(providers, criteria) {
    return providers.filter((provider) => {
      const capabilities = provider.getCapabilities();
      // Filter by supported chains
      if (criteria.supportedChains) {
        if (criteria.requiresAllChains) {
          // Provider must support ALL specified chains
          if (
            !criteria.supportedChains.every((chain) =>
              capabilities.supportedChains.includes(chain)
            )
          ) {
            return false;
          }
        } else {
          // Provider must support AT LEAST ONE specified chain
          if (
            !criteria.supportedChains.some((chain) =>
              capabilities.supportedChains.includes(chain)
            )
          ) {
            return false;
          }
        }
      }
      // Filter by message signing support
      if (criteria.supportsMessageSigning !== undefined) {
        if (
          capabilities.supportsMessageSigning !==
          criteria.supportsMessageSigning
        ) {
          return false;
        }
      }
      // Filter by user interaction requirement
      if (criteria.requiresUserInteraction !== undefined) {
        if (
          capabilities.requiresUserInteraction !==
          criteria.requiresUserInteraction
        ) {
          return false;
        }
      }
      // Filter by minimum concurrent signatures
      if (criteria.minConcurrentSignatures !== undefined) {
        if (
          capabilities.maxConcurrentSignatures <
          criteria.minConcurrentSignatures
        ) {
          return false;
        }
      }
      // Filter by connection status
      if (criteria.connected !== undefined) {
        if (provider.isConnected() !== criteria.connected) {
          return false;
        }
      }
      return true;
    });
  }
  /**
   * Find the best provider for a specific use case
   */
  static findBestProvider(providers, chainId, preferences = {}) {
    // First filter to providers that support the chain
    const compatibleProviders = providers.filter((provider) =>
      this.supportsChain(provider, chainId)
    );
    if (compatibleProviders.length === 0) {
      return null;
    }
    // Score providers based on preferences
    const scoredProviders = compatibleProviders.map((provider) => {
      let score = 0;
      const capabilities = provider.getCapabilities();
      // Base score for supporting the chain
      score += 10;
      // Preference bonuses
      if (preferences.preferConnected && provider.isConnected()) {
        score += 5;
      }
      if (
        preferences.preferNoUserInteraction &&
        !capabilities.requiresUserInteraction
      ) {
        score += 3;
      }
      if (
        preferences.preferMessageSigning &&
        capabilities.supportsMessageSigning
      ) {
        score += 2;
      }
      if (
        preferences.preferMultipleAccounts &&
        capabilities.supportsMultipleAccounts
      ) {
        score += 2;
      }
      // Bonus for higher concurrent signature capacity
      score += Math.min(capabilities.maxConcurrentSignatures, 5);
      return { provider, score };
    });
    // Sort by score (highest first) and return the best
    scoredProviders.sort((a, b) => b.score - a.score);
    return scoredProviders[0].provider;
  }
  /**
   * Create a summary of all providers and their capabilities
   */
  static createProviderSummary(providers) {
    const summary = {
      totalProviders: providers.length,
      connectedProviders: 0,
      chainSupport: {
        [types_1.ChainId.BITCOIN]: 0,
        [types_1.ChainId.STELLAR]: 0,
        [types_1.ChainId.STARKNET]: 0,
      },
      capabilities: {
        messageSigningSupport: 0,
        multipleAccountsSupport: 0,
        requireUserInteraction: 0,
      },
    };
    providers.forEach((provider) => {
      if (provider.isConnected()) {
        summary.connectedProviders++;
      }
      const capabilities = provider.getCapabilities();
      // Count chain support
      capabilities.supportedChains.forEach((chain) => {
        if (chain in summary.chainSupport) {
          summary.chainSupport[chain]++;
        }
      });
      // Count capabilities
      if (capabilities.supportsMessageSigning) {
        summary.capabilities.messageSigningSupport++;
      }
      if (capabilities.supportsMultipleAccounts) {
        summary.capabilities.multipleAccountsSupport++;
      }
      if (capabilities.requiresUserInteraction) {
        summary.capabilities.requireUserInteraction++;
      }
    });
    return summary;
  }
}
exports.SignatureProviderUtils = SignatureProviderUtils;
