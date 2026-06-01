/**
 * Debug Socket.io Client - Troubleshooting connection issues
 */

import { io } from "socket.io-client";

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════╗");
  console.log("║   Socket.io Debug Client                              ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  const serverUrl = "http://localhost:3000";
  const userId = "debug-user-" + Date.now();

  console.log(`📡 Server URL: ${serverUrl}`);
  console.log(`👤 User ID: ${userId}`);
  console.log("\n⏳ Attempting connection with detailed logging...\n");

  // Create socket with verbose logging
  const socket = io(serverUrl, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10,
    transports: ["websocket", "polling"],
  });

  // Track all connection states
  socket.onAny((event, ...args) => {
    if (event !== "pong") {
      console.log(`[EVENT] ${event}`, args.length ? args : "");
    }
  });

  socket.on("connect", () => {
    console.log("\n✅ ============================================");
    console.log("✅ CONNECTED SUCCESSFULLY!");
    console.log("✅ Socket ID:", socket.id);
    console.log("✅ ============================================\n");

    // Send authentication
    socket.emit("authenticate", userId);
    console.log("🔐 Authentication sent\n");

    // Listen for events
    console.log("📋 Waiting for events...\n");
  });

  socket.on("connecting", () => {
    console.log("⏳ Connecting...");
  });

  socket.on("disconnect", (reason) => {
    console.log("\n❌ Disconnected:", reason);
  });

  socket.on("connect_error", (error: any) => {
    console.log("❌ Connection Error:", error?.message || error);
  });

  socket.on("error", (error: any) => {
    console.log("⚠️  Socket Error:", error);
  });

  // Timeout after 30 seconds
  setTimeout(() => {
    console.log("\n⏱️  30-second timeout reached");
    if (!socket.connected) {
      console.log("❌ NOT CONNECTED - Troubleshooting:");
      console.log("   1. Is 'npm run dev' running?");
      console.log("   2. Check server is listening on port 3000");
      console.log("   3. Check for firewall/proxy issues");
      console.log("   4. Check browser console for CORS errors");
    }
    console.log("Shutting down...\n");
    socket.disconnect();
    // @ts-ignore
    globalThis.process?.exit?.(0);
  }, 30000);

  // Keep running
  await new Promise(() => {
    // Never resolves
  });
}

main().catch(console.error);
