"use strict";
/**
 * Example usage of the Network Status API
 *
 * This demonstrates how to check Stellar network health, latency, and protocol version.
 */
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/no-unused-vars */
const sdk_core_1 = require("@chen-pilot/sdk-core");
// ─── Example 1: Check network health ────────────────────────────────────────
function exampleCheckHealth() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Checking Network Health ===\n");
    const health = yield (0, sdk_core_1.checkNetworkHealth)({
      network: "testnet",
    });
    if (health.isHealthy) {
      console.log("✓ Network is healthy");
      console.log(`  Latest ledger: ${health.latestLedger}`);
      console.log(`  Response time: ${health.responseTimeMs}ms`);
    } else {
      console.log("✗ Network is unhealthy");
      console.log(`  Error: ${health.error}`);
    }
  });
}
// ─── Example 2: Check ledger latency ────────────────────────────────────────
function exampleCheckLatency() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Checking Ledger Latency ===\n");
    const latency = yield (0, sdk_core_1.checkLedgerLatency)({
      network: "testnet",
    });
    console.log(`Current ledger: ${latency.currentLedger}`);
    console.log(
      `Time since last ledger: ${latency.timeSinceLastLedgerSec} seconds`
    );
    console.log(`Average ledger time: ${latency.averageLedgerTimeSec} seconds`);
    console.log(`Latency is ${latency.isNormal ? "normal" : "abnormal"}`);
  });
}
// ─── Example 3: Get protocol version ────────────────────────────────────────
function exampleGetProtocol() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Getting Protocol Version ===\n");
    const protocol = yield (0, sdk_core_1.getProtocolVersion)({
      network: "mainnet",
    });
    console.log(`Protocol version: ${protocol.version}`);
    console.log(`Core version: ${protocol.coreVersion}`);
    console.log(`Network passphrase: ${protocol.networkPassphrase}`);
  });
}
// ─── Example 4: Get complete network status ─────────────────────────────────
function exampleGetCompleteStatus() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Getting Complete Network Status ===\n");
    const status = yield (0, sdk_core_1.getNetworkStatus)({
      network: "testnet",
    });
    console.log("Health:");
    console.log(`  Healthy: ${status.health.isHealthy}`);
    console.log(`  Latest ledger: ${status.health.latestLedger}`);
    console.log(`  Response time: ${status.health.responseTimeMs}ms`);
    console.log("\nLatency:");
    console.log(`  Current ledger: ${status.latency.currentLedger}`);
    console.log(
      `  Time since last ledger: ${status.latency.timeSinceLastLedgerSec}s`
    );
    console.log(`  Normal: ${status.latency.isNormal}`);
    console.log("\nProtocol:");
    console.log(`  Version: ${status.protocol.version}`);
    console.log(`  Core: ${status.protocol.coreVersion}`);
    console.log(`\nChecked at: ${new Date(status.checkedAt).toISOString()}`);
  });
}
// ─── Example 5: Using custom RPC/Horizon URLs ───────────────────────────────
function exampleCustomUrls() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Using Custom URLs ===\n");
    const status = yield (0, sdk_core_1.getNetworkStatus)({
      network: "testnet",
      rpcUrl: "https://custom-rpc.example.com",
      horizonUrl: "https://custom-horizon.example.com",
    });
    console.log(`Network status retrieved from custom endpoints`);
    console.log(`Healthy: ${status.health.isHealthy}`);
  });
}
// ─── Example 6: Error handling ──────────────────────────────────────────────
function exampleErrorHandling() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Error Handling ===\n");
    try {
      const health = yield (0, sdk_core_1.checkNetworkHealth)({
        network: "testnet",
      });
      if (!health.isHealthy) {
        console.log(`Network check failed: ${health.error}`);
        // Handle unhealthy network (retry, alert, etc.)
      }
    } catch (error) {
      console.error("Unexpected error:", error);
    }
    try {
      const latency = yield (0, sdk_core_1.checkLedgerLatency)({
        network: "testnet",
      });
      if (!latency.isNormal) {
        console.log("Warning: Network latency is abnormal");
        console.log(
          `Last ledger was ${latency.timeSinceLastLedgerSec} seconds ago`
        );
        // Handle high latency (wait, retry, etc.)
      }
    } catch (error) {
      console.error("Failed to check latency:", error);
    }
  });
}
// ─── Example 7: Monitoring loop ─────────────────────────────────────────────
function exampleMonitoring() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("\n=== Network Monitoring ===\n");
    // Check network status every 30 seconds
    const intervalMs = 30000;
    const monitor = setInterval(
      () =>
        __awaiter(this, void 0, void 0, function* () {
          try {
            const status = yield (0, sdk_core_1.getNetworkStatus)({
              network: "mainnet",
            });
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] Network Status:`);
            console.log(`  Healthy: ${status.health.isHealthy}`);
            console.log(`  Ledger: ${status.health.latestLedger}`);
            console.log(`  Latency normal: ${status.latency.isNormal}`);
            // Alert if unhealthy
            if (!status.health.isHealthy || !status.latency.isNormal) {
              console.warn("⚠️  Network issue detected!");
            }
          } catch (error) {
            console.error("Monitoring error:", error);
          }
        }),
      intervalMs
    );
    // Stop monitoring after 5 minutes
    setTimeout(() => {
      clearInterval(monitor);
      console.log("\nMonitoring stopped");
    }, 300000);
  });
}
// ─── Run examples ───────────────────────────────────────────────────────────
function main() {
  return __awaiter(this, void 0, void 0, function* () {
    try {
      yield exampleCheckHealth();
      yield exampleCheckLatency();
      yield exampleGetProtocol();
      yield exampleGetCompleteStatus();
      yield exampleCustomUrls(); // Uncomment if you have custom endpoints
      yield exampleErrorHandling();
      yield exampleMonitoring(); // Uncomment to run monitoring loop
    } catch (error) {
      console.error("Example failed:", error);
    }
  });
}
// Uncomment to run examples
// main();
