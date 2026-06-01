/**
 * Manual Socket.io Client Test
 * Connects to the real-time server and listens for events
 * Run with: npx ts-node src/Gateway/manualTestClient.ts
 */

import { createRealtimeClient } from "./realtimeClient";
import type {
  TransactionStatusUpdate,
  BotAlert,
  BotStatusChange,
  DeploymentStatus,
} from "./socketManager";

async function main() {
  console.log(
    "\n╔═══════════════════════════════════════════════════════════╗"
  );
  console.log("║   Socket.io Client - Manual Test                          ║");
  console.log(
    "╚═══════════════════════════════════════════════════════════╝\n"
  );

  const userId = "manual-test-user-" + Date.now();
  const serverUrl = process.env.SOCKET_SERVER_URL || "http://localhost:3000";

  console.log(`📡 Connecting to server: ${serverUrl}`);
  console.log(`👤 User ID: ${userId}\n`);

  try {
    // Create and connect client
    const client = createRealtimeClient(serverUrl, userId);

    console.log("⏳ Connecting...");
    await client.connect();
    console.log("✅ Connected!\n");

    // Setup event listeners
    console.log("📋 Listening for events...\n");

    client.on("transaction:created", (data: TransactionStatusUpdate) => {
      console.log("💸 Transaction Created:");
      console.log("  ", JSON.stringify(data, null, 2));
    });

    client.on("transaction:confirmed", (data: TransactionStatusUpdate) => {
      console.log("✅ Transaction Confirmed:");
      console.log("  ", JSON.stringify(data, null, 2));
    });

    client.on("transaction:failed", (data: TransactionStatusUpdate) => {
      console.log("❌ Transaction Failed:");
      console.log("  ", JSON.stringify(data, null, 2));
    });

    client.on("bot:alert", (data: BotAlert) => {
      console.log("🤖 Bot Alert:");
      console.log("  ", JSON.stringify(data, null, 2));
    });

    client.on("bot:status-change", (data: BotStatusChange) => {
      console.log("🔄 Bot Status Change:");
      console.log("  ", JSON.stringify(data, null, 2));
    });

    client.on("swap:status", (data: TransactionStatusUpdate) => {
      console.log("💱 Swap Status:");
      console.log("  ", JSON.stringify(data, null, 2));
    });

    client.on("deployment:status", (data: DeploymentStatus) => {
      console.log("🚀 Deployment Status:");
      console.log("  ", JSON.stringify(data, null, 2));
    });

    client.on("disconnect", () => {
      console.log("\n❌ Disconnected from server");
      process.exit(0);
    });

    client.on("error", (error: Error) => {
      console.error("⚠️  Client error:", error);
    });

    console.log("━".repeat(61));
    console.log("✨ Waiting for real-time updates from the server...");
    console.log("   (Make sure to run another terminal with: npm run dev)");
    console.log("   (Then trigger events from another service)");
    console.log("━".repeat(61));
    console.log("");

    // Keep the client running
    await new Promise(() => {
      // Never resolves - client stays connected
    });
  } catch (error) {
    console.error("❌ Connection failed:", error);
    process.exit(1);
  }
}

main();
