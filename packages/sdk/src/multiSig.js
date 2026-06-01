"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiSigBuilder = void 0;
exports.validateMultiSigConfig = validateMultiSigConfig;
exports.calculateTotalWeight = calculateTotalWeight;
exports.canMeetThreshold = canMeetThreshold;
const types_1 = require("./types");
/**
 * Builder class for creating and managing multi-signature account configurations.
 * Provides a fluent API for setting up complex multi-sig requirements with validation.
 *
 * @example
 * ```typescript
 * const builder = new MultiSigBuilder("GMASTER...")
 *   .addSigner("GSIGNER1...", 10)
 *   .addSigner("GSIGNER2...", 20)
 *   .setThreshold(ThresholdCategory.MEDIUM, 15)
 *   .setThreshold(ThresholdCategory.HIGH, 30);
 *
 * const result = builder.build();
 * if (result.validation.valid) {
 *   console.log("Configuration ready:", result.config);
 * }
 * ```
 */
class MultiSigBuilder {
  /**
   * Creates a new MultiSigBuilder instance.
   *
   * @param masterAccount - The master account address
   * @param options - Optional configuration for the builder
   */
  constructor(masterAccount, options = {}) {
    var _a, _b, _c;
    this.signers = [];
    this.thresholds = {
      low: 0,
      medium: 0,
      high: 0,
    };
    this.masterAccount = masterAccount;
    this.options = {
      autoValidate:
        (_a = options.autoValidate) !== null && _a !== void 0 ? _a : true,
      allowDuplicates:
        (_b = options.allowDuplicates) !== null && _b !== void 0 ? _b : false,
      maxSigners: (_c = options.maxSigners) !== null && _c !== void 0 ? _c : 20,
    };
  }
  /**
   * Adds a signer to the multi-sig configuration.
   *
   * @param address - The signer's public key or address
   * @param weight - The weight to assign (0-255)
   * @returns This builder instance for chaining
   * @throws Error if weight is out of range
   */
  addSigner(address, weight) {
    if (weight < 0 || weight > 255) {
      throw new Error("Signer weight must be between 0 and 255");
    }
    if (!this.options.allowDuplicates) {
      const existing = this.signers.find((s) => s.address === address);
      if (existing) {
        throw new Error(`Signer ${address} already exists`);
      }
    }
    this.signers.push({ address, weight });
    return this;
  }
  /**
   * Adds multiple signers at once.
   *
   * @param signers - Array of signers to add
   * @returns This builder instance for chaining
   */
  addSigners(signers) {
    signers.forEach((signer) => this.addSigner(signer.address, signer.weight));
    return this;
  }
  /**
   * Removes a signer from the configuration.
   *
   * @param address - The signer's address to remove
   * @returns This builder instance for chaining
   */
  removeSigner(address) {
    this.signers = this.signers.filter((s) => s.address !== address);
    return this;
  }
  /**
   * Updates the weight of an existing signer.
   *
   * @param address - The signer's address
   * @param weight - The new weight (0-255)
   * @returns This builder instance for chaining
   * @throws Error if signer not found or weight out of range
   */
  updateSignerWeight(address, weight) {
    if (weight < 0 || weight > 255) {
      throw new Error("Signer weight must be between 0 and 255");
    }
    const signer = this.signers.find((s) => s.address === address);
    if (!signer) {
      throw new Error(`Signer ${address} not found`);
    }
    signer.weight = weight;
    return this;
  }
  /**
   * Sets a threshold for a specific category.
   *
   * @param category - The threshold category (low, medium, high)
   * @param value - The threshold value (0-255)
   * @returns This builder instance for chaining
   * @throws Error if threshold value is out of range
   */
  setThreshold(category, value) {
    if (value < 0 || value > 255) {
      throw new Error("Threshold must be between 0 and 255");
    }
    this.thresholds[category] = value;
    return this;
  }
  /**
   * Sets all thresholds at once.
   *
   * @param thresholds - Complete threshold configuration
   * @returns This builder instance for chaining
   */
  setThresholds(thresholds) {
    if (thresholds.low !== undefined) {
      this.setThreshold(types_1.ThresholdCategory.LOW, thresholds.low);
    }
    if (thresholds.medium !== undefined) {
      this.setThreshold(types_1.ThresholdCategory.MEDIUM, thresholds.medium);
    }
    if (thresholds.high !== undefined) {
      this.setThreshold(types_1.ThresholdCategory.HIGH, thresholds.high);
    }
    return this;
  }
  /**
   * Validates the current configuration.
   *
   * @returns Validation result with errors and warnings
   */
  validate() {
    const errors = [];
    const warnings = [];
    // Validate master account
    if (!this.masterAccount || this.masterAccount.trim() === "") {
      errors.push("Master account address is required");
    }
    // Validate signers
    if (this.signers.length === 0) {
      warnings.push("No signers configured");
    }
    if (this.signers.length > this.options.maxSigners) {
      errors.push(
        `Too many signers: ${this.signers.length} (max: ${this.options.maxSigners})`
      );
    }
    // Check for invalid signer addresses
    this.signers.forEach((signer, index) => {
      if (!signer.address || signer.address.trim() === "") {
        errors.push(`Signer at index ${index} has invalid address`);
      }
    });
    // Calculate total weight
    const totalWeight = this.signers.reduce(
      (sum, signer) => sum + signer.weight,
      0
    );
    // Validate thresholds against total weight
    if (this.thresholds.low > totalWeight) {
      errors.push(
        `Low threshold (${this.thresholds.low}) exceeds total weight (${totalWeight})`
      );
    }
    if (this.thresholds.medium > totalWeight) {
      errors.push(
        `Medium threshold (${this.thresholds.medium}) exceeds total weight (${totalWeight})`
      );
    }
    if (this.thresholds.high > totalWeight) {
      errors.push(
        `High threshold (${this.thresholds.high}) exceeds total weight (${totalWeight})`
      );
    }
    // Validate threshold ordering
    if (this.thresholds.medium < this.thresholds.low) {
      warnings.push("Medium threshold is lower than low threshold");
    }
    if (this.thresholds.high < this.thresholds.medium) {
      warnings.push("High threshold is lower than medium threshold");
    }
    // Check for signers with zero weight
    const zeroWeightSigners = this.signers.filter((s) => s.weight === 0);
    if (zeroWeightSigners.length > 0) {
      warnings.push(`${zeroWeightSigners.length} signer(s) have zero weight`);
    }
    // Check if any threshold can be met
    if (totalWeight > 0) {
      if (this.thresholds.high > 0 && this.thresholds.high > totalWeight) {
        errors.push("High threshold cannot be met with current signers");
      }
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
  /**
   * Builds the final multi-sig configuration.
   *
   * @returns Build result with configuration and validation
   * @throws Error if auto-validation is enabled and configuration is invalid
   */
  build() {
    const validation = this.validate();
    if (this.options.autoValidate && !validation.valid) {
      throw new Error(
        `Invalid multi-sig configuration: ${validation.errors.join(", ")}`
      );
    }
    const config = {
      masterAccount: this.masterAccount,
      signers: [...this.signers],
      thresholds: Object.assign({}, this.thresholds),
    };
    return {
      config,
      validation,
      estimatedFee: this.estimateFee(),
    };
  }
  /**
   * Estimates the transaction fee for setting up this multi-sig configuration.
   * Based on Stellar network base fee and number of operations.
   *
   * @returns Estimated fee in stroops
   */
  estimateFee() {
    const BASE_FEE = 100; // stroops per operation
    // 1 operation for setting thresholds + 1 per signer
    const operations = 1 + this.signers.length;
    return BASE_FEE * operations;
  }
  /**
   * Gets the current configuration without building.
   *
   * @returns Current multi-sig configuration
   */
  getConfig() {
    return {
      masterAccount: this.masterAccount,
      signers: [...this.signers],
      thresholds: Object.assign({}, this.thresholds),
    };
  }
  /**
   * Resets the builder to initial state, keeping only the master account.
   *
   * @returns This builder instance for chaining
   */
  reset() {
    this.signers = [];
    this.thresholds = {
      low: 0,
      medium: 0,
      high: 0,
    };
    return this;
  }
  /**
   * Creates a preset configuration for common multi-sig scenarios.
   *
   * @param preset - The preset type
   * @param signerAddresses - Array of signer addresses
   * @returns A new MultiSigBuilder with preset configuration
   */
  static createPreset(preset, masterAccount, signerAddresses) {
    const builder = new MultiSigBuilder(masterAccount);
    switch (preset) {
      case "2-of-3":
        if (signerAddresses.length !== 3) {
          throw new Error("2-of-3 preset requires exactly 3 signers");
        }
        signerAddresses.forEach((addr) => builder.addSigner(addr, 1));
        builder.setThresholds({ low: 1, medium: 2, high: 2 });
        break;
      case "3-of-5":
        if (signerAddresses.length !== 5) {
          throw new Error("3-of-5 preset requires exactly 5 signers");
        }
        signerAddresses.forEach((addr) => builder.addSigner(addr, 1));
        builder.setThresholds({ low: 1, medium: 3, high: 3 });
        break;
      case "majority":
        signerAddresses.forEach((addr) => builder.addSigner(addr, 1));
        const majority = Math.ceil(signerAddresses.length / 2);
        builder.setThresholds({ low: 1, medium: majority, high: majority });
        break;
      case "unanimous":
        signerAddresses.forEach((addr) => builder.addSigner(addr, 1));
        builder.setThresholds({
          low: 1,
          medium: signerAddresses.length,
          high: signerAddresses.length,
        });
        break;
    }
    return builder;
  }
}
exports.MultiSigBuilder = MultiSigBuilder;
/**
 * Validates a multi-sig configuration.
 *
 * @param config - The configuration to validate
 * @returns Validation result
 */
function validateMultiSigConfig(config) {
  const builder = new MultiSigBuilder(config.masterAccount, {
    autoValidate: false,
  });
  builder.addSigners(config.signers);
  builder.setThresholds(config.thresholds);
  return builder.validate();
}
/**
 * Calculates the total weight of all signers in a configuration.
 *
 * @param config - The multi-sig configuration
 * @returns Total weight
 */
function calculateTotalWeight(config) {
  return config.signers.reduce((sum, signer) => sum + signer.weight, 0);
}
/**
 * Checks if a set of signers can meet a specific threshold.
 *
 * @param signers - Array of signer addresses
 * @param config - The multi-sig configuration
 * @param threshold - The threshold to check against
 * @returns Whether the threshold can be met
 */
function canMeetThreshold(signers, config, threshold) {
  const totalWeight = signers.reduce((sum, address) => {
    const signer = config.signers.find((s) => s.address === address);
    return (
      sum +
      ((signer === null || signer === void 0 ? void 0 : signer.weight) || 0)
    );
  }, 0);
  return totalWeight >= threshold;
}
