/**
 * Sequence Manager for Stellar Account Transactions
 *
 * Handles sequence number tracking and prediction for highly concurrent
 * transaction submission scenarios. Prevents sequence number collisions
 * and transaction failures due to incorrect sequence numbers.
 */

export interface SequenceManagerConfig {
  /**
   * Time-to-live for cached sequence numbers (milliseconds)
   * Default: 30000 (30 seconds)
   */
  cacheTTL?: number;

  /**
   * Maximum number of pending transactions to track per account
   * Default: 100
   */
  maxPendingTransactions?: number;

  /**
   * Whether to automatically refresh sequence numbers from network
   * Default: true
   */
  autoRefresh?: boolean;

  /**
   * Interval for automatic refresh (milliseconds)
   * Default: 10000 (10 seconds)
   */
  refreshInterval?: number;
}

export interface SequenceInfo {
  /** Current sequence number from network */
  current: string;
  /** Next available sequence number for new transaction */
  next: string;
  /** Number of pending transactions */
  pendingCount: number;
  /** Timestamp when sequence was last fetched */
  lastFetched: number;
  /** Whether this sequence is from cache or fresh */
  cached: boolean;
}

export interface PendingTransaction {
  /** Sequence number used by this transaction */
  sequence: string;
  /** Transaction hash (if submitted) */
  hash?: string;
  /** Timestamp when transaction was created */
  createdAt: number;
  /** Transaction status */
  status: "pending" | "submitted" | "confirmed" | "failed";
  /** Optional transaction metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Manages sequence numbers for Stellar accounts in concurrent scenarios
 */
export class SequenceManager {
  private sequences: Map<string, SequenceInfo> = new Map();
  private pending: Map<string, Map<string, PendingTransaction>> = new Map();
  private locks: Map<string, Promise<void>> = new Map();
  private config: Required<SequenceManagerConfig>;
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: SequenceManagerConfig = {}) {
    this.config = {
      cacheTTL: config.cacheTTL ?? 30000,
      maxPendingTransactions: config.maxPendingTransactions ?? 100,
      autoRefresh: config.autoRefresh ?? true,
      refreshInterval: config.refreshInterval ?? 10000,
    };
  }

  /**
   * Get the next available sequence number for an account
   * Handles concurrent requests by queuing them
   */
  async getNextSequence(
    accountId: string,
    fetchSequence: () => Promise<string>
  ): Promise<SequenceInfo> {
    // Wait for any pending operations on this account
    await this.waitForLock(accountId);

    // Create a lock for this operation
    const lockPromise = this.acquireLock(accountId);

    try {
      await lockPromise;

      const cached = this.sequences.get(accountId);
      const now = Date.now();

      // Check if cached sequence is still valid
      if (cached && now - cached.lastFetched < this.config.cacheTTL) {
        // Increment the next sequence number
        const nextSeq = this.incrementSequence(cached.next);

        const updated: SequenceInfo = {
          current: cached.current,
          next: nextSeq,
          pendingCount: cached.pendingCount + 1,
          lastFetched: cached.lastFetched,
          cached: true,
        };

        this.sequences.set(accountId, updated);
        return { ...updated };
      }

      // Fetch fresh sequence from network
      const currentSeq = await fetchSequence();
      const nextSeq = this.incrementSequence(currentSeq);

      const info: SequenceInfo = {
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

      return { ...info };
    } finally {
      this.releaseLock(accountId);
    }
  }

  /**
   * Reserve a specific sequence number for a transaction
   * Returns the reserved sequence or null if already taken
   */
  async reserveSequence(
    accountId: string,
    sequence: string,
    metadata?: Record<string, unknown>
  ): Promise<PendingTransaction | null> {
    await this.waitForLock(accountId);
    const lockPromise = this.acquireLock(accountId);

    try {
      await lockPromise;

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

      const transaction: PendingTransaction = {
        sequence,
        createdAt: Date.now(),
        status: "pending",
        metadata,
      };

      accountPending.set(sequence, transaction);
      this.pending.set(accountId, accountPending);

      return { ...transaction };
    } finally {
      this.releaseLock(accountId);
    }
  }

  /**
   * Mark a transaction as submitted
   */
  async markSubmitted(
    accountId: string,
    sequence: string,
    hash: string
  ): Promise<void> {
    await this.waitForLock(accountId);
    const lockPromise = this.acquireLock(accountId);

    try {
      await lockPromise;

      const accountPending = this.pending.get(accountId);
      const transaction = accountPending?.get(sequence);

      if (transaction) {
        transaction.status = "submitted";
        transaction.hash = hash;
      }
    } finally {
      this.releaseLock(accountId);
    }
  }

  /**
   * Mark a transaction as confirmed and remove from pending
   */
  async markConfirmed(accountId: string, sequence: string): Promise<void> {
    await this.waitForLock(accountId);
    const lockPromise = this.acquireLock(accountId);

    try {
      await lockPromise;

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
  }

  /**
   * Mark a transaction as failed and remove from pending
   */
  async markFailed(accountId: string, sequence: string): Promise<void> {
    await this.waitForLock(accountId);
    const lockPromise = this.acquireLock(accountId);

    try {
      await lockPromise;

      const accountPending = this.pending.get(accountId);
      const transaction = accountPending?.get(sequence);

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
  }

  /**
   * Get all pending transactions for an account
   */
  getPendingTransactions(accountId: string): PendingTransaction[] {
    const accountPending = this.pending.get(accountId);
    if (!accountPending) {
      return [];
    }

    return Array.from(accountPending.values()).map((tx) => ({ ...tx }));
  }

  /**
   * Get current sequence info for an account (from cache)
   */
  getSequenceInfo(accountId: string): SequenceInfo | null {
    const info = this.sequences.get(accountId);
    return info ? { ...info } : null;
  }

  /**
   * Force refresh sequence number from network
   */
  async refreshSequence(
    accountId: string,
    fetchSequence: () => Promise<string>
  ): Promise<SequenceInfo> {
    await this.waitForLock(accountId);
    const lockPromise = this.acquireLock(accountId);

    try {
      await lockPromise;

      const currentSeq = await fetchSequence();
      const accountPending = this.pending.get(accountId);
      const pendingCount = accountPending?.size || 0;

      // Calculate next sequence considering pending transactions
      let nextSeq = currentSeq;
      for (let i = 0; i < pendingCount; i++) {
        nextSeq = this.incrementSequence(nextSeq);
      }

      const info: SequenceInfo = {
        current: currentSeq,
        next: this.incrementSequence(nextSeq),
        pendingCount,
        lastFetched: Date.now(),
        cached: false,
      };

      this.sequences.set(accountId, info);
      return { ...info };
    } finally {
      this.releaseLock(accountId);
    }
  }

  /**
   * Clear all cached data for an account
   */
  clearAccount(accountId: string): void {
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
  clearAll(): void {
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
  getStats(): {
    accountsTracked: number;
    totalPending: number;
    accountStats: Array<{
      accountId: string;
      pendingCount: number;
      lastFetched: number;
      cacheAge: number;
    }>;
  } {
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

  private incrementSequence(sequence: string): string {
    const bigIntSeq = BigInt(sequence);
    return (bigIntSeq + BigInt(1)).toString();
  }

  private async waitForLock(accountId: string): Promise<void> {
    const existingLock = this.locks.get(accountId);
    if (existingLock) {
      await existingLock;
    }
  }

  private async acquireLock(accountId: string): Promise<void> {
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(accountId, lockPromise);
    return Promise.resolve();
  }

  private releaseLock(accountId: string): void {
    this.locks.delete(accountId);
  }

  private startAutoRefresh(
    accountId: string,
    fetchSequence: () => Promise<string>
  ): void {
    // Clear existing timer if any
    const existingTimer = this.refreshTimers.get(accountId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    // Set up new refresh timer
    const timer = setInterval(async () => {
      try {
        await this.refreshSequence(accountId, fetchSequence);
      } catch (error) {
        // Silent fail - will retry on next interval
        console.error(`Failed to refresh sequence for ${accountId}:`, error);
      }
    }, this.config.refreshInterval);

    this.refreshTimers.set(accountId, timer);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.clearAll();
  }
}

/**
 * Create a singleton instance for global use
 */
export const globalSequenceManager = new SequenceManager();
