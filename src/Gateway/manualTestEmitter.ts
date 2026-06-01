/**
 * Manual Event Trigger Script
 * Emits real-time events to test Socket.io
 * Run with: npx ts-node src/Gateway/manualTestEmitter.ts
 */

import {
  TransactionUpdateHelper,
  BotUpdateHelper,
  DeploymentUpdateHelper,
  SwapUpdateHelper,
} from "./realtimeIntegration";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(
    "\n╔═══════════════════════════════════════════════════════════╗"
  );
  console.log("║   Socket.io Event Emitter - Manual Test                   ║");
  console.log(
    "╚═══════════════════════════════════════════════════════════╝\n"
  );

  const userId = "manual-test-user";
  const txId = "tx-" + Date.now();
  const botId = "bot-" + Date.now();
  const deploymentId = "deploy-" + Date.now();

  console.log("Make sure the server is running: npm run dev\n");
  console.log(
    "And the client is listening: npx ts-node src/Gateway/manualTestClient.ts\n"
  );
  console.log("═".repeat(61) + "\n");

  try {
    // Transaction Flow
    console.log("📝 1. Emitting Transaction Created...");
    TransactionUpdateHelper.notifyCreated(txId, "hash_abc123", userId);
    await sleep(2000);

    console.log("✅ 2. Emitting Transaction Confirmed...");
    TransactionUpdateHelper.notifyConfirmed(
      txId,
      "hash_abc123",
      12345,
      1200,
      userId
    );
    await sleep(2000);

    // Bot Flow
    console.log("🤖 3. Emitting Bot Alert (Info)...");
    BotUpdateHelper.notifyInfo("Trading strategy initialized", botId, userId);
    await sleep(2000);

    console.log("🔄 4. Emitting Bot Status Active...");
    BotUpdateHelper.notifyStatusActive(botId, userId);
    await sleep(2000);

    // Swap Flow
    console.log("💱 5. Emitting Swap Started...");
    SwapUpdateHelper.notifyStarted("swap_" + Date.now(), "hash_swap", userId);
    await sleep(2000);

    console.log("💱 6. Emitting Swap Completed...");
    SwapUpdateHelper.notifyCompleted(
      "swap_" + Date.now(),
      "hash_swap_complete",
      { output: "95.5 XLNI", input: "100 USDC" },
      userId
    );
    await sleep(2000);

    // Deployment Flow
    console.log("🚀 7. Emitting Deployment Started...");
    DeploymentUpdateHelper.notifyStarted(deploymentId, userId);
    await sleep(1000);

    console.log("🚀 8. Emitting Deployment Progress (25%)...");
    DeploymentUpdateHelper.notifyProgress(
      deploymentId,
      25,
      "Building...",
      userId
    );
    await sleep(1000);

    console.log("🚀 9. Emitting Deployment Progress (75%)...");
    DeploymentUpdateHelper.notifyProgress(
      deploymentId,
      75,
      "Deploying to network...",
      userId
    );
    await sleep(1000);

    console.log("🚀 10. Emitting Deployment Completed...");
    DeploymentUpdateHelper.notifyCompleted(deploymentId, userId, {
      contractAddress:
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQM",
      txHash: "hash_deployment_success",
      network: "Soroban",
    });
    await sleep(2000);

    // More events
    console.log("⚠️  11. Emitting Bot Warning...");
    BotUpdateHelper.notifyWarning("High slippage detected", botId, userId);
    await sleep(2000);

    console.log("❌ 12. Emitting Transaction Failed...");
    TransactionUpdateHelper.notifyFailed(
      "tx_failed_" + Date.now(),
      "hash_failed",
      "Insufficient balance",
      userId
    );
    await sleep(2000);

    console.log("\n" + "═".repeat(61));
    console.log("✅ All events emitted successfully!");
    console.log("═".repeat(61) + "\n");

    console.log("Check your client terminal to see all the events received.\n");
    console.log("You can run this script again to emit more events.\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
