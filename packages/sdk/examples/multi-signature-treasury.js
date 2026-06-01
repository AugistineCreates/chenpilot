"use strict";
/**
 * @fileoverview Treasury Multi-Signature Example
 *
 * This example demonstrates how to implement a treasury management system
 * that requires multiple signatures for large payments using different
 * provider types (hardware wallets, browser extensions, etc.)
 */
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignerRole = exports.TreasuryManager = void 0;
exports.treasuryExample = treasuryExample;
const src_1 = require("../src");
/**
 * Treasury signer role
 */
var SignerRole;
(function (SignerRole) {
  SignerRole["ADMIN"] = "admin";
  SignerRole["FINANCE"] = "finance";
  SignerRole["OPERATIONS"] = "operations";
  SignerRole["EMERGENCY"] = "emergency";
})(SignerRole || (exports.SignerRole = SignerRole = {}));
/**
 * Treasury management system with multi-signature support
 */
class TreasuryManager {
  constructor(config) {
    this.signers = new Map();
    this.config = config;
    this.sdk = new src_1.SignatureProviderSDK({
      enableMetrics: true,
      enableLogging: true,
    });
    this.coordinator = new src_1.MultiSignatureCoordinator();
  }
  /**
   * Initialize the treasury system
   */
  initialize() {
    return __awaiter(this, void 0, void 0, function* () {
      console.log("🏛️  Initializing Treasury Management System...");
      yield this.sdk.initialize();
      // Setup event listeners for audit trail
      this.coordinator.addEventListener((event) => {
        this.logTreasuryEvent(event);
      });
      console.log("✅ Treasury system initialized");
    });
  }
  /**
   * Add a signer to the treasury
   */
  addSigner(providerId_1, providerType_1, role_1) {
    return __awaiter(
      this,
      arguments,
      void 0,
      function* (providerId, providerType, role, required = true) {
        console.log(`👤 Adding ${role} signer: ${providerId}`);
        // Create provider based on type
        let provider;
        switch (providerType) {
          case src_1.ProviderType.MOCK:
            provider = new src_1.MockSignatureProvider(providerId, undefined, {
              enableLogging: true,
            });
            break;
          case src_1.ProviderType.LEDGER:
            provider = new src_1.LedgerSignatureProvider({
              enableDebugLogging: true,
            });
            break;
          case src_1.ProviderType.ALBEDO:
            provider = new src_1.AlbedoSignatureProvider({
              enableDebugLogging: true,
            });
            break;
          default:
            throw new Error(`Unsupported provider type: ${providerType}`);
        }
        // Connect and register
        yield provider.connect();
        this.coordinator.registerProvider(provider);
        // Get account for Stellar (treasury operates on Stellar)
        const accounts = yield provider.getAccounts(src_1.ChainId.STELLAR);
        if (accounts.length === 0) {
          throw new Error(`No accounts available for provider ${providerId}`);
        }
        // Store signer information
        const signerInfo = {
          providerId,
          accountAddress: accounts[0].address,
          publicKey: accounts[0].publicKey,
          required,
          metadata: {
            role,
            addedAt: new Date().toISOString(),
            providerType,
          },
        };
        this.signers.set(providerId, { info: signerInfo, role });
        console.log(`✅ Added ${role} signer: ${accounts[0].address}`);
      }
    );
  }
  /**
   * Process a payment request
   */
  processPayment(request) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      console.log(
        `💰 Processing payment request: ${request.amount} to ${request.destination}`
      );
      const auditTrail = [];
      auditTrail.push(
        `Payment requested: ${request.amount} to ${request.destination}`
      );
      auditTrail.push(
        `Category: ${request.category}, Requested by: ${request.requestedBy}`
      );
      // Determine required signers based on payment category and amount
      const requiredSigners = this.determineRequiredSigners(request);
      auditTrail.push(`Required signers: ${requiredSigners.length}`);
      // Create multi-signature configuration
      const config = {
        requiredSignatures: this.getRequiredSignatureCount(request),
        totalSigners: requiredSigners.length,
        allowPartialSigning: false, // Treasury requires all required signatures
        continueOnError: true,
        timeout: 300000, // 5 minutes for treasury operations
        description: `Treasury payment: ${request.amount} to ${request.destination}`,
      };
      // Create transaction
      const transaction = {
        sourceAccount: requiredSigners[0].accountAddress, // Treasury account
        fee: "100",
        sequenceNumber: "1", // In real implementation, get from network
        operations: [
          {
            type: "payment",
            destination: request.destination,
            asset: request.asset || "native",
            amount: request.amount,
          },
        ],
        memo: request.memo
          ? {
              type: "text",
              value: request.memo,
            }
          : undefined,
      };
      try {
        // Execute multi-signature workflow
        const workflowResult = yield this.coordinator.startWorkflow(
          { chainId: src_1.ChainId.STELLAR, transaction },
          requiredSigners,
          config
        );
        auditTrail.push(`Workflow status: ${workflowResult.status}`);
        auditTrail.push(
          `Signatures collected: ${workflowResult.signatures.length}`
        );
        if (
          workflowResult.status === "completed" &&
          workflowResult.requiredMet
        ) {
          auditTrail.push("✅ Payment approved and executed");
          return {
            approved: true,
            transactionHash:
              ((_a = workflowResult.finalTransaction) === null || _a === void 0
                ? void 0
                : _a.hash) || "mock-tx-hash",
            signatures: workflowResult.signatures,
            auditTrail,
          };
        } else {
          auditTrail.push("❌ Payment rejected - insufficient signatures");
          return {
            approved: false,
            signatures: workflowResult.signatures,
            auditTrail,
          };
        }
      } catch (error) {
        auditTrail.push(
          `❌ Payment failed: ${error instanceof Error ? error.message : error}`
        );
        return {
          approved: false,
          signatures: [],
          auditTrail,
        };
      }
    });
  }
  /**
   * Get treasury status and metrics
   */
  getTreasuryStatus() {
    const signersByRole = {
      [SignerRole.ADMIN]: 0,
      [SignerRole.FINANCE]: 0,
      [SignerRole.OPERATIONS]: 0,
      [SignerRole.EMERGENCY]: 0,
    };
    let activeSigners = 0;
    for (const { info, role } of this.signers.values()) {
      signersByRole[role]++;
      // Check if provider is connected (simplified check)
      try {
        const provider = this.coordinator.getProvider(info.providerId);
        if (
          provider === null || provider === void 0
            ? void 0
            : provider.isConnected()
        ) {
          activeSigners++;
        }
      } catch (_a) {
        // Provider not found or not connected
      }
    }
    const healthStatus =
      activeSigners >= this.config.requiredSignatures ? "healthy" : "degraded";
    return {
      totalSigners: this.signers.size,
      activeSigners,
      signersByRole,
      healthStatus,
    };
  }
  /**
   * Emergency payment with reduced signature requirements
   */
  processEmergencyPayment(request) {
    return __awaiter(this, void 0, void 0, function* () {
      console.log("🚨 Processing EMERGENCY payment");
      // Emergency payments require only emergency signers
      const emergencySigners = Array.from(this.signers.values())
        .filter(
          ({ role }) =>
            role === SignerRole.EMERGENCY || role === SignerRole.ADMIN
        )
        .map(({ info }) => info);
      if (emergencySigners.length === 0) {
        throw new Error("No emergency signers available");
      }
      const config = {
        requiredSignatures: Math.min(2, emergencySigners.length), // Reduced requirement
        totalSigners: emergencySigners.length,
        allowPartialSigning: true,
        continueOnError: true,
        timeout: 120000, // 2 minutes for emergency
        description: `EMERGENCY payment: ${request.amount}`,
      };
      // Process with emergency configuration
      return this.processPaymentWithSigners(request, emergencySigners, config);
    });
  }
  /**
   * Cleanup treasury resources
   */
  dispose() {
    return __awaiter(this, void 0, void 0, function* () {
      console.log("🧹 Disposing treasury resources...");
      yield this.sdk.dispose();
      console.log("✅ Treasury disposed");
    });
  }
  determineRequiredSigners(request) {
    const amount = parseFloat(request.amount);
    const threshold = parseFloat(this.config.largePaymentThreshold);
    let requiredSigners = [];
    if (request.category === "emergency") {
      // Emergency payments require emergency signers
      requiredSigners = Array.from(this.signers.values())
        .filter(
          ({ role }) =>
            role === SignerRole.EMERGENCY || role === SignerRole.ADMIN
        )
        .map(({ info }) => info);
    } else if (amount >= threshold) {
      // Large payments require admin + finance approval
      requiredSigners = Array.from(this.signers.values())
        .filter(
          ({ role }) => role === SignerRole.ADMIN || role === SignerRole.FINANCE
        )
        .map(({ info }) => info);
    } else {
      // Regular payments require any authorized signers
      requiredSigners = Array.from(this.signers.values())
        .filter(({ role }) => role !== SignerRole.EMERGENCY)
        .map(({ info }) => info);
    }
    return requiredSigners.slice(0, this.config.totalSigners);
  }
  getRequiredSignatureCount(request) {
    const amount = parseFloat(request.amount);
    const threshold = parseFloat(this.config.largePaymentThreshold);
    if (request.category === "emergency") {
      return 2; // Emergency requires 2 signatures
    } else if (amount >= threshold) {
      return Math.min(3, this.config.requiredSignatures); // Large payments require more signatures
    } else {
      return this.config.requiredSignatures;
    }
  }
  processPaymentWithSigners(request, signers, config) {
    return __awaiter(this, void 0, void 0, function* () {
      const transaction = {
        sourceAccount: signers[0].accountAddress,
        fee: "100",
        sequenceNumber: "1",
        operations: [
          {
            type: "payment",
            destination: request.destination,
            asset: request.asset || "native",
            amount: request.amount,
          },
        ],
        memo: request.memo ? { type: "text", value: request.memo } : undefined,
      };
      return this.coordinator.startWorkflow(
        { chainId: src_1.ChainId.STELLAR, transaction },
        signers,
        config
      );
    });
  }
  logTreasuryEvent(event) {
    const timestamp = new Date().toISOString();
    switch (event.type) {
      case src_1.MultiSignatureEventType.WORKFLOW_STARTED:
        console.log(
          `📋 [${timestamp}] Treasury workflow started: ${event.workflowId}`
        );
        break;
      case src_1.MultiSignatureEventType.SIGNATURE_STARTED:
        console.log(
          `✍️  [${timestamp}] Signature requested from: ${event.providerId}`
        );
        break;
      case src_1.MultiSignatureEventType.SIGNATURE_COMPLETED:
        console.log(
          `✅ [${timestamp}] Signature completed by: ${event.providerId}`
        );
        break;
      case src_1.MultiSignatureEventType.SIGNATURE_FAILED:
        console.log(
          `❌ [${timestamp}] Signature failed for: ${event.providerId}`
        );
        break;
      case src_1.MultiSignatureEventType.WORKFLOW_COMPLETED:
        console.log(
          `🎉 [${timestamp}] Treasury workflow completed: ${event.workflowId}`
        );
        break;
      default:
        console.log(`📝 [${timestamp}] Treasury event: ${event.type}`);
    }
  }
}
exports.TreasuryManager = TreasuryManager;
/**
 * Example usage of the Treasury Management System
 */
function treasuryExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Treasury Management System Example ===\n");
    // Initialize treasury with 3-of-5 signature requirement
    const treasuryConfig = {
      requiredSignatures: 3,
      totalSigners: 5,
      largePaymentThreshold: "1000", // Payments over 1000 XLM require additional approval
      emergencySigners: ["emergency-1", "emergency-2"],
    };
    const treasury = new TreasuryManager(treasuryConfig);
    yield treasury.initialize();
    try {
      // Add treasury signers with different roles
      yield treasury.addSigner(
        "ceo-ledger",
        src_1.ProviderType.MOCK,
        SignerRole.ADMIN,
        true
      );
      yield treasury.addSigner(
        "cfo-ledger",
        src_1.ProviderType.MOCK,
        SignerRole.FINANCE,
        true
      );
      yield treasury.addSigner(
        "finance-manager",
        src_1.ProviderType.MOCK,
        SignerRole.FINANCE,
        true
      );
      yield treasury.addSigner(
        "ops-manager",
        src_1.ProviderType.MOCK,
        SignerRole.OPERATIONS,
        false
      );
      yield treasury.addSigner(
        "emergency-key",
        src_1.ProviderType.MOCK,
        SignerRole.EMERGENCY,
        false
      );
      console.log("\n📊 Treasury Status:");
      const status = treasury.getTreasuryStatus();
      console.log(`Total Signers: ${status.totalSigners}`);
      console.log(`Active Signers: ${status.activeSigners}`);
      console.log(`Health Status: ${status.healthStatus}`);
      console.log("Signers by Role:", status.signersByRole);
      // Process a regular payment
      console.log("\n💰 Processing Regular Payment...");
      const regularPayment = {
        destination: "GVENDOR123EXAMPLE",
        amount: "500",
        memo: "Monthly vendor payment - Invoice #12345",
        category: "operational",
        requestedBy: "finance-manager",
        approvedBy: ["cfo-ledger"],
      };
      const regularResult = yield treasury.processPayment(regularPayment);
      console.log(
        "Regular Payment Result:",
        regularResult.approved ? "✅ Approved" : "❌ Rejected"
      );
      console.log("Audit Trail:");
      regularResult.auditTrail.forEach((entry) => console.log(`  - ${entry}`));
      // Process a large payment
      console.log("\n💎 Processing Large Payment...");
      const largePayment = {
        destination: "GINVESTMENT456EXAMPLE",
        amount: "5000",
        memo: "Strategic investment - Q4 2024",
        category: "investment",
        requestedBy: "ceo-ledger",
        approvedBy: ["cfo-ledger", "ceo-ledger"],
      };
      const largeResult = yield treasury.processPayment(largePayment);
      console.log(
        "Large Payment Result:",
        largeResult.approved ? "✅ Approved" : "❌ Rejected"
      );
      console.log("Audit Trail:");
      largeResult.auditTrail.forEach((entry) => console.log(`  - ${entry}`));
      // Process an emergency payment
      console.log("\n🚨 Processing Emergency Payment...");
      const emergencyPayment = {
        destination: "GEMERGENCY789EXAMPLE",
        amount: "2000",
        memo: "Emergency security incident response",
        category: "emergency",
        requestedBy: "emergency-key",
        approvedBy: [],
      };
      const emergencyResult =
        yield treasury.processEmergencyPayment(emergencyPayment);
      console.log(
        "Emergency Payment Result:",
        emergencyResult.status === "completed" ? "✅ Approved" : "❌ Rejected"
      );
    } catch (error) {
      console.error("Treasury operation failed:", error);
    } finally {
      yield treasury.dispose();
    }
  });
}
// Run the example
if (require.main === module) {
  treasuryExample().catch(console.error);
}
