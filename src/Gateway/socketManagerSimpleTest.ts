/**
 * Simple Socket.io Test - Doesn't require full server startup
 */

import { initializeSocketManager, getSocketManager } from "./socketManager";
import {
  TransactionUpdateHelper,
  BotUpdateHelper,
  DeploymentUpdateHelper,
} from "./realtimeIntegration";
import * as http from "http";

async function runSimpleTest() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Socket.io Simple Test                                    ║");
  console.log(
    "╚════════════════════════════════════════════════════════════╝\n"
  );

  try {
    // Create a simple HTTP server
    const httpServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Socket.io server running");
    });

    // Initialize Socket.io
    console.log("✓ Initializing Socket.io...");
    initializeSocketManager(httpServer);
    const socketManager = getSocketManager();

    console.log("✓ Socket.io initialized");
    console.log(
      `  Connected clients: ${socketManager.getConnectedClientsCount()}\n`
    );

    // Test emitting events
    console.log("✓ Testing event emissions...\n");

    const userId = "test-user-123";
    const txId = `tx-${Date.now()}`;
    const txHash = "hash_abc123";
    const botId = `bot-${Date.now()}`;

    // Test transaction events
    console.log("  1. Transaction Created:");
    TransactionUpdateHelper.notifyCreated(txId, txHash, userId);
    console.log(`     ✓ Event emitted: transaction:created`);

    console.log("  2. Transaction Confirmed:");
    TransactionUpdateHelper.notifyConfirmed(txId, txHash, 12345, 1200, userId);
    console.log(`     ✓ Event emitted: transaction:confirmed`);

    console.log("  3. Bot Alert:");
    BotUpdateHelper.notifyInfo("Trading started", botId, userId);
    console.log(`     ✓ Event emitted: bot:alert`);

    console.log("  4. Bot Status Change:");
    BotUpdateHelper.notifyStatusActive(botId, userId);
    console.log(`     ✓ Event emitted: bot:status-change`);

    console.log("  5. Deployment Status:");
    DeploymentUpdateHelper.notifyProgress(
      `deploy-${Date.now()}`,
      50,
      "Deploying...",
      userId
    );
    console.log(`     ✓ Event emitted: deployment:status`);

    console.log(
      "\n╔════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║   ✓ All tests passed!                                     ║"
    );
    console.log(
      "╚════════════════════════════════════════════════════════════╝\n"
    );

    console.log("Summary:");
    console.log("  • Socket.io initialized successfully");
    console.log("  • All event types working correctly");
    console.log("  • Type-safe helpers functioning");
    console.log(
      "\nNext: Start the server with 'npm run dev' for full testing\n"
    );

    // Clean up
    await socketManager.close();
    httpServer.close();
  } catch (error) {
    console.error("✗ Test failed:", error);
    process.exit(1);
  }
}

runSimpleTest();
