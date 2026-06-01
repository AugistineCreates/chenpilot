/**
 * Stellar Sequence Helper
 *
 * Integration layer between SequenceManager and Stellar SDK
 * Provides convenient methods for building transactions with managed sequences
 */

import { SequenceManager, SequenceInfo } from "./sequenceManager";

export interface StellarAccount {
  /** Account public key */
  accountId(): string;
  /** Current sequence number */
  sequenceNumber(): string;
  /** Increment sequence number */
  incrementSequenceNumber(): void;
}

export interface HorizonServer {
  /** Load account from Horizon */
  loadAccount(accountId: string): Promise<StellarAccount>;
}

export interface ManagedTransactionBuilder {
  /** Build the transaction */
  build(): unknown;
  /** Get the sequence number used */
  getSequence(): string;
  /** Get sequence info */
  getSequenceInfo(): SequenceInfo;
}

/**
 * Helper class for managing Stellar account sequences
 */
export class StellarSequenceHelper {
  constructor(
    private sequenceManager: SequenceManager,
    private horizonServer: HorizonServer
  ) {}

  /**
   * Get next sequence for an account with automatic network fetching
   */
  async getNextSequence(accountId: string): Promise<SequenceInfo> {
    return this.sequenceManager.getNextSequence(accountId, async () => {
      const account = await this.horizonServer.loadAccount(accountId);
      return account.sequenceNumber();
    });
  }

  /**
   * Create a managed account object with predicted sequence
   * This can be used directly with TransactionBuilder
   */
  async createManagedAccount(
    accountId: string,
    AccountClass: new (accountId: string, sequence: string) => StellarAccount
  ): Promise<{ account: StellarAccount; sequenceInfo: SequenceInfo }> {
    const sequenceInfo = await this.getNextSequence(accountId);

    // Reserve the sequence number
    await this.sequenceManager.reserveSequence(accountId, sequenceInfo.next, {
      timestamp: Date.now(),
    });

    // Create account with the next sequence
    const account = new AccountClass(accountId, sequenceInfo.next);

    return { account, sequenceInfo };
  }

  /**
   * Build a transaction with managed sequence
   * Returns a wrapper that tracks the transaction
   */
  async buildManagedTransaction<T>(
    accountId: string,
    AccountClass: new (accountId: string, sequence: string) => StellarAccount,
    buildFn: (account: StellarAccount) => T
  ): Promise<{
    transaction: T;
    sequence: string;
    sequenceInfo: SequenceInfo;
    markSubmitted: (hash: string) => Promise<void>;
    markConfirmed: () => Promise<void>;
    markFailed: () => Promise<void>;
  }> {
    const { account, sequenceInfo } = await this.createManagedAccount(
      accountId,
      AccountClass
    );

    const transaction = buildFn(account);
    const sequence = sequenceInfo.next;

    return {
      transaction,
      sequence,
      sequenceInfo,
      markSubmitted: async (hash: string) => {
        await this.sequenceManager.markSubmitted(accountId, sequence, hash);
      },
      markConfirmed: async () => {
        await this.sequenceManager.markConfirmed(accountId, sequence);
      },
      markFailed: async () => {
        await this.sequenceManager.markFailed(accountId, sequence);
      },
    };
  }

  /**
   * Submit a transaction with automatic sequence tracking
   */
  async submitManagedTransaction<T, R>(
    accountId: string,
    AccountClass: new (accountId: string, sequence: string) => StellarAccount,
    buildFn: (account: StellarAccount) => T,
    submitFn: (transaction: T) => Promise<R>
  ): Promise<R> {
    const managed = await this.buildManagedTransaction(
      accountId,
      AccountClass,
      buildFn
    );

    try {
      const result = await submitFn(managed.transaction);

      // Extract hash if available
      const hash =
        typeof result === "object" && result !== null && "hash" in result
          ? String((result as { hash: unknown }).hash)
          : undefined;

      if (hash) {
        await managed.markSubmitted(hash);
      }

      await managed.markConfirmed();
      return result;
    } catch (error) {
      await managed.markFailed();
      throw error;
    }
  }

  /**
   * Get pending transactions for an account
   */
  getPendingTransactions(accountId: string) {
    return this.sequenceManager.getPendingTransactions(accountId);
  }

  /**
   * Get sequence info for an account
   */
  getSequenceInfo(accountId: string) {
    return this.sequenceManager.getSequenceInfo(accountId);
  }

  /**
   * Refresh sequence from network
   */
  async refreshSequence(accountId: string): Promise<SequenceInfo> {
    return this.sequenceManager.refreshSequence(accountId, async () => {
      const account = await this.horizonServer.loadAccount(accountId);
      return account.sequenceNumber();
    });
  }

  /**
   * Clear cached data for an account
   */
  clearAccount(accountId: string): void {
    this.sequenceManager.clearAccount(accountId);
  }

  /**
   * Get statistics
   */
  getStats() {
    return this.sequenceManager.getStats();
  }
}

/**
 * Create a helper instance with a sequence manager
 */
export function createStellarSequenceHelper(
  horizonServer: HorizonServer,
  sequenceManager?: SequenceManager
): StellarSequenceHelper {
  const manager = sequenceManager || new SequenceManager();
  return new StellarSequenceHelper(manager, horizonServer);
}
