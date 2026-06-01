"use strict";
/**
 * Stellar Sequence Helper
 *
 * Integration layer between SequenceManager and Stellar SDK
 * Provides convenient methods for building transactions with managed sequences
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
exports.StellarSequenceHelper = void 0;
exports.createStellarSequenceHelper = createStellarSequenceHelper;
const sequenceManager_1 = require("./sequenceManager");
/**
 * Helper class for managing Stellar account sequences
 */
class StellarSequenceHelper {
  constructor(sequenceManager, horizonServer) {
    this.sequenceManager = sequenceManager;
    this.horizonServer = horizonServer;
  }
  /**
   * Get next sequence for an account with automatic network fetching
   */
  getNextSequence(accountId) {
    return __awaiter(this, void 0, void 0, function* () {
      return this.sequenceManager.getNextSequence(accountId, () =>
        __awaiter(this, void 0, void 0, function* () {
          const account = yield this.horizonServer.loadAccount(accountId);
          return account.sequenceNumber();
        })
      );
    });
  }
  /**
   * Create a managed account object with predicted sequence
   * This can be used directly with TransactionBuilder
   */
  createManagedAccount(accountId, AccountClass) {
    return __awaiter(this, void 0, void 0, function* () {
      const sequenceInfo = yield this.getNextSequence(accountId);
      // Reserve the sequence number
      yield this.sequenceManager.reserveSequence(accountId, sequenceInfo.next, {
        timestamp: Date.now(),
      });
      // Create account with the next sequence
      const account = new AccountClass(accountId, sequenceInfo.next);
      return { account, sequenceInfo };
    });
  }
  /**
   * Build a transaction with managed sequence
   * Returns a wrapper that tracks the transaction
   */
  buildManagedTransaction(accountId, AccountClass, buildFn) {
    return __awaiter(this, void 0, void 0, function* () {
      const { account, sequenceInfo } = yield this.createManagedAccount(
        accountId,
        AccountClass
      );
      const transaction = buildFn(account);
      const sequence = sequenceInfo.next;
      return {
        transaction,
        sequence,
        sequenceInfo,
        markSubmitted: (hash) =>
          __awaiter(this, void 0, void 0, function* () {
            yield this.sequenceManager.markSubmitted(accountId, sequence, hash);
          }),
        markConfirmed: () =>
          __awaiter(this, void 0, void 0, function* () {
            yield this.sequenceManager.markConfirmed(accountId, sequence);
          }),
        markFailed: () =>
          __awaiter(this, void 0, void 0, function* () {
            yield this.sequenceManager.markFailed(accountId, sequence);
          }),
      };
    });
  }
  /**
   * Submit a transaction with automatic sequence tracking
   */
  submitManagedTransaction(accountId, AccountClass, buildFn, submitFn) {
    return __awaiter(this, void 0, void 0, function* () {
      const managed = yield this.buildManagedTransaction(
        accountId,
        AccountClass,
        buildFn
      );
      try {
        const result = yield submitFn(managed.transaction);
        // Extract hash if available
        const hash =
          typeof result === "object" && result !== null && "hash" in result
            ? String(result.hash)
            : undefined;
        if (hash) {
          yield managed.markSubmitted(hash);
        }
        yield managed.markConfirmed();
        return result;
      } catch (error) {
        yield managed.markFailed();
        throw error;
      }
    });
  }
  /**
   * Get pending transactions for an account
   */
  getPendingTransactions(accountId) {
    return this.sequenceManager.getPendingTransactions(accountId);
  }
  /**
   * Get sequence info for an account
   */
  getSequenceInfo(accountId) {
    return this.sequenceManager.getSequenceInfo(accountId);
  }
  /**
   * Refresh sequence from network
   */
  refreshSequence(accountId) {
    return __awaiter(this, void 0, void 0, function* () {
      return this.sequenceManager.refreshSequence(accountId, () =>
        __awaiter(this, void 0, void 0, function* () {
          const account = yield this.horizonServer.loadAccount(accountId);
          return account.sequenceNumber();
        })
      );
    });
  }
  /**
   * Clear cached data for an account
   */
  clearAccount(accountId) {
    this.sequenceManager.clearAccount(accountId);
  }
  /**
   * Get statistics
   */
  getStats() {
    return this.sequenceManager.getStats();
  }
}
exports.StellarSequenceHelper = StellarSequenceHelper;
/**
 * Create a helper instance with a sequence manager
 */
function createStellarSequenceHelper(horizonServer, sequenceManager) {
  const manager = sequenceManager || new sequenceManager_1.SequenceManager();
  return new StellarSequenceHelper(manager, horizonServer);
}
