/**
 * REAL-TIME UPDATES USAGE EXAMPLES
 *
 * This file demonstrates how to integrate Socket.io real-time updates
 * into your existing services.
 */

import {
  TransactionUpdateHelper,
  SwapUpdateHelper,
  BotUpdateHelper,
  DeploymentUpdateHelper,
} from "./realtimeIntegration";

// ============================================
// EXAMPLE 1: Transaction Service Integration
// ============================================

/**
 * Example: Emit transaction status updates
 */
export async function exampleTransactionService(userId: string) {
  const transactionId = "tx-123456";
  const transactionHash = "hash_abc123xyz";

  // Notify transaction created
  TransactionUpdateHelper.notifyCreated(transactionId, transactionHash, userId);

  // Simulate processing
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Notify transaction confirmed with ledger info
  TransactionUpdateHelper.notifyConfirmed(
    transactionId,
    transactionHash,
    12345, // ledger
    1200, // fee used
    userId
  );
}

// Usage in transaction service:
// import { TransactionUpdateHelper } from "./Gateway/realtimeIntegration";
//
// export async function processTransaction(txData, userId) {
//   const txId = generateId();
//   const txHash = txData.hash;
//
//   TransactionUpdateHelper.notifyCreated(txId, txHash, userId);
//   try {
//     const result = await submitToBlockchain(txData);
//     TransactionUpdateHelper.notifyConfirmed(
//       txId,
//       txHash,
//       result.ledger,
//       result.fee,
//       userId
//     );
//   } catch (error) {
//     TransactionUpdateHelper.notifyFailed(
//       txId,
//       txHash,
//       error.message,
//       userId
//     );
//   }
// }

// ============================================
// EXAMPLE 2: Swap Service Integration
// ============================================

/**
 * Example: Emit swap status updates
 */
export async function exampleSwapService(userId: string) {
  const swapId = "swap-789";
  const transactionHash = "swap_hash_def456";

  // Notify swap started
  SwapUpdateHelper.notifyStarted(swapId, transactionHash, userId);

  // Simulate swap progress
  for (let i = 0; i <= 100; i += 25) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    SwapUpdateHelper.notifyProgress(swapId, transactionHash, i, userId);
  }

  // Notify swap completed with details
  SwapUpdateHelper.notifyCompleted(
    swapId,
    transactionHash,
    {
      inputAmount: "100",
      outputAmount: "95.5",
      slippage: "4.5%",
      route: ["USDC", "XLM", "NATIVE"],
    },
    userId
  );
}

// Usage in swap service:
// import { SwapUpdateHelper } from "./Gateway/realtimeIntegration";
//
// export async function executeSwap(swapParams, userId) {
//   const swapId = generateSwapId();
//
//   SwapUpdateHelper.notifyStarted(swapId, swapParams.txHash, userId);
//
//   try {
//     const result = await performSwapOperations(swapParams);
//     SwapUpdateHelper.notifyCompleted(
//       swapId,
//       swapParams.txHash,
//       {
//         inputAmount: result.input,
//         outputAmount: result.output,
//         actualPrice: result.price,
//       },
//       userId
//     );
//   } catch (error) {
//     SwapUpdateHelper.notifyFailed(swapId, swapParams.txHash, error.message, userId);
//   }
// }

// ============================================
// EXAMPLE 3: Bot Service Integration
// ============================================

/**
 * Example: Emit bot alerts and status changes
 */
export async function exampleBotService(botId: string, userId: string) {
  // Notify bot started
  BotUpdateHelper.notifyStatusActive(botId, userId);
  BotUpdateHelper.notifyInfo(
    "Bot initialized and ready for operations",
    botId,
    userId
  );

  // Simulate bot operations
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Notify warning
  BotUpdateHelper.notifyWarning(
    "Market volatility detected, reducing position size",
    botId,
    userId,
    { volatilityIndex: 75 }
  );

  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Notify info about successful operation
  BotUpdateHelper.notifyInfo("Trade executed successfully", botId, userId, {
    tradeId: "trade-999",
    profit: "+$245.50",
  });
}

// Usage in bot service:
// import { BotUpdateHelper } from "./Gateway/realtimeIntegration";
// import { BotStatusChange } from "./Gateway/socketManager";
//
// export class AgentBot {
//   async run(userId: string) {
//     BotUpdateHelper.notifyStatusActive(this.botId, userId);
//
//     try {
//       // Monitor market
//       const market = await getMarketData();
//
//       if (market.volatility > 80) {
//         BotUpdateHelper.notifyWarning(
//           "High volatility detected",
//           this.botId,
//           userId,
//           { volatility: market.volatility }
//         );
//       }
//
//       // Execute trades
//       const trade = await this.executeTrade(market);
//       BotUpdateHelper.notifyInfo(
//         `Trade executed: ${trade.action}`,
//         this.botId,
//         userId,
//         { trade }
//       );
//     } catch (error) {
//       BotUpdateHelper.notifyError(
//         `Bot error: ${error.message}`,
//         this.botId,
//         userId
//       );
//       BotUpdateHelper.notifyStatusError(this.botId, error.message, userId);
//     }
//   }
// }

// ============================================
// EXAMPLE 4: Deployment Service Integration
// ============================================

/**
 * Example: Emit deployment status updates
 */
export async function exampleDeploymentService(userId: string) {
  const deploymentId = "deploy-456";

  // Notify deployment started
  DeploymentUpdateHelper.notifyStarted(deploymentId, userId);

  // Simulate deployment steps
  const steps = [
    { progress: 25, message: "Building contracts..." },
    { progress: 50, message: "Compiling WASM..." },
    { progress: 75, message: "Uploading to blockchain..." },
    { progress: 100, message: "Finalizing deployment..." },
  ];

  for (const step of steps) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    DeploymentUpdateHelper.notifyProgress(
      deploymentId,
      step.progress,
      step.message,
      userId
    );
  }

  // Notify deployment completed
  DeploymentUpdateHelper.notifyCompleted(deploymentId, userId, {
    contractAddress: "CAB3XVCPLXL52VYXQ5BNQKR2Q5NBZNX3D7HW3IRXJQWN76DQQDLGET7",
    gasUsed: "15000000",
    deploymentTime: "45s",
  });
}

// Usage in deployment service:
// import { DeploymentUpdateHelper } from "./Gateway/realtimeIntegration";
//
// export async function deployContracts(contracts, userId) {
//   const deploymentId = generateDeploymentId();
//
//   DeploymentUpdateHelper.notifyStarted(deploymentId, userId);
//
//   try {
//     for (let i = 0; i < contracts.length; i++) {
//       const contract = contracts[i];
//       const progress = Math.round((i / contracts.length) * 50);
//
//       DeploymentUpdateHelper.notifyProgress(
//         deploymentId,
//         progress,
//         `Deploying contract: ${contract.name}`,
//         userId
//       );
//
//       const result = await deployContract(contract);
//       contractAddresses[contract.name] = result.address;
//     }
//
//     DeploymentUpdateHelper.notifyProgress(
//       deploymentId,
//       90,
//       "Verifying deployment...",
//       userId
//     );
//
//     await verifyDeployment(contractAddresses);
//
//     DeploymentUpdateHelper.notifyCompleted(
//       deploymentId,
//       userId,
//       { contracts: contractAddresses }
//     );
//   } catch (error) {
//     DeploymentUpdateHelper.notifyFailed(
//       deploymentId,
//       error.message,
//       userId
//     );
//   }
// }

// ============================================
// EXAMPLE 5: Client-Side Usage
// ============================================

/**
 * Example: Client-side listening to real-time updates
 */
export function exampleClientUsage() {
  // Import the client
  // import { createRealtimeClient } from "./Gateway/realtimeClient";
  //
  // const client = createRealtimeClient(
  //   "http://localhost:3000",
  //   "user-123"
  // );
  //
  // // Connect to server
  // await client.connect();
  //
  // // Listen for transaction updates
  // client.on("transaction:created", (update) => {
  //   console.log("Transaction created:", update.transactionId);
  //   showNotification(`Transaction ${update.transactionId} created`);
  // });
  //
  // client.on("transaction:confirmed", (update) => {
  //   console.log("Transaction confirmed:", update.transactionId, update.ledger);
  //   updateTransactionStatus(update.transactionId, "confirmed");
  // });
  //
  // client.on("transaction:failed", (update) => {
  //   console.error("Transaction failed:", update.transactionId);
  //   showErrorNotification(`Transaction failed: ${update.memo}`);
  // });
  //
  // // Listen for bot alerts
  // client.on("bot:alert", (alert) => {
  //   console.log(`Bot Alert [${alert.severity}]:`, alert.message);
  //   if (alert.severity === "critical") {
  //     playAlarmSound();
  //   }
  // });
  //
  // client.on("bot:status-change", (statusChange) => {
  //   console.log(`Bot ${statusChange.botId} is now ${statusChange.status}`);
  //   updateBotStatusUI(statusChange.botId, statusChange.status);
  // });
  //
  // // Subscribe to specific transaction
  // client.subscribeToTransaction("tx-123456");
  //
  // // Subscribe to bot alerts
  // client.subscribeToBotAlerts("bot-789");
}

// ============================================
// EXAMPLE 6: Integration with Webhook Service
// ============================================

/**
 * Example: Emitting updates when webhook events are received
 */
export async function exampleWebhookIntegration(
  webhookPayload: any,
  userId: string
) {
  // When webhook is received, emit real-time update
  if (webhookPayload.type === "funding") {
    TransactionUpdateHelper.notifyConfirmed(
      webhookPayload.data.transaction_hash,
      webhookPayload.data.transaction_hash,
      webhookPayload.data.ledger,
      undefined,
      userId
    );
  }

  if (webhookPayload.type === "swap_completed") {
    SwapUpdateHelper.notifyCompleted(
      webhookPayload.data.swap_id,
      webhookPayload.data.transaction_hash,
      {
        inputAmount: webhookPayload.data.input_amount,
        outputAmount: webhookPayload.data.output_amount,
      },
      userId
    );
  }
}

// Usage in webhook service:
// import { TransactionUpdateHelper } from "./Gateway/realtimeIntegration";
//
// export async function processStellarWebhook(payload) {
//   const userId = await getUserIdFromTransaction(payload.data.transaction_hash);
//
//   if (payload.data.transaction_successful) {
//     TransactionUpdateHelper.notifyConfirmed(
//       payload.data.transaction_hash,
//       payload.data.transaction_hash,
//       payload.data.ledger,
//       payload.data.fee_paid,
//       userId
//     );
//   } else {
//     TransactionUpdateHelper.notifyFailed(
//       payload.data.transaction_hash,
//       payload.data.transaction_hash,
//       "Transaction failed on blockchain",
//       userId
//     );
//   }
// }
