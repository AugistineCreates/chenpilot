"use strict";
/**
 * Example: Using Stellar Claimable Balance Utilities
 *
 * This example demonstrates how to search for and claim claimable balances
 * on the Stellar network using the SDK.
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
exports.main = main;
const claimableBalance_1 = require("../src/claimableBalance");
function main() {
  return __awaiter(this, void 0, void 0, function* () {
    var _a, _b;
    // Replace with your actual Stellar account public key
    const accountId = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    const secretKey = "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    console.log("=== Stellar Claimable Balance Example ===\n");
    // 1. Search for claimable balances
    console.log("1. Searching for claimable balances...");
    try {
      const balances = yield (0, claimableBalance_1.searchClaimableBalances)({
        accountId,
        network: "testnet",
        limit: 50,
      });
      console.log(`Found ${balances.length} claimable balance(s)\n`);
      if (balances.length > 0) {
        balances.forEach((balance, index) => {
          console.log(`Balance #${index + 1}:`);
          console.log(`  ID: ${balance.id}`);
          console.log(`  Asset: ${balance.asset}`);
          console.log(`  Amount: ${balance.amount}`);
          console.log(`  Sponsor: ${balance.sponsor}`);
          console.log(`  Created: ${balance.createdAt || "N/A"}`);
          console.log(`  Claimants: ${balance.claimants.length}`);
          console.log();
        });
      }
    } catch (error) {
      console.error("Error searching balances:", error);
    }
    // 2. Get total claimable amounts by asset
    console.log("\n2. Getting total claimable amounts...");
    try {
      const totals = yield (0, claimableBalance_1.getTotalClaimableAmount)({
        accountId,
        network: "testnet",
      });
      console.log("Total claimable amounts by asset:");
      Object.entries(totals).forEach(([asset, amount]) => {
        console.log(`  ${asset}: ${amount}`);
      });
    } catch (error) {
      console.error("Error getting totals:", error);
    }
    // 3. Claim a specific balance (example)
    console.log("\n3. Claiming a balance (example)...");
    const exampleBalanceId = "00000000..."; // Replace with actual balance ID
    try {
      const result = yield (0, claimableBalance_1.claimBalance)({
        balanceId: exampleBalanceId,
        claimantSecret: secretKey,
        network: "testnet",
      });
      if (result.success) {
        console.log("✓ Successfully claimed balance!");
        console.log(`  Transaction Hash: ${result.transactionHash}`);
        console.log(
          `  Asset: ${(_a = result.balance) === null || _a === void 0 ? void 0 : _a.asset}`
        );
        console.log(
          `  Amount: ${(_b = result.balance) === null || _b === void 0 ? void 0 : _b.amount}`
        );
      } else {
        console.log("✗ Failed to claim balance");
        console.log(`  Error: ${result.error}`);
      }
    } catch (error) {
      console.error("Error claiming balance:", error);
    }
    // 4. Claim all balances (advanced example)
    console.log("\n4. Claiming all balances (advanced)...");
    try {
      const balances = yield (0, claimableBalance_1.searchClaimableBalances)({
        accountId,
        network: "testnet",
      });
      if (balances.length === 0) {
        console.log("No balances to claim");
        return;
      }
      console.log(`Attempting to claim ${balances.length} balance(s)...`);
      for (const balance of balances) {
        console.log(`\nClaiming ${balance.amount} ${balance.asset}...`);
        const result = yield (0, claimableBalance_1.claimBalance)({
          balanceId: balance.id,
          claimantSecret: secretKey,
          network: "testnet",
        });
        if (result.success) {
          console.log(`  ✓ Claimed! TX: ${result.transactionHash}`);
        } else {
          console.log(`  ✗ Failed: ${result.error}`);
        }
        // Add delay to avoid rate limiting
        yield new Promise((resolve) => setTimeout(resolve, 1000));
      }
      console.log("\nAll claims processed!");
    } catch (error) {
      console.error("Error in batch claiming:", error);
    }
  });
}
// Run the example
if (require.main === module) {
  main().catch(console.error);
}
