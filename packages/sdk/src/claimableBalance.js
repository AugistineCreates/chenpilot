"use strict";
/**
 * Stellar Claimable Balance Utilities
 *
 * Provides functionality to search for and claim pending claimable balances
 * for a given Stellar account.
 */
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
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
exports.searchClaimableBalances = searchClaimableBalances;
exports.claimBalance = claimBalance;
exports.getTotalClaimableAmount = getTotalClaimableAmount;
/**
 * Search for claimable balances for a given account
 */
function searchClaimableBalances(options) {
  return __awaiter(this, void 0, void 0, function* () {
    const StellarSdk = yield Promise.resolve().then(() =>
      __importStar(require("stellar-sdk"))
    );
    const horizonUrl =
      options.horizonUrl ||
      (options.network === "mainnet"
        ? "https://horizon.stellar.org"
        : "https://horizon-testnet.stellar.org");
    const server = new StellarSdk.Horizon.Server(horizonUrl);
    try {
      const balancesCall = server
        .claimableBalances()
        .claimant(options.accountId)
        .limit(options.limit || 200);
      const response = yield balancesCall.call();
      return response.records.map((record) => {
        const rec = record;
        return {
          id: rec.id,
          asset:
            rec.asset === "native"
              ? "XLM"
              : `${String(rec.asset).split(":")[0]}`,
          amount: rec.amount,
          sponsor: rec.sponsor || "",
          createdAt: rec.last_modified_time,
          claimants: rec.claimants.map((c) => ({
            destination: c.destination,
            predicate: c.predicate,
          })),
        };
      });
    } catch (error) {
      throw new Error(
        `Failed to search claimable balances: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
/**
 * Claim a specific claimable balance
 */
function claimBalance(options) {
  return __awaiter(this, void 0, void 0, function* () {
    const StellarSdk = yield Promise.resolve().then(() =>
      __importStar(require("stellar-sdk"))
    );
    const horizonUrl =
      options.horizonUrl ||
      (options.network === "mainnet"
        ? "https://horizon.stellar.org"
        : "https://horizon-testnet.stellar.org");
    const networkPassphrase =
      options.network === "mainnet"
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET;
    const server = new StellarSdk.Horizon.Server(horizonUrl);
    try {
      // Load the claimant keypair
      const claimantKeypair = StellarSdk.Keypair.fromSecret(
        options.claimantSecret
      );
      const claimantPublicKey = claimantKeypair.publicKey();
      // Fetch balance details first
      const balanceRecord = yield server
        .claimableBalances()
        .claimableBalance(options.balanceId)
        .call();
      const balance = {
        id: balanceRecord.id,
        asset:
          balanceRecord.asset === "native"
            ? "XLM"
            : `${balanceRecord.asset.split(":")[0]}`,
        amount: balanceRecord.amount,
        sponsor: balanceRecord.sponsor || "",
        createdAt: balanceRecord.last_modified_time,
        claimants: balanceRecord.claimants.map((c) => {
          const claimant = c;
          return {
            destination: claimant.destination,
            predicate: claimant.predicate,
          };
        }),
      };
      // Verify the account is a valid claimant
      const isClaimant = balance.claimants.some(
        (c) => c.destination === claimantPublicKey
      );
      if (!isClaimant) {
        return {
          success: false,
          error: `Account ${claimantPublicKey} is not a valid claimant for this balance`,
          balance,
        };
      }
      // Load the claimant account
      const account = yield server.loadAccount(claimantPublicKey);
      // Build the claim transaction
      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.claimClaimableBalance({
            balanceId: options.balanceId,
          })
        )
        .setTimeout(180)
        .build();
      // Sign the transaction
      transaction.sign(claimantKeypair);
      // Submit the transaction
      const result = yield server.submitTransaction(transaction);
      return {
        success: true,
        transactionHash: result.hash,
        balance,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
/**
 * Get total claimable amount for an account grouped by asset
 */
function getTotalClaimableAmount(options) {
  return __awaiter(this, void 0, void 0, function* () {
    const balances = yield searchClaimableBalances(options);
    const totals = {};
    for (const balance of balances) {
      const amount = parseFloat(balance.amount);
      totals[balance.asset] = (totals[balance.asset] || 0) + amount;
    }
    // Convert back to strings with proper precision
    const result = {};
    for (const [asset, amount] of Object.entries(totals)) {
      result[asset] = amount.toFixed(7);
    }
    return result;
  });
}
