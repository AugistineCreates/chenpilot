/**
 * Socket.io Real-Time Updates - PUBLIC EXPORTS
 *
 * This file provides the main entry point for the real-time updates system.
 * Import from this file to get all the necessary functionality.
 */

// Core Server-side APIs
export {
  SocketManager,
  RealtimeEventEmitter,
  initializeSocketManager,
  getSocketManager,
  type RealtimeEventType,
  type TransactionStatusUpdate,
  type BotAlert,
  type BotStatusChange,
  type DeploymentStatus,
} from "./socketManager";

// Event Bridges
export {
  TransactionEventBridge,
  BotEventBridge,
  DeploymentEventBridge,
} from "./eventBridges";

// Integration Helpers
export {
  TransactionUpdateHelper,
  SwapUpdateHelper,
  BotUpdateHelper,
  DeploymentUpdateHelper,
  SafeUpdateEmitter,
} from "./realtimeIntegration";

// Client-side APIs
export { RealtimeClient, createRealtimeClient } from "./realtimeClient";

/**
 * QUICK START GUIDE
 *
 * Server-side (backend):
 * ──────────────────────────────────────────────────────────────
 *
 * 1. The Socket.io server is automatically initialized on startup
 *    (see src/index.ts)
 *
 * 2. To emit transaction updates:
 *    import { TransactionUpdateHelper } from "./Gateway/realtimeIntegration";
 *    TransactionUpdateHelper.notifyCreated(txId, txHash, userId);
 *    TransactionUpdateHelper.notifyConfirmed(txId, txHash, ledger, fee, userId);
 *
 * 3. To emit bot alerts:
 *    import { BotUpdateHelper } from "./Gateway/realtimeIntegration";
 *    BotUpdateHelper.notifyInfo("Message", botId, userId);
 *    BotUpdateHelper.notifyStatusActive(botId, userId);
 *
 * 4. To emit deployment updates:
 *    import { DeploymentUpdateHelper } from "./Gateway/realtimeIntegration";
 *    DeploymentUpdateHelper.notifyProgress(deploymentId, 50, "Deploying...", userId);
 *
 * Client-side (frontend):
 * ──────────────────────────────────────────────────────────────
 *
 * 1. Import and create client:
 *    import { createRealtimeClient } from "./Gateway/realtimeClient";
 *    const client = createRealtimeClient("http://localhost:3000", userId);
 *
 * 2. Connect to server:
 *    await client.connect();
 *
 * 3. Listen to events:
 *    client.on("transaction:confirmed", (update) => {
 *      console.log("Transaction confirmed:", update);
 *    });
 *
 *    client.on("bot:alert", (alert) => {
 *      console.log("Bot alert:", alert);
 *    });
 *
 * 4. Subscribe to specific updates:
 *    client.subscribeToTransaction("tx-123");
 *    client.subscribeToBotAlerts("bot-456");
 *
 * 5. Later, disconnect:
 *    client.disconnect();
 *
 * REST API Endpoints:
 * ──────────────────────────────────────────────────────────────
 *
 * GET /api/realtime/stats
 *   Returns: { success, totalConnected, connectedClients[] }
 *   Use: Get overall Socket.io statistics
 *
 * GET /api/realtime/user/:userId/clients
 *   Returns: { success, userId, connectedClients[], count }
 *   Use: Get all connections for a specific user
 *
 * EVENT TYPES:
 * ──────────────────────────────────────────────────────────────
 *
 * Transaction Events:
 *   - transaction:created      (txId created)
 *   - transaction:update       (generic status update)
 *   - transaction:confirmed    (confirmed on blockchain)
 *   - transaction:failed       (transaction failed)
 *
 * Bot Events:
 *   - bot:alert               (alert with severity level)
 *   - bot:status-change       (status changed)
 *   - bot:error               (error occurred)
 *
 * Other Events:
 *   - swap:status             (swap operation status)
 *   - deployment:status       (deployment progress)
 *
 * FEATURES:
 * ──────────────────────────────────────────────────────────────
 *
 * ✓ Real-time push notifications
 * ✓ User-specific event routing
 * ✓ Transaction tracking with status updates
 * ✓ Bot alert system with severity levels
 * ✓ Swap operation monitoring
 * ✓ Deployment progress tracking
 * ✓ Automatic client reconnection
 * ✓ Multiple transport methods (WebSocket + HTTP polling)
 * ✓ Full TypeScript support
 * ✓ Type-safe event payloads
 * ✓ Production-ready configuration
 *
 * DOCUMENTATION FILES:
 * ──────────────────────────────────────────────────────────────
 *
 * - SOCKET_IO_SETUP.md        Quick start and reference guide
 * - IMPLEMENTATION_SUMMARY.md Complete feature summary
 * - REALTIME_EXAMPLES.ts      Practical usage examples
 * - ARCHITECTURE_REFERENCE.ts Architecture and design
 * - socketManagerTest.ts      Test/demo functions
 *
 * FILES STRUCTURE:
 * ──────────────────────────────────────────────────────────────
 *
 * socketManager.ts
 *   ├─ SocketManager               Main Socket.io manager class
 *   ├─ RealtimeEventEmitter        Event bus for updates
 *   ├─ initializeSocketManager()   Initialize on server startup
 *   └─ getSocketManager()          Get singleton instance
 *
 * eventBridges.ts
 *   ├─ TransactionEventBridge      Transaction event emission
 *   ├─ BotEventBridge              Bot event emission
 *   └─ DeploymentEventBridge       Deployment event emission
 *
 * realtimeIntegration.ts
 *   ├─ TransactionUpdateHelper     Easy transaction APIs
 *   ├─ SwapUpdateHelper            Easy swap APIs
 *   ├─ BotUpdateHelper             Easy bot APIs
 *   ├─ DeploymentUpdateHelper      Easy deployment APIs
 *   └─ SafeUpdateEmitter           Safe async wrappers
 *
 * realtimeClient.ts
 *   ├─ RealtimeClient              Client connection manager
 *   └─ createRealtimeClient()      Factory function
 *
 * INTEGRATION CHECKLIST:
 * ──────────────────────────────────────────────────────────────
 *
 * [✓] Socket.io initialized on server startup
 * [✓] Server exports all necessary functions
 * [✓] REST endpoints for statistics available
 * [✓] Client library ready for use
 * [✓] Helper APIs for easy integration
 * [✓] TypeScript support with full type safety
 * [ ] Integrate in transaction service
 * [ ] Integrate in bot service
 * [ ] Integrate in swap service
 * [ ] Integrate in deployment service
 * [ ] Add client-side event listeners
 * [ ] Test with real use cases
 * [ ] Monitor via /api/realtime/stats
 *
 * SUPPORT & TROUBLESHOOTING:
 * ──────────────────────────────────────────────────────────────
 *
 * For detailed setup instructions:
 *   → See SOCKET_IO_SETUP.md
 *
 * For practical examples:
 *   → See REALTIME_EXAMPLES.ts
 *
 * For architecture details:
 *   → See ARCHITECTURE_REFERENCE.ts
 *
 * For implementation overview:
 *   → See IMPLEMENTATION_SUMMARY.md
 *
 * To run tests:
 *   npx ts-node src/Gateway/socketManagerTest.ts
 */

export const RealtimeUpdatesVersion = "1.0.0";
export const RealtimeUpdatesRelease = "2024-02-24";
