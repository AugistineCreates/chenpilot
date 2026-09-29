/**
 * Production Integration Guide — Issue #381
 *
 * Demonstrates real-world usage of the chenpilot SDK for production integrations.
 * Covers:
 *   1. Capability discovery and version negotiation
 *   2. Planning and simulating a cross-chain swap
 *   3. Execution with retry and progress tracking
 *   4. Contract interaction (Soroban)
 *   5. Realtime event subscription
 *
 * Run:
 *   npx ts-node packages/sdk/examples/production-integration-guide.ts
 */

// ─── 1. Capability discovery ─────────────────────────────────────────────────

import { createCapabilityDiscovery } from "../src/capabilityDiscovery";

async function demonstrateCapabilityDiscovery() {
  console.log("
=== 1. Capability Discovery ===");

  const discovery = createCapabilityDiscovery("testnet");
  const caps = await discovery.getCapabilities();

  console.log("Network:", caps.network);
  console.log("Protocol version:", caps.versions.protocol);
  console.log("API version:", caps.versions.api);
  console.log("Soroban enabled:", caps.features.sorobanEnabled);
  console.log("Multi-hop enabled:", caps.features.multiHopEnabled);

  // Negotiate before using Soroban features
  const negotiation = await discovery.negotiate({
    minProtocol: 21,
    requiredFeatures: ["sorobanEnabled", "feeBumpingEnabled"],
  });

  if (!negotiation.compatible) {
    console.error("Backend incompatible:", negotiation.reason);
    return;
  }

  console.log("Backend is compatible — proceeding.");
}

// ─── 2. Planning and simulation ───────────────────────────────────────────────

import type { CrossChainSwapRequest } from "../src/types";
import { checkNetworkHealth } from "../src/networkStatus";

async function demonstrateSimulation() {
  console.log("
=== 2. Simulation ===");

  // Always check network health before submitting transactions
  const health = await checkNetworkHealth({ network: "testnet" });
  if (!health.isHealthy) {
    console.error("Network unhealthy:", health.error);
    return;
  }
  console.log("Network healthy. Latest ledger:", health.latestLedger);

  const swapPlan: CrossChainSwapRequest = {
    fromChain: "stellar" as any,
    toChain: "starknet" as any,
    fromToken: "XLM",
    toToken: "ETH",
    amount: "100",
    destinationAddress: "0xYourStarkNetAddress",
  };

  // Simulate before executing — catches validation errors cheaply
  console.log("Simulating swap:", swapPlan);
  // In production: const simulation = await swapSimulator.simulate(swapPlan);
  console.log("Simulation complete — no issues detected.");
}

// ─── 3. Execution with retry and progress tracking ────────────────────────────

async function demonstrateExecutionTracking() {
  console.log("
=== 3. Execution Tracking ===");

  // Conceptual execution tracker — swap IDs come from your swap service
  const swapId = ;
  console.log("Swap ID:", swapId);

  // Polling-based progress tracking
  const maxPolls = 10;
  const pollIntervalMs = 3_000;

  for (let attempt = 0; attempt < maxPolls; attempt++) {
    // In production: const status = await swapService.getStatus(swapId);
    const mockStatus = attempt < 3 ? "pending" : attempt < 6 ? "bridging" : "complete";

    console.log(`Poll ${attempt + 1}/${maxPolls}: status = ${mockStatus}`);

    if (mockStatus === "complete") {
      console.log("Swap completed successfully.");
      break;
    }
    if (mockStatus === "failed") {
      console.error("Swap failed — initiating recovery.");
      break;
    }

    if (attempt < maxPolls - 1) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }
}

// ─── 4. Soroban contract interaction ─────────────────────────────────────────

import { buildSorobanTransaction, simulateSorobanTx } from "../src/soroban";

async function demonstrateSorobanInteraction() {
  console.log("
=== 4. Soroban Contract Interaction ===");

  const TESTNET_RPC = "https://soroban-testnet.stellar.org";

  // Always simulate before submitting to avoid wasting fees on failures
  console.log("Simulating Soroban contract call...");
  try {
    const tx = await buildSorobanTransaction({
      rpcUrl: TESTNET_RPC,
      contractId: "CDEMO_CONTRACT_ID",
      method: "get_counter",
      args: [],
      sourceAccount: "GABC...",
    });
    const simulation = await simulateSorobanTx({ rpcUrl: TESTNET_RPC, transaction: tx });
    console.log("Simulation succeeded. Estimated fee:", simulation.minResourceFee);
    // In production: sign tx, then submit with retry on sequence number errors
  } catch (err) {
    console.warn("Soroban simulation skipped in demo context:", (err as Error).message);
  }
}

// ─── 5. Realtime event subscription ─────────────────────────────────────────

import { subscribeToEvents } from "../src/events";

async function demonstrateRealtimeEvents() {
  console.log("
=== 5. Realtime Event Subscription ===");

  let receivedCount = 0;
  const subscription = subscribeToEvents({
    network: "testnet",
    contractId: "CDEMO_CONTRACT_ID",
    onEvent: (event) => {
      receivedCount++;
      console.log(`Event received [#${receivedCount}]:`, event);
    },
    onError: (err) => {
      console.error("Event subscription error:", err);
      // In production: implement reconnect with exponential back-off
    },
  });

  // Unsubscribe after 5 seconds in this demo
  await new Promise((r) => setTimeout(r, 5_000));
  subscription.close();
  console.log(`Subscription closed after receiving ${receivedCount} events.`);
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

(async () => {
  try {
    await demonstrateCapabilityDiscovery();
    await demonstrateSimulation();
    await demonstrateExecutionTracking();
    await demonstrateSorobanInteraction();
    await demonstrateRealtimeEvents();
    console.log("
=== Production integration guide complete ===");
  } catch (err) {
    console.error("Guide error:", err);
    process.exit(1);
  }
})();
