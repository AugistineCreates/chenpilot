"use strict";
/**
 * @fileoverview Examples of using the Stellar Metadata Manager
 * Demonstrates storing and retrieving arbitrary key-value metadata on Stellar accounts
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
exports.basicMetadataExample = basicMetadataExample;
exports.metadataWithExpirationExample = metadataWithExpirationExample;
exports.batchMetadataExample = batchMetadataExample;
exports.listMetadataExample = listMetadataExample;
exports.kycMetadataExample = kycMetadataExample;
exports.deleteMetadataExample = deleteMetadataExample;
exports.applicationStateExample = applicationStateExample;
exports.runAllExamples = runAllExamples;
const metadata_1 = require("../src/metadata");
/**
 * Example 1: Basic metadata storage and retrieval
 */
function basicMetadataExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Basic Metadata Example ===\n");
    // Create a metadata manager for testnet
    const manager = (0, metadata_1.createMetadataManager)({
      horizonUrl: "https://horizon-testnet.stellar.org",
    });
    const accountId = "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF";
    // Prepare to set metadata
    const setTxn = yield manager.prepareSetMetadata({
      accountId,
      key: "user-profile",
      value: JSON.stringify({
        name: "Alice",
        email: "alice@example.com",
        verified: true,
      }),
      type: "user-profile",
    });
    console.log("Set metadata transaction XDR:");
    console.log(setTxn);
    console.log(
      "\nTransaction is ready to be signed and submitted to network\n"
    );
    // Retrieve metadata
    const metadata = yield manager.getMetadata({
      accountId,
      key: "user-profile",
    });
    if (metadata) {
      console.log("Retrieved metadata:");
      console.log(JSON.parse(metadata.value));
      console.log(`Type: ${metadata.type}`);
      console.log(
        `Created: ${new Date(metadata.createdAt * 1000).toISOString()}`
      );
    }
  });
}
/**
 * Example 2: Metadata with expiration
 */
function metadataWithExpirationExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Metadata with Expiration Example ===\n");
    const manager = (0, metadata_1.createMetadataManager)();
    const accountId = "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF";
    // Set metadata that expires in 24 hours
    const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 24 hours
    const txn = yield manager.prepareSetMetadata({
      accountId,
      key: "session-token",
      value: "secret-token-12345",
      type: "session",
      expiresAt,
    });
    console.log("Set session metadata with 24-hour expiration");
    console.log("Transaction XDR:", txn.substring(0, 50) + "...\n");
    // Try to retrieve it
    const session = yield manager.getMetadata({
      accountId,
      key: "session-token",
    });
    if (session) {
      const expiresDate = new Date(session.expiresAt * 1000);
      console.log(`Session expires: ${expiresDate.toISOString()}`);
      console.log(
        `Expires in: ${Math.round((session.expiresAt - session.createdAt) / 3600)} hours`
      );
    }
  });
}
/**
 * Example 3: Batch metadata operations
 */
function batchMetadataExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Batch Metadata Example ===\n");
    const manager = (0, metadata_1.createMetadataManager)();
    const accountId = "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF";
    // Set multiple metadata entries
    const metadata = [
      {
        key: "user-id",
        value: "user-12345",
        type: "identifier",
      },
      {
        key: "preferences",
        value: JSON.stringify({ theme: "dark", language: "en" }),
        type: "preferences",
      },
      {
        key: "last-login",
        value: new Date().toISOString(),
        type: "timestamp",
      },
    ];
    console.log("Preparing batch metadata updates...");
    for (const meta of metadata) {
      const txn = yield manager.prepareSetMetadata(
        Object.assign({ accountId }, meta)
      );
      console.log(`- Set ${meta.key}: ${txn.substring(0, 30)}...`);
    }
    // Retrieve batch metadata
    console.log("\nRetrieving batch metadata...");
    const results = yield manager.getMetadataBatch(accountId, [
      "user-id",
      "preferences",
      "last-login",
    ]);
    results.forEach((entry, key) => {
      if (entry) {
        console.log(`- ${key}: ${entry.value.substring(0, 50)}...`);
      } else {
        console.log(`- ${key}: not found`);
      }
    });
  });
}
/**
 * Example 4: List all metadata for an account
 */
function listMetadataExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== List Metadata Example ===\n");
    const manager = (0, metadata_1.createMetadataManager)();
    const accountId = "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF";
    const response = yield manager.listMetadata(accountId);
    console.log(`Account: ${response.accountId}`);
    console.log(`Total metadata entries: ${response.total}\n`);
    if (response.metadata.length === 0) {
      console.log("No metadata found for this account");
    } else {
      console.log("Metadata entries:");
      response.metadata.forEach((entry) => {
        console.log(`\n  Key: ${entry.key}`);
        console.log(`  Type: ${entry.type}`);
        console.log(`  Value: ${entry.value.substring(0, 50)}...`);
        console.log(
          `  Created: ${new Date(entry.createdAt * 1000).toISOString()}`
        );
        if (entry.expiresAt) {
          console.log(
            `  Expires: ${new Date(entry.expiresAt * 1000).toISOString()}`
          );
        }
      });
    }
  });
}
/**
 * Example 5: Practical use case - store KYC information
 */
function kycMetadataExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== KYC Metadata Example ===\n");
    const manager = (0, metadata_1.createMetadataManager)({
      horizonUrl: "https://horizon-testnet.stellar.org",
    });
    const accountId = "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF";
    // Store KYC data on the account
    const kycData = {
      status: "verified",
      level: "professional",
      documentId: "KYC-2024-001",
      verificationDate: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const txn = yield manager.prepareSetMetadata({
      accountId,
      key: "kyc-verification",
      value: JSON.stringify(kycData),
      type: "kyc",
      expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year
    });
    console.log("KYC Transaction ready:");
    console.log(JSON.stringify(kycData, null, 2));
    console.log(
      "\nTransaction XDR (first 100 chars):",
      txn.substring(0, 100) + "..."
    );
    // Later, retrieve and verify KYC status
    const savedKyc = yield manager.getMetadata({
      accountId,
      key: "kyc-verification",
    });
    if (savedKyc) {
      const kycInfo = JSON.parse(savedKyc.value);
      const isExpired = savedKyc.expiresAt < Math.floor(Date.now() / 1000);
      console.log("\nKYC Status:");
      console.log(`- Verification Level: ${kycInfo.level}`);
      console.log(`- Status: ${kycInfo.status}`);
      console.log(`- Verified On: ${kycInfo.verificationDate}`);
      console.log(`- Expired: ${isExpired}`);
    }
  });
}
/**
 * Example 6: Delete metadata
 */
function deleteMetadataExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Delete Metadata Example ===\n");
    const manager = (0, metadata_1.createMetadataManager)();
    const accountId = "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF";
    // First, set some metadata
    yield manager.prepareSetMetadata({
      accountId,
      key: "temporary-data",
      value: "This will be deleted",
    });
    console.log("Set temporary metadata: temporary-data");
    // Later, delete it
    const deleteTxn = yield manager.prepareDeleteMetadata(
      accountId,
      "temporary-data"
    );
    console.log("Delete transaction prepared");
    console.log(
      "Transaction XDR (first 50 chars):",
      deleteTxn.substring(0, 50) + "..."
    );
    // Verify it's deleted by trying to retrieve
    const deleted = yield manager.getMetadata({
      accountId,
      key: "temporary-data",
    });
    console.log(`\nMetadata deleted: ${deleted === null}`);
  });
}
/**
 * Example 7: Practical use case - store on-chain application state
 */
function applicationStateExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Application State Example ===\n");
    const manager = (0, metadata_1.createMetadataManager)();
    const appAccountId =
      "GADDM5YJRQYHCR46JQKKGV5JBHIIJ3IXVJ3BBQFN5PLMVFXXUTDBWZF";
    // Store application state/configuration
    const appState = {
      version: "2.0.1",
      lastUpdated: new Date().toISOString(),
      features: ["feature-a", "feature-b"],
      configuration: {
        rateLimit: 100,
        timeout: 30,
        retryAttempts: 3,
      },
    };
    const txn = yield manager.prepareSetMetadata({
      accountId: appAccountId,
      key: "app-config",
      value: JSON.stringify(appState),
      type: "application-config",
    });
    console.log("Storing application state:");
    console.log(JSON.stringify(appState, null, 2));
    // Retrieve and use the configuration
    const config = yield manager.getMetadata({
      accountId: appAccountId,
      key: "app-config",
    });
    if (config) {
      const appConfig = JSON.parse(config.value);
      console.log("\nApplication Configuration Retrieved:");
      console.log(`- Version: ${appConfig.version}`);
      console.log(`- Rate Limit: ${appConfig.configuration.rateLimit} req/min`);
      console.log(`- Timeout: ${appConfig.configuration.timeout}s`);
      console.log(`- Features: ${appConfig.features.join(", ")}`);
    }
  });
}
/**
 * Run all examples
 */
function runAllExamples() {
  return __awaiter(this, void 0, void 0, function* () {
    try {
      yield basicMetadataExample();
      yield metadataWithExpirationExample();
      yield batchMetadataExample();
      yield listMetadataExample();
      yield kycMetadataExample();
      yield deleteMetadataExample();
      yield applicationStateExample();
    } catch (error) {
      console.error("Error running examples:", error);
    }
  });
}
// Run all examples if this file is executed directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}
