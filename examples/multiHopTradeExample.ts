/**
 * Multi-Hop Trade Path Evaluation Examples
 *
 * This file demonstrates various ways to use the multi-hop trade path
 * evaluation feature in the Stellar DEX SDK.
 */

import { multiHopPathFinder } from "../src/services/multiHopPathFinder";
import stellarPriceService from "../src/services/stellarPrice.service";
import { toolRegistry } from "../src/Agents/registry/ToolRegistry";
import * as StellarSdk from "@stellar/stellar-sdk";

// ============================================
// Example 1: Basic Path Finding
// ============================================

async function basicPathFinding() {
  console.log("=== Example 1: Basic Path Finding ===\n");

  const sourceAsset = StellarSdk.Asset.native(); // XLM
  const destAsset = new StellarSdk.Asset(
    "USDC",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  );

  try {
    const result = await multiHopPathFinder.findOptimalPath(
      sourceAsset,
      destAsset,
      "100.0000000"
    );

    console.log("Best Path Found:");
    console.log("  Route:", result.bestPath.route.join(" → "));
    console.log("  Hops:", result.bestPath.hops);
    console.log("  Input:", result.bestPath.sourceAmount, "XLM");
    console.log("  Output:", result.bestPath.destinationAmount, "USDC");
    console.log("  Price Impact:", result.bestPath.priceImpact.toFixed(2), "%");
    console.log("  Efficiency:", result.bestPath.efficiency.toFixed(4));
    console.log("  Evaluation Time:", result.evaluationTime, "ms");
    console.log("  Total Paths Found:", result.allPaths.length);
    console.log();
  } catch (error) {
    console.error("Error:", error);
  }
}

// ============================================
// Example 2: Comparing Multiple Paths
// ============================================

async function compareMultiplePaths() {
  console.log("=== Example 2: Comparing Multiple Paths ===\n");

  const sourceAsset = StellarSdk.Asset.native();
  const destAsset = new StellarSdk.Asset(
    "USDT",
    "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V"
  );

  try {
    const result = await multiHopPathFinder.findOptimalPath(
      sourceAsset,
      destAsset,
      "1000.0000000",
      { maxHops: 4 }
    );

    console.log("All Available Paths:\n");
    result.allPaths.forEach((path, index) => {
      console.log(`Path ${index + 1}:`);
      console.log("  Route:", path.route.join(" → "));
      console.log("  Hops:", path.hops);
      console.log("  Output:", path.destinationAmount);
      console.log("  Efficiency:", path.efficiency.toFixed(4));
      console.log("  Price Impact:", path.priceImpact.toFixed(2), "%");
      console.log(
        "  Slippage:",
        (path.estimatedSlippage * 100).toFixed(3),
        "%"
      );
      console.log();
    });

    console.log("Selected Best Path:", result.bestPath.route.join(" → "));
    console.log();
  } catch (error) {
    console.error("Error:", error);
  }
}

// ============================================
// Example 3: Using with Price Service
// ============================================

async function priceServiceIntegration() {
  console.log("=== Example 3: Price Service Integration ===\n");

  try {
    // Standard price quote
    const standardQuote = await stellarPriceService.getPrice(
      "XLM",
      "USDC",
      100
    );
    console.log("Standard Quote:");
    console.log("  Price:", standardQuote.price);
    console.log("  Output:", standardQuote.estimatedOutput);
    console.log("  Path:", standardQuote.path?.join(" → ") || "N/A");
    console.log("  Cached:", standardQuote.cached);
    console.log();

    // Multi-hop quote
    const multiHopQuote = await stellarPriceService.getPriceWithMultiHop(
      "XLM",
      "USDC",
      100,
      5
    );
    console.log("Multi-Hop Quote:");
    console.log("  Price:", multiHopQuote.price);
    console.log("  Output:", multiHopQuote.estimatedOutput);
    console.log("  Path:", multiHopQuote.path?.join(" → ") || "N/A");
    console.log("  Analysis:");
    console.log(
      "    Total Paths:",
      multiHopQuote.multiHopAnalysis?.totalPathsFound
    );
    console.log(
      "    Best Path Hops:",
      multiHopQuote.multiHopAnalysis?.bestPathHops
    );
    console.log(
      "    Efficiency:",
      multiHopQuote.multiHopAnalysis?.efficiency.toFixed(4)
    );
    console.log();
  } catch (error) {
    console.error("Error:", error);
  }
}

// ============================================
// Example 4: Using the Agent Tool
// ============================================

async function agentToolUsage() {
  console.log("=== Example 4: Agent Tool Usage ===\n");

  try {
    const result = await toolRegistry.executeTool(
      "multi_hop_trade",
      {
        fromAsset: "XLM",
        toAsset: "USDC",
        amount: 500,
        maxHops: 3,
      },
      "example-user-id"
    );

    if (result.success) {
      console.log("Tool Execution Successful!\n");
      console.log("Best Path:");
      console.log("  Route:", result.data.bestPath.route.join(" → "));
      console.log("  Hops:", result.data.bestPath.hops);
      console.log("  Output:", result.data.bestPath.destinationAmount);
      console.log("  Price Impact:", result.data.bestPath.priceImpact);
      console.log("  Slippage:", result.data.bestPath.estimatedSlippage);
      console.log("  Efficiency:", result.data.bestPath.efficiency);
      console.log();

      console.log("Alternative Paths:");
      result.data.alternativePaths.forEach((path: any, index: number) => {
        console.log(
          `  ${index + 1}. ${path.route.join(" → ")} (${path.hops} hops)`
        );
      });
      console.log();

      console.log("Recommendation:", result.data.recommendation);
      console.log();
    } else {
      console.error("Tool execution failed:", result.error);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

// ============================================
// Example 5: Path Comparison
// ============================================

async function pathComparison() {
  console.log("=== Example 5: Path Comparison ===\n");

  const path1 = {
    path: [],
    sourceAmount: "100",
    destinationAmount: "12.5",
    priceImpact: 0.6,
    estimatedSlippage: 0.0015,
    hops: 2,
    route: ["XLM", "USDC", "USDT"],
    efficiency: 12.35,
  };

  const path2 = {
    path: [],
    sourceAmount: "100",
    destinationAmount: "12.3",
    priceImpact: 0.9,
    estimatedSlippage: 0.0023,
    hops: 3,
    route: ["XLM", "USDC", "BTC", "USDT"],
    efficiency: 12.05,
  };

  const betterPath = multiHopPathFinder.comparePaths(path1, path2);

  console.log("Path 1:", path1.route.join(" → "));
  console.log("  Efficiency:", path1.efficiency);
  console.log("  Hops:", path1.hops);
  console.log();

  console.log("Path 2:", path2.route.join(" → "));
  console.log("  Efficiency:", path2.efficiency);
  console.log("  Hops:", path2.hops);
  console.log();

  console.log("Better Path:", betterPath.route.join(" → "));
  console.log("  Reason: Higher efficiency score");
  console.log();
}

// ============================================
// Example 6: Error Handling
// ============================================

async function errorHandling() {
  console.log("=== Example 6: Error Handling ===\n");

  // Invalid asset
  try {
    await toolRegistry.executeTool(
      "multi_hop_trade",
      {
        fromAsset: "INVALID",
        toAsset: "USDC",
        amount: 100,
      },
      "user-id"
    );
  } catch (error) {
    console.log("Caught expected error for invalid asset");
  }

  // Same source and destination
  try {
    const result = await toolRegistry.executeTool(
      "multi_hop_trade",
      {
        fromAsset: "XLM",
        toAsset: "XLM",
        amount: 100,
      },
      "user-id"
    );

    if (!result.success) {
      console.log("Error:", result.error);
    }
  } catch (error) {
    console.log("Caught error:", error);
  }

  console.log();
}

// ============================================
// Run All Examples
// ============================================

async function runAllExamples() {
  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║  Multi-Hop Trade Path Evaluation Examples     ║");
  console.log("╚════════════════════════════════════════════════╝\n");

  try {
    await basicPathFinding();
    await compareMultiplePaths();
    await priceServiceIntegration();
    await agentToolUsage();
    await pathComparison();
    await errorHandling();

    console.log("✓ All examples completed successfully!");
  } catch (error) {
    console.error("Example execution failed:", error);
  }
}

// Run if executed directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}

export {
  basicPathFinding,
  compareMultiplePaths,
  priceServiceIntegration,
  agentToolUsage,
  pathComparison,
  errorHandling,
};
