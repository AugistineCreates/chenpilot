/**
 * Real-Time Updates - Test/Demo File
 * Run this with: npx ts-node src/Gateway/socketManagerTest.ts
 * Or import functions in your test suite
 */

import { getSocketManager } from "./socketManager";
import {
  TransactionUpdateHelper,
  BotUpdateHelper,
  SwapUpdateHelper,
  DeploymentUpdateHelper,
} from "./realtimeIntegration";

/**
 * Demo: Simulate a complete transaction flow
 */
export async function demoTransactionFlow() {
  console.log("\n=== TRANSACTION FLOW DEMO ===");

  const txId = `tx-demo-${Date.now()}`;
  const txHash = "hash_" + Math.random().toString(36).substr(2, 9);
  const userId = "demo-user-123";

  try {
    console.log(`\n1. Creating transaction: ${txId}`);
    TransactionUpdateHelper.notifyCreated(txId, txHash, userId);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(`2. Transaction pending...`);
    TransactionUpdateHelper.notifyPending(txId, txHash, userId);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(`3. Transaction confirmed on ledger 12345`);
    TransactionUpdateHelper.notifyConfirmed(txId, txHash, 12345, 1200, userId);

    console.log("✓ Transaction flow completed");
  } catch (error) {
    console.error("✗ Error in transaction demo:", error);
  }
}

/**
 * Demo: Simulate a swap operation
 */
export async function demoSwapFlow() {
  console.log("\n=== SWAP FLOW DEMO ===");

  const swapId = `swap-demo-${Date.now()}`;
  const txHash = "swap_hash_" + Math.random().toString(36).substr(2, 9);
  const userId = "demo-user-123";

  try {
    console.log(`\n1. Starting swap: ${swapId}`);
    SwapUpdateHelper.notifyStarted(swapId, txHash, userId);

    for (let i = 0; i <= 100; i += 25) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log(`2. Swap progress: ${i}%`);
      SwapUpdateHelper.notifyProgress(swapId, txHash, i, userId);
    }

    console.log(`3. Swap completed`);
    SwapUpdateHelper.notifyCompleted(
      swapId,
      txHash,
      {
        inputAmount: "100 USDC",
        outputAmount: "95.5 XLM",
        slippage: "4.5%",
      },
      userId
    );

    console.log("✓ Swap flow completed");
  } catch (error) {
    console.error("✗ Error in swap demo:", error);
  }
}

/**
 * Demo: Simulate bot operation
 */
export async function demoBotFlow() {
  console.log("\n=== BOT FLOW DEMO ===");

  const botId = `bot-demo-${Date.now()}`;
  const userId = "demo-user-123";

  try {
    console.log(`\n1. Activating bot: ${botId}`);
    BotUpdateHelper.notifyStatusActive(botId, userId);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(`2. Bot is monitoring market...`);
    BotUpdateHelper.notifyInfo("Market scan initiated", botId, userId, {
      pairs: 5,
      interval: "5m",
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    console.log(`3. Warning: Volatility spike detected`);
    BotUpdateHelper.notifyWarning(
      "High volatility detected, reducing position size",
      botId,
      userId,
      { volatilityIndex: 85, positionReduction: "50%" }
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(`4. Execution: Trade completed`);
    BotUpdateHelper.notifyInfo("Trade executed successfully", botId, userId, {
      tradeId: "T-001",
      profit: "$245.50",
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(`5. All systems normal`);
    BotUpdateHelper.notifyStatusActive(botId, userId);

    console.log("✓ Bot flow completed");
  } catch (error) {
    console.error("✗ Error in bot demo:", error);
  }
}

/**
 * Demo: Simulate deployment operation
 */
export async function demoDeploymentFlow() {
  console.log("\n=== DEPLOYMENT FLOW DEMO ===");

  const deploymentId = `deploy-demo-${Date.now()}`;
  const userId = "demo-user-123";

  try {
    console.log(`\n1. Starting deployment: ${deploymentId}`);
    DeploymentUpdateHelper.notifyStarted(deploymentId, userId);

    const steps = [
      { progress: 25, message: "Building contracts..." },
      { progress: 50, message: "Compiling WASM..." },
      { progress: 75, message: "Uploading to blockchain..." },
      { progress: 90, message: "Verifying deployment..." },
    ];

    for (const step of steps) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log(`${step.progress}% - ${step.message}`);
      DeploymentUpdateHelper.notifyProgress(
        deploymentId,
        step.progress,
        step.message,
        userId
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(`✓ Deployment completed`);
    DeploymentUpdateHelper.notifyCompleted(deploymentId, userId, {
      contractAddress:
        "CAB3XVCPLXL52VYXQ5BNQKR2Q5NBZNX3D7HW3IRXJQWN76DQQDLGET7",
      gasUsed: "15,000,000",
      deploymentTime: "45s",
    });

    console.log("✓ Deployment flow completed");
  } catch (error) {
    console.error("✗ Error in deployment demo:", error);
  }
}

/**
 * Demo: Check Socket.io stats
 */
export function demoCheckStats() {
  console.log("\n=== SOCKET.IO STATISTICS ===");

  try {
    const socketManager = getSocketManager();

    console.log(
      `Connected clients: ${socketManager.getConnectedClientsCount()}`
    );
    console.log(
      `Connected clients: ${JSON.stringify(
        socketManager.getAllConnectedClients(),
        null,
        2
      )}`
    );

    console.log("✓ Stats retrieved");
  } catch (error) {
    console.error("✗ Error retrieving stats:", error);
  }
}

/**
 * Run all demos
 */
export async function runAllDemos() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Real-Time Updates Socket.io - Test Suite                 ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  try {
    await demoTransactionFlow();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await demoSwapFlow();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await demoBotFlow();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await demoDeploymentFlow();
    await new Promise((resolve) => setTimeout(resolve, 500));

    demoCheckStats();

    console.log(
      "\n╔════════════════════════════════════════════════════════════╗"
    );
    console.log("║   ✓ All demos completed successfully!                    ║");
    console.log(
      "╚════════════════════════════════════════════════════════════╝\n"
    );
  } catch (error) {
    console.error("✗ Error running demos:", error);
  }
}

// Run if executed directly
if (require.main === module) {
  runAllDemos();
}

export default runAllDemos;
