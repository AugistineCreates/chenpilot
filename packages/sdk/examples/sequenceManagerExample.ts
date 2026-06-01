/**
 * Sequence Manager Example
 *
 * Demonstrates how to use the Sequence Manager for concurrent
 * Stellar transaction submissions
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { SequenceManager, createStellarSequenceHelper } from "../src";

// Example 1: Basic Usage
async function basicExample() {
  console.log("=== Basic Sequence Manager Example ===\n");

  const sequenceManager = new SequenceManager({
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
  const sequenceInfo = await sequenceManager.getNextSequence(
    accountId,
    async () => {
      const account = await server.loadAccount(accountId);
      return account.sequenceNumber();
    }
  );

  console.log("Sequence Info:", sequenceInfo);
  console.log();

  sequenceManager.destroy();
}

// Example 2: Concurrent Transaction Submission
async function concurrentExample() {
  console.log("=== Concurrent Transaction Submission ===\n");

  const server = new StellarSdk.Horizon.Server(
    "https://horizon-testnet.stellar.org"
  );

  const helper = createStellarSequenceHelper(server);

  // Generate keypairs
  const sourceKeypair = StellarSdk.Keypair.random();
  const destinationKeypair = StellarSdk.Keypair.random();

  console.log("Source:", sourceKeypair.publicKey());
  console.log("Destination:", destinationKeypair.publicKey());
  console.log();

  // Simulate 10 concurrent payment transactions
  const promises = Array.from({ length: 10 }, async (_, i) => {
    try {
      const managed = await helper.buildManagedTransaction(
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
  });

  const results = await Promise.all(promises);

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
}

// Example 3: Transaction Lifecycle Tracking
async function lifecycleExample() {
  console.log("=== Transaction Lifecycle Tracking ===\n");

  const sequenceManager = new SequenceManager({
    cacheTTL: 30000,
    maxPendingTransactions: 100,
    autoRefresh: false,
  });

  const accountId = "GABC123EXAMPLE";

  // Simulate getting sequence
  const sequenceInfo = await sequenceManager.getNextSequence(
    accountId,
    async () => "100"
  );

  console.log("1. Got next sequence:", sequenceInfo.next);

  // Reserve sequence
  const transaction = await sequenceManager.reserveSequence(
    accountId,
    sequenceInfo.next,
    { type: "payment", amount: "100" }
  );

  console.log("2. Reserved sequence:", transaction?.sequence);

  // Mark as submitted
  await sequenceManager.markSubmitted(
    accountId,
    sequenceInfo.next,
    "txhash123"
  );
  console.log("3. Marked as submitted");

  // Check pending
  let pending = sequenceManager.getPendingTransactions(accountId);
  console.log("4. Pending transactions:", pending.length);
  console.log("   Status:", pending[0]?.status);

  // Mark as confirmed
  await sequenceManager.markConfirmed(accountId, sequenceInfo.next);
  console.log("5. Marked as confirmed");

  // Check pending again
  pending = sequenceManager.getPendingTransactions(accountId);
  console.log("6. Pending transactions:", pending.length);
  console.log();

  sequenceManager.destroy();
}

// Example 4: Error Handling and Retry
async function errorHandlingExample() {
  console.log("=== Error Handling and Retry ===\n");

  const server = new StellarSdk.Horizon.Server(
    "https://horizon-testnet.stellar.org"
  );

  const helper = createStellarSequenceHelper(server);
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
      const managed = await helper.buildManagedTransaction(
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
        await helper.refreshSequence(accountId);
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  if (!success) {
    console.log("\nAll retry attempts failed");
  }

  console.log();
}

// Example 5: Monitoring and Statistics
async function monitoringExample() {
  console.log("=== Monitoring and Statistics ===\n");

  const sequenceManager = new SequenceManager({
    cacheTTL: 30000,
    maxPendingTransactions: 100,
  });

  // Simulate multiple accounts with transactions
  const accounts = ["GABC123", "GDEF456", "GHIJ789"];

  for (const accountId of accounts) {
    await sequenceManager.getNextSequence(accountId, async () => "100");
    await sequenceManager.getNextSequence(accountId, async () => "100");
    await sequenceManager.reserveSequence(accountId, "101");
    await sequenceManager.reserveSequence(accountId, "102");
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
}

// Run all examples
async function runAllExamples() {
  try {
    await basicExample();
    await concurrentExample();
    await lifecycleExample();
    await errorHandlingExample();
    await monitoringExample();

    console.log("All examples completed successfully!");
  } catch (error) {
    console.error("Example failed:", error);
  }
}

// Export for use in other files
export {
  basicExample,
  concurrentExample,
  lifecycleExample,
  errorHandlingExample,
  monitoringExample,
  runAllExamples,
};

// Run if executed directly
if (require.main === module) {
  runAllExamples();
}
