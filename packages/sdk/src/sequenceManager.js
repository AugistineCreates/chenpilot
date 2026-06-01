"use strict";
/**
 * Sequence Manager for Stellar Account Transactions
 *
 * Handles sequence number tracking and prediction for highly concurrent
 * transaction submission scenarios. Prevents sequence number collisions
 * and transaction failures due to incorrect sequence numbers.
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
exports.globalSequenceManager = exports.SequenceManager = void 0;
/**
 * Manages sequence numbers for Stellar accounts in concurrent scenarios
 */
class SequenceManager {
  constructor(config = {}) {
    var _a, _b, _c, _d;
    this.sequences = new Map();
    this.pending = new Map();
    this.locks = new Map();
    this.refreshTimers = new Map();
    this.config = {
      cacheTTL: (_a = config.cacheTTL) !== null && _a !== void 0 ? _a : 30000,
      maxPendingTransactions:
        (_b = config.maxPendingTransactions) !== null && _b !== void 0
          ? _b
          : 100,
      autoRefresh:
        (_c = config.autoRefresh) !== null && _c !== void 0 ? _c : true,
      refreshInterval:
        (_d = config.refreshInterval) !== null && _d !== void 0 ? _d : 10000,
    };
  }
  /**
   * Get the next available sequence number for an account
   * Handles concurrent requests by queuing them
   */
  getNextSequence(accountId, fetchSequence) {
    return __awaiter(this, void 0, void 0, function* () {
      // Wait for any pending operations on this account
      yield this.waitForLock(accountId);
      // Create a lock for this operation
      const lockPromise = this.acquireLock(accountId);
      try {
        yield lockPromise;
        const cached = this.sequences.get(accountId);
        const now = Date.now();
        // Check if cached sequence is still valid
        if (cached && now - cached.lastFetched < this.config.cacheTTL) {
          // Increment the next sequence number
          const nextSeq = this.incrementSequence(cached.next);
          const updated = {
            current: cached.current,
            next: nextSeq,
            pendingCount: cached.pendingCount + 1,
            lastFetched: cached.lastFetched,
            cached: true,
          };
          this.sequences.set(accountId, updated);
          return Object.assign({}, updated);
        }
        // Fetch fresh sequence from network
        const currentSeq = yield fetchSequence();
        const nextSeq = this.incrementSequence(currentSeq);
        const info = {
          current: currentSeq,
          next: nextSeq,
          pendingCount: 1,
          lastFetched: now,
          cached: false,
        };
        this.sequences.set(accountId, info);
        // Start auto-refresh if enabled
        if (this.config.autoRefresh) {
          this.startAutoRefresh(accountId, fetchSequence);
        }
        return Object.assign({}, info);
      } finally {
        this.releaseLock(accountId);
      }
    });
  }
  /**
   * Reserve a specific sequence number for a transaction
   * Returns the reserved sequence or null if already taken
   */
  reserveSequence(accountId, sequence, metadata) {
    return __awaiter(this, void 0, void 0, function* () {
      yield this.waitForLock(accountId);
      const lockPromise = this.acquireLock(accountId);
      try {
        yield lockPromise;
        const accountPending = this.pending.get(accountId) || new Map();
        // Check if sequence is already reserved
        if (accountPending.has(sequence)) {
          return null;
        }
        // Check max pending limit
        if (accountPending.size >= this.config.maxPendingTransactions) {
          throw new Error(
            `Maximum pending transactions (${this.config.maxPendingTransactions}) reached for account ${accountId}`
          );
        }
        const transaction = {
          sequence,
          createdAt: Date.now(),
          status: "pending",
          metadata,
        };
        accountPending.set(sequence, transaction);
        this.pending.set(accountId, accountPending);
        return Object.assign({}, transaction);
      } finally {
        this.releaseLock(accountId);
      }
    });
  }
  /**
   * Mark a transaction as submitted
   */
  markSubmitted(accountId, sequence, hash) {
    return __awaiter(this, void 0, void 0, function* () {
      yield this.waitForLock(accountId);
      const lockPromise = this.acquireLock(accountId);
      try {
        yield lockPromise;
        const accountPending = this.pending.get(accountId);
        const transaction =
          accountPending === null || accountPending === void 0
            ? void 0
            : accountPending.get(sequence);
        if (transaction) {
          transaction.status = "submitted";
          transaction.hash = hash;
        }
      } finally {
        this.releaseLock(accountId);
      }
    });
  }
  /**
   * Mark a transaction as confirmed and remove from pending
   */
  markConfirmed(accountId, sequence) {
    return __awaiter(this, void 0, void 0, function* () {
      yield this.waitForLock(accountId);
      const lockPromise = this.acquireLock(accountId);
      try {
        yield lockPromise;
        const accountPending = this.pending.get(accountId);
        if (accountPending) {
          accountPending.delete(sequence);
          // Update pending count in sequence info
          const info = this.sequences.get(accountId);
          if (info) {
            info.pendingCount = Math.max(0, info.pendingCount - 1);
          }
        }
      } finally {
        this.releaseLock(accountId);
      }
    });
  }
  /**
   * Mark a transaction as failed and remove from pending
   */
  markFailed(accountId, sequence) {
    return __awaiter(this, void 0, void 0, function* () {
      yield this.waitForLock(accountId);
      const lockPromise = this.acquireLock(accountId);
      try {
        yield lockPromise;
        const accountPending = this.pending.get(accountId);
        const transaction =
          accountPending === null || accountPending === void 0
            ? void 0
            : accountPending.get(sequence);
        if (transaction) {
          transaction.status = "failed";
          accountPending.delete(sequence);
          // Update pending count
          const info = this.sequences.get(accountId);
          if (info) {
            info.pendingCount = Math.max(0, info.pendingCount - 1);
          }
        }
      } finally {
        this.releaseLock(accountId);
      }
    });
  }
  /**
   * Get all pending transactions for an account
   */
  getPendingTransactions(accountId) {
    const accountPending = this.pending.get(accountId);
    if (!accountPending) {
      return [];
    }
    return Array.from(accountPending.values()).map((tx) =>
      Object.assign({}, tx)
    );
  }
  /**
   * Get current sequence info for an account (from cache)
   */
  getSequenceInfo(accountId) {
    const info = this.sequences.get(accountId);
    return info ? Object.assign({}, info) : null;
  }
  /**
   * Force refresh sequence number from network
   */
  refreshSequence(accountId, fetchSequence) {
    return __awaiter(this, void 0, void 0, function* () {
      yield this.waitForLock(accountId);
      const lockPromise = this.acquireLock(accountId);
      try {
        yield lockPromise;
        const currentSeq = yield fetchSequence();
        const accountPending = this.pending.get(accountId);
        const pendingCount =
          (accountPending === null || accountPending === void 0
            ? void 0
            : accountPending.size) || 0;
        // Calculate next sequence considering pending transactions
        let nextSeq = currentSeq;
        for (let i = 0; i < pendingCount; i++) {
          nextSeq = this.incrementSequence(nextSeq);
        }
        const info = {
          current: currentSeq,
          next: this.incrementSequence(nextSeq),
          pendingCount,
          lastFetched: Date.now(),
          cached: false,
        };
        this.sequences.set(accountId, info);
        return Object.assign({}, info);
      } finally {
        this.releaseLock(accountId);
      }
    });
  }
  /**
   * Clear all cached data for an account
   */
  clearAccount(accountId) {
    this.sequences.delete(accountId);
    this.pending.delete(accountId);
    const timer = this.refreshTimers.get(accountId);
    if (timer) {
      clearInterval(timer);
      this.refreshTimers.delete(accountId);
    }
  }
  /**
   * Clear all cached data
   */
  clearAll() {
    this.sequences.clear();
    this.pending.clear();
    for (const timer of this.refreshTimers.values()) {
      clearInterval(timer);
    }
    this.refreshTimers.clear();
  }
  /**
   * Get statistics for monitoring
   */
  getStats() {
    const accountStats = Array.from(this.sequences.entries()).map(
      ([accountId, info]) => ({
        accountId,
        pendingCount: info.pendingCount,
        lastFetched: info.lastFetched,
        cacheAge: Date.now() - info.lastFetched,
      })
    );
    const totalPending = accountStats.reduce(
      (sum, stat) => sum + stat.pendingCount,
      0
    );
    return {
      accountsTracked: this.sequences.size,
      totalPending,
      accountStats,
    };
  }
  // Private helper methods
  incrementSequence(sequence) {
    const bigIntSeq = BigInt(sequence);
    return (bigIntSeq + BigInt(1)).toString();
  }
  waitForLock(accountId) {
    return __awaiter(this, void 0, void 0, function* () {
      const existingLock = this.locks.get(accountId);
      if (existingLock) {
        yield existingLock;
      }
    });
  }
  acquireLock(accountId) {
    return __awaiter(this, void 0, void 0, function* () {
      let releaseLock;
      const lockPromise = new Promise((resolve) => {
        releaseLock = resolve;
      });
      this.locks.set(accountId, lockPromise);
      return Promise.resolve();
    });
  }
  releaseLock(accountId) {
    this.locks.delete(accountId);
  }
  startAutoRefresh(accountId, fetchSequence) {
    // Clear existing timer if any
    const existingTimer = this.refreshTimers.get(accountId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }
    // Set up new refresh timer
    const timer = setInterval(
      () =>
        __awaiter(this, void 0, void 0, function* () {
          try {
            yield this.refreshSequence(accountId, fetchSequence);
          } catch (error) {
            // Silent fail - will retry on next interval
            console.error(
              `Failed to refresh sequence for ${accountId}:`,
              error
            );
          }
        }),
      this.config.refreshInterval
    );
    this.refreshTimers.set(accountId, timer);
  }
  /**
   * Cleanup resources
   */
  destroy() {
    this.clearAll();
  }
}
exports.SequenceManager = SequenceManager;
/**
 * Create a singleton instance for global use
 */
exports.globalSequenceManager = new SequenceManager();
