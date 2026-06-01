"use strict";
/**
 * Sequence Manager Example
 *
 * Demonstrates how to use the Sequence Manager for concurrent
 * Stellar transaction submissions
 */
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
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
exports.basicExample = basicExample;
exports.concurrentExample = concurrentExample;
exports.lifecycleExample = lifecycleExample;
exports.errorHandlingExample = errorHandlingExample;
exports.monitoringExample = monitoringExample;
exports.runAllExamples = runAllExamples;
const StellarSdk = __importStar(require("@stellar/stellar-sdk"));
const src_1 = require("../src");
// Example 1: Basic Usage
function basicExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Basic Sequence Manager Example ===\n");
    const sequenceManager = new src_1.SequenceManager({
      cacheTTL: 30000,
      maxPendingTransactions: 100,
      autoRefresh: true,
    });
    const server = new StellarSdk.Horizon.Server(
      "https://horizon-testnet.stellar.org"
    );
    const sourceKeypair = StellarSdk.Keypair.random();
    const accountId = sourceKeypair.publicKey();
    console.log("Account ID:", accountId);
    // Get next sequence
    const sequenceInfo = yield sequenceManager.getNextSequence(accountId, () =>
      __awaiter(this, void 0, void 0, function* () {
        const account = yield server.loadAccount(accountId);
        return account.sequenceNumber();
      })
    );
    console.log("Sequence Info:", sequenceInfo);
    console.log();
    sequenceManager.destroy();
  });
}
// Example 2: Concurrent Transaction Submission
function concurrentExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Concurrent Transaction Submission ===\n");
    const server = new StellarSdk.Horizon.Server(
      "https://horizon-testnet.stellar.org"
    );
    const helper = (0, src_1.createStellarSequenceHelper)(server);
    // Generate keypairs
    const sourceKeypair = StellarSdk.Keypair.random();
    const destinationKeypair = StellarSdk.Keypair.random();
    console.log("Source:", sourceKeypair.publicKey());
    console.log("Destination:", destinationKeypair.publicKey());
    console.log();
    // Simulate 10 concurrent payment transactions
    const promises = Array.from({ length: 10 }, (_, i) =>
      __awaiter(this, void 0, void 0, function* () {
        try {
          const managed = yield helper.buildManagedTransaction(
            sourceKeypair.publicKey(),
            StellarSdk.Account,
            (account) => {
              return new StellarSdk.TransactionBuilder(account, {
                fee: StellarSdk.BASE_FEE,
                networkPassphrase: StellarSdk.Networks.TESTNET,
              })
                .addOperation(
                  StellarSdk.Operation.payment({
                    destination: destinationKeypair.publicKey(),
                    asset: StellarSdk.Asset.native(),
                    amount: `${i + 1}`,
                  })
                )
                .setTimeout(30)
                .build();
            }
          );
          console.log(
            `Transaction ${i + 1} built with sequence: ${managed.sequence}`
          );
          return {
            index: i + 1,
            sequence: managed.sequence,
            status: "built",
          };
        } catch (error) {
          console.error(`Transaction ${i + 1} failed:`, error);
          return {
            index: i + 1,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );
    const results = yield Promise.all(promises);
    console.log("\nResults:");
    results.forEach((result) => {
      console.log(
        `  Transaction ${result.index}: ${result.status} (seq: ${result.sequence || "N/A"})`
      );
    });
    // Show statistics
    const stats = helper.getStats();
    console.log("\nStatistics:");
    console.log(`  Accounts tracked: ${stats.accountsTracked}`);
    console.log(`  Total pending: ${stats.totalPending}`);
    console.log();
  });
}
// Example 3: Transaction Lifecycle Tracking
function lifecycleExample() {
  return __awaiter(this, void 0, void 0, function* () {
    var _a;
    console.log("=== Transaction Lifecycle Tracking ===\n");
    const sequenceManager = new src_1.SequenceManager({
      cacheTTL: 30000,
      maxPendingTransactions: 100,
      autoRefresh: false,
    });
    const accountId = "GABC123EXAMPLE";
    // Simulate getting sequence
    const sequenceInfo = yield sequenceManager.getNextSequence(accountId, () =>
      __awaiter(this, void 0, void 0, function* () {
        return "100";
      })
    );
    console.log("1. Got next sequence:", sequenceInfo.next);
    // Reserve sequence
    const transaction = yield sequenceManager.reserveSequence(
      accountId,
      sequenceInfo.next,
      { type: "payment", amount: "100" }
    );
    console.log(
      "2. Reserved sequence:",
      transaction === null || transaction === void 0
        ? void 0
        : transaction.sequence
    );
    // Mark as submitted
    yield sequenceManager.markSubmitted(
      accountId,
      sequenceInfo.next,
      "txhash123"
    );
    console.log("3. Marked as submitted");
    // Check pending
    let pending = sequenceManager.getPendingTransactions(accountId);
    console.log("4. Pending transactions:", pending.length);
    console.log(
      "   Status:",
      (_a = pending[0]) === null || _a === void 0 ? void 0 : _a.status
    );
    // Mark as confirmed
    yield sequenceManager.markConfirmed(accountId, sequenceInfo.next);
    console.log("5. Marked as confirmed");
    // Check pending again
    pending = sequenceManager.getPendingTransactions(accountId);
    console.log("6. Pending transactions:", pending.length);
    console.log();
    sequenceManager.destroy();
  });
}
// Example 4: Error Handling and Retry
function errorHandlingExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Error Handling and Retry ===\n");
    const server = new StellarSdk.Horizon.Server(
      "https://horizon-testnet.stellar.org"
    );
    const helper = (0, src_1.createStellarSequenceHelper)(server);
    const sourceKeypair = StellarSdk.Keypair.random();
    const accountId = sourceKeypair.publicKey();
    console.log("Account ID:", accountId);
    const maxRetries = 3;
    let attempt = 0;
    let success = false;
    while (attempt < maxRetries && !success) {
      attempt++;
      console.log(`\nAttempt ${attempt}/${maxRetries}`);
      try {
        const managed = yield helper.buildManagedTransaction(
          accountId,
          StellarSdk.Account,
          (account) => {
            return new StellarSdk.TransactionBuilder(account, {
              fee: StellarSdk.BASE_FEE,
              networkPassphrase: StellarSdk.Networks.TESTNET,
            })
              .addOperation(
                StellarSdk.Operation.payment({
                  destination: StellarSdk.Keypair.random().publicKey(),
                  asset: StellarSdk.Asset.native(),
                  amount: "100",
                })
              )
              .setTimeout(30)
              .build();
          }
        );
        console.log(`  Built with sequence: ${managed.sequence}`);
        // Simulate submission (would normally submit to network)
        // const result = await server.submitTransaction(managed.transaction);
        // await managed.markSubmitted(result.hash);
        // await managed.markConfirmed();
        success = true;
        console.log("  Success!");
      } catch (error) {
        console.error(
          `  Failed:`,
          error instanceof Error ? error.message : error
        );
        if (attempt < maxRetries) {
          console.log("  Refreshing sequence and retrying...");
          yield helper.refreshSequence(accountId);
          yield new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    if (!success) {
      console.log("\nAll retry attempts failed");
    }
    console.log();
  });
}
// Example 5: Monitoring and Statistics
function monitoringExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Monitoring and Statistics ===\n");
    const sequenceManager = new src_1.SequenceManager({
      cacheTTL: 30000,
      maxPendingTransactions: 100,
    });
    // Simulate multiple accounts with transactions
    const accounts = ["GABC123", "GDEF456", "GHIJ789"];
    for (const accountId of accounts) {
      yield sequenceManager.getNextSequence(accountId, () =>
        __awaiter(this, void 0, void 0, function* () {
          return "100";
        })
      );
      yield sequenceManager.getNextSequence(accountId, () =>
        __awaiter(this, void 0, void 0, function* () {
          return "100";
        })
      );
      yield sequenceManager.reserveSequence(accountId, "101");
      yield sequenceManager.reserveSequence(accountId, "102");
    }
    // Get overall statistics
    const stats = sequenceManager.getStats();
    console.log("Overall Statistics:");
    console.log(`  Accounts tracked: ${stats.accountsTracked}`);
    console.log(`  Total pending: ${stats.totalPending}`);
    console.log();
    console.log("Per-Account Statistics:");
    stats.accountStats.forEach((stat) => {
      console.log(`  ${stat.accountId}:`);
      console.log(`    Pending: ${stat.pendingCount}`);
      console.log(`    Cache age: ${stat.cacheAge}ms`);
      console.log(
        `    Last fetched: ${new Date(stat.lastFetched).toISOString()}`
      );
    });
    console.log();
    // Get pending for specific account
    const pending = sequenceManager.getPendingTransactions("GABC123");
    console.log("Pending transactions for GABC123:");
    pending.forEach((tx) => {
      console.log(`  Sequence ${tx.sequence}: ${tx.status}`);
    });
    console.log();
    sequenceManager.destroy();
  });
}
// Run all examples
function runAllExamples() {
  return __awaiter(this, void 0, void 0, function* () {
    try {
      yield basicExample();
      yield concurrentExample();
      yield lifecycleExample();
      yield errorHandlingExample();
      yield monitoringExample();
      console.log("All examples completed successfully!");
    } catch (error) {
      console.error("Example failed:", error);
    }
  });
}
// Run if executed directly
if (require.main === module) {
  runAllExamples();
}
