"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.basicMultiSigExample = basicMultiSigExample;
exports.presetExample = presetExample;
exports.weightedMultiSigExample = weightedMultiSigExample;
exports.validationExample = validationExample;
exports.dynamicUpdateExample = dynamicUpdateExample;
exports.thresholdCheckExample = thresholdCheckExample;
exports.treasuryExample = treasuryExample;
exports.externalConfigValidationExample = externalConfigValidationExample;
const multiSig_1 = require("../src/multiSig");
/**
 * Example 1: Basic Multi-Sig Setup
 * Create a simple 2-of-3 multi-sig account
 */
function basicMultiSigExample() {
  console.log("=== Basic Multi-Sig Example ===\n");
  const masterAccount = "GMASTER_ACCOUNT_ADDRESS";
  const builder = new multiSig_1.MultiSigBuilder(masterAccount)
    .addSigner("GSIGNER1_ADDRESS", 10)
    .addSigner("GSIGNER2_ADDRESS", 10)
    .addSigner("GSIGNER3_ADDRESS", 10)
    .setThreshold(multiSig_1.ThresholdCategory.LOW, 10)
    .setThreshold(multiSig_1.ThresholdCategory.MEDIUM, 20)
    .setThreshold(multiSig_1.ThresholdCategory.HIGH, 20);
  const result = builder.build();
  console.log("Configuration:", JSON.stringify(result.config, null, 2));
  console.log("Valid:", result.validation.valid);
  console.log("Estimated Fee:", result.estimatedFee, "stroops");
  console.log();
}
/**
 * Example 2: Using Presets
 * Quickly create common multi-sig configurations
 */
function presetExample() {
  console.log("=== Preset Example ===\n");
  const masterAccount = "GMASTER_ACCOUNT_ADDRESS";
  const signers = ["GSIGNER1_ADDRESS", "GSIGNER2_ADDRESS", "GSIGNER3_ADDRESS"];
  // Create a 2-of-3 configuration
  const builder = multiSig_1.MultiSigBuilder.createPreset(
    "2-of-3",
    masterAccount,
    signers
  );
  const result = builder.build();
  console.log("2-of-3 Configuration:");
  console.log("Signers:", result.config.signers.length);
  console.log("Thresholds:", result.config.thresholds);
  console.log();
}
/**
 * Example 3: Complex Weighted Multi-Sig
 * Create a multi-sig with different weights for different signers
 */
function weightedMultiSigExample() {
  console.log("=== Weighted Multi-Sig Example ===\n");
  const masterAccount = "GMASTER_ACCOUNT_ADDRESS";
  const builder = new multiSig_1.MultiSigBuilder(masterAccount)
    // CEO has highest weight
    .addSigner("GCEO_ADDRESS", 50)
    // CFO and CTO have medium weight
    .addSigner("GCFO_ADDRESS", 30)
    .addSigner("GCTO_ADDRESS", 30)
    // Board members have lower weight
    .addSigner("GBOARD1_ADDRESS", 10)
    .addSigner("GBOARD2_ADDRESS", 10)
    // Set thresholds
    .setThresholds({
      low: 10, // Any single board member
      medium: 50, // CEO alone or CFO+CTO
      high: 80, // CEO + one executive or both executives + board
    });
  const result = builder.build();
  console.log("Weighted Configuration:");
  console.log(
    "Total Weight:",
    (0, multiSig_1.calculateTotalWeight)(result.config)
  );
  console.log("Thresholds:", result.config.thresholds);
  console.log("Validation:", result.validation);
  console.log();
}
/**
 * Example 4: Validation and Error Handling
 * Demonstrate validation features
 */
function validationExample() {
  console.log("=== Validation Example ===\n");
  const masterAccount = "GMASTER_ACCOUNT_ADDRESS";
  // Create an invalid configuration (threshold too high)
  const builder = new multiSig_1.MultiSigBuilder(masterAccount, {
    autoValidate: false, // Disable auto-validation to show manual validation
  })
    .addSigner("GSIGNER1_ADDRESS", 10)
    .addSigner("GSIGNER2_ADDRESS", 10)
    .setThreshold(multiSig_1.ThresholdCategory.HIGH, 50); // Too high!
  const validation = builder.validate();
  console.log("Validation Result:");
  console.log("Valid:", validation.valid);
  console.log("Errors:", validation.errors);
  console.log("Warnings:", validation.warnings);
  console.log();
}
/**
 * Example 5: Dynamic Configuration Updates
 * Update an existing configuration
 */
function dynamicUpdateExample() {
  console.log("=== Dynamic Update Example ===\n");
  const masterAccount = "GMASTER_ACCOUNT_ADDRESS";
  const builder = new multiSig_1.MultiSigBuilder(masterAccount)
    .addSigner("GSIGNER1_ADDRESS", 10)
    .addSigner("GSIGNER2_ADDRESS", 20)
    .setThreshold(multiSig_1.ThresholdCategory.MEDIUM, 15);
  console.log("Initial config:", builder.getConfig());
  // Update a signer's weight
  builder.updateSignerWeight("GSIGNER1_ADDRESS", 25);
  // Add another signer
  builder.addSigner("GSIGNER3_ADDRESS", 15);
  // Update thresholds
  builder.setThreshold(multiSig_1.ThresholdCategory.HIGH, 40);
  console.log("Updated config:", builder.getConfig());
  console.log();
}
/**
 * Example 6: Checking Threshold Requirements
 * Verify if specific signers can meet a threshold
 */
function thresholdCheckExample() {
  console.log("=== Threshold Check Example ===\n");
  const config = {
    masterAccount: "GMASTER_ACCOUNT_ADDRESS",
    signers: [
      { address: "GSIGNER1_ADDRESS", weight: 10 },
      { address: "GSIGNER2_ADDRESS", weight: 20 },
      { address: "GSIGNER3_ADDRESS", weight: 30 },
    ],
    thresholds: { low: 10, medium: 30, high: 50 },
  };
  // Check if signer1 and signer2 can meet medium threshold
  const canMeetMedium = (0, multiSig_1.canMeetThreshold)(
    ["GSIGNER1_ADDRESS", "GSIGNER2_ADDRESS"],
    config,
    config.thresholds.medium
  );
  console.log("Can signer1 + signer2 meet medium threshold?", canMeetMedium);
  // Check if all signers can meet high threshold
  const canMeetHigh = (0, multiSig_1.canMeetThreshold)(
    ["GSIGNER1_ADDRESS", "GSIGNER2_ADDRESS", "GSIGNER3_ADDRESS"],
    config,
    config.thresholds.high
  );
  console.log("Can all signers meet high threshold?", canMeetHigh);
  console.log();
}
/**
 * Example 7: Treasury Multi-Sig
 * Real-world scenario for a treasury account
 */
function treasuryExample() {
  console.log("=== Treasury Multi-Sig Example ===\n");
  const masterAccount = "GTREASURY_MASTER_ADDRESS";
  const builder = new multiSig_1.MultiSigBuilder(masterAccount)
    // Treasurer has highest authority
    .addSigner("GTREASURER_ADDRESS", 40)
    // Finance team members
    .addSigner("GFINANCE1_ADDRESS", 20)
    .addSigner("GFINANCE2_ADDRESS", 20)
    // Auditors (can only observe, zero weight for signing)
    .addSigner("GAUDITOR1_ADDRESS", 0)
    .addSigner("GAUDITOR2_ADDRESS", 0)
    // Set thresholds
    .setThresholds({
      low: 20, // Any finance member
      medium: 40, // Treasurer or both finance members
      high: 60, // Treasurer + at least one finance member
    });
  const result = builder.build();
  console.log("Treasury Configuration:");
  console.log("Signers:", result.config.signers);
  console.log("Thresholds:", result.config.thresholds);
  console.log("Warnings:", result.validation.warnings);
  console.log();
}
/**
 * Example 8: Validating External Configuration
 * Validate a configuration from external source
 */
function externalConfigValidationExample() {
  console.log("=== External Config Validation Example ===\n");
  // Configuration received from API or file
  const externalConfig = {
    masterAccount: "GMASTER_ACCOUNT_ADDRESS",
    signers: [
      { address: "GSIGNER1_ADDRESS", weight: 25 },
      { address: "GSIGNER2_ADDRESS", weight: 25 },
      { address: "GSIGNER3_ADDRESS", weight: 25 },
    ],
    thresholds: { low: 25, medium: 50, high: 75 },
  };
  const validation = (0, multiSig_1.validateMultiSigConfig)(externalConfig);
  console.log("External Config Validation:");
  console.log("Valid:", validation.valid);
  console.log(
    "Total Weight:",
    (0, multiSig_1.calculateTotalWeight)(externalConfig)
  );
  if (!validation.valid) {
    console.log("Errors:", validation.errors);
  }
  if (validation.warnings.length > 0) {
    console.log("Warnings:", validation.warnings);
  }
  console.log();
}
// Run all examples
function runAllExamples() {
  basicMultiSigExample();
  presetExample();
  weightedMultiSigExample();
  validationExample();
  dynamicUpdateExample();
  thresholdCheckExample();
  treasuryExample();
  externalConfigValidationExample();
}
