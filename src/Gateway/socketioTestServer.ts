/**
 * Socket.io Server Test - Standalone
 * Doesn't require the full Express server or database
 * Run with: npx ts-node src/Gateway/socketioTestServer.ts
 */

import http from "http";
import { initializeSocketManager, getSocketManager } from "./socketManager";
import {
  TransactionUpdateHelper,
  BotUpdateHelper,
  DeploymentUpdateHelper,
} from "./realtimeIntegration";

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════╗");
  console.log("║   Socket.io Test Server (No DB Required)              ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  // Create a simple HTTP server
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Socket.io Test Server - Listening on :3000");
  });

  // Initialize Socket.io
  console.log("📡 Initializing Socket.io on port 3000...");
  initializeSocketManager(httpServer);
  const socketManager = getSocketManager();

  // Start the HTTP server
  httpServer.listen(3000, () => {
    console.log("✅ Server is running on http://localhost:3000");
    console.log("\n📋 In another terminal, run:");
    console.log("   npx ts-node src/Gateway/debugClient.ts\n");
  });

  // Function to emit test events
  const emitTestEvents = () => {
    const userId = "test-user";
    const txId = "tx-" + Date.now();
    const botId = "bot-" + Date.now();
    const deploymentId = "deploy-" + Date.now();

    console.log(
      `\n🚀 Emitting test events at ${new Date().toLocaleTimeString()}...\n`
    );

    // Transaction
    TransactionUpdateHelper.notifyCreated(txId, "hash_123", userId);
    console.log("  💸 Transaction Created emitted");

    setTimeout(() => {
      TransactionUpdateHelper.notifyConfirmed(
        txId,
        "hash_123",
        12345,
        1200,
        userId
      );
      console.log("  ✅ Transaction Confirmed emitted");
    }, 1000);

    // Bot
    setTimeout(() => {
      BotUpdateHelper.notifyInfo("Trading initiated", botId, userId);
      console.log("  🤖 Bot Alert emitted");
    }, 2000);

    setTimeout(() => {
      BotUpdateHelper.notifyStatusActive(botId, userId);
      console.log("  🔄 Bot Status Active emitted");
    }, 3000);

    // Deployment
    setTimeout(() => {
      DeploymentUpdateHelper.notifyStarted(deploymentId, userId);
      console.log("  🚀 Deployment Started emitted");
    }, 4000);

    setTimeout(() => {
      DeploymentUpdateHelper.notifyProgress(
        deploymentId,
        50,
        "Building...",
        userId
      );
      console.log("  🚀 Deployment Progress (50%) emitted");
    }, 5000);

    setTimeout(() => {
      DeploymentUpdateHelper.notifyCompleted(deploymentId, userId, {
        contractAddress: "CAxxxx",
      });
      console.log("  🚀 Deployment Completed emitted\n");
    }, 6000);
  };

  // Emit events every 10 seconds
  console.log("⏰ Will emit test events every 10 seconds\n");
  setInterval(emitTestEvents, 10000);

  // Emit once immediately
  emitTestEvents();

  // Handle shutdown
  process.on("SIGINT", async () => {
    console.log("\n\n🛑 Shutting down...");
    await socketManager.close();
    httpServer.close(() => {
      console.log("✅ Server closed");
      // @ts-ignore
      globalThis.process?.exit?.(0);
    });
  });
}

main().catch(console.error);
