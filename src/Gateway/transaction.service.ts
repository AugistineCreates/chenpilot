import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import AppDataSource from "../config/Datasource";
import { User } from "../Auth/user.entity";

/**
 * Transaction types supported by the endpoint
 */
export type TransactionType =
  | "funding"
  | "deployment"
  | "swap"
  | "transfer"
  | "all";

/**
 * Query parameters for transaction history
 */
export interface TransactionQueryParams {
  type?: TransactionType;
  startDate?: string;
  endDate?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Transaction record from Horizon API
 */
export interface HorizonTransaction {
  id: string;
  hash: string;
  ledger: number;
  created_at: string;
  source_account: string;
  fee_paid: number;
  operation_count: number;
  successful: boolean;
  memo_type?: string;
  memo?: string;
  operations: HorizonOperation[];
}

/**
 * Operation record from Horizon API
 */
export interface HorizonOperation {
  id: string;
  type: string;
  source_account: string;
  created_at: string;
  transaction_hash: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  from?: string;
  to?: string;
  amount?: string;
  starting_balance?: string;
  name?: string;
  value?: string;
}

/**
 * Effect record from Horizon API
 */
export interface HorizonEffect {
  id: string;
  account: string;
  type: string;
  created_at: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
  starting_balance?: string;
}

/**
 * Normalized transaction response
 */
export interface TransactionHistoryItem {
  id: string;
  hash: string;
  type: TransactionType;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  feePaid: number;
  successful: boolean;
  memo?: string;
  operations: {
    type: string;
    from?: string;
    to?: string;
    amount?: string;
    asset?: string;
  }[];
  effects: {
    type: string;
    amount?: string;
    asset?: string;
  }[];
}

/**
 * Paginated response
 */
export interface PaginatedTransactionsResponse {
  transactions: TransactionHistoryItem[];
  pagination: {
    nextCursor?: string;
    prevCursor?: string;
    limit: number;
    total: number;
  };
}

/**
 * Cache entry
 */
interface CacheEntry {
  data: PaginatedTransactionsResponse;
  timestamp: number;
}

/**
 * Service for fetching and caching Stellar transaction history
 */
export class TransactionHistoryService {
  private server: StellarSdk.Horizon.Server;
  private userRepository = AppDataSource.getRepository(User);
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 30000; // 30 seconds in milliseconds

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
  }

  /**
   * Generate cache key from query parameters
   */
  private generateCacheKey(
    userId: string,
    params: TransactionQueryParams
  ): string {
    return `${userId}-${JSON.stringify(params)}`;
  }

  /**
   * Get cached data if available and not expired
   */
  private getCachedData(
    cacheKey: string
  ): PaginatedTransactionsResponse | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cache data
   */
  private setCachedData(
    cacheKey: string,
    data: PaginatedTransactionsResponse
  ): void {
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    // Clean up expired cache entries periodically
    this.cleanExpiredCache();
  }

  /**
   * Clean up expired cache entries
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Find user by ID
   */
  private async findUserById(userId: string): Promise<User | null> {
    try {
      return await this.userRepository.findOne({
        where: { id: userId },
      });
    } catch (error) {
      console.error("Error finding user by ID:", error);
      return null;
    }
  }

  /**
   * Determine transaction type based on operations
   */
  private determineTransactionType(
    operations: HorizonOperation[]
  ): TransactionType {
    for (const op of operations) {
      switch (op.type) {
        case "create_account":
          return "funding";
        case "path_payment_strict_send":
        case "path_payment_strict_receive":
          return "swap";
        case "payment":
          // Check if it's a transfer (not self-payment)
          if (op.from && op.to && op.from !== op.to) {
            return "transfer";
          }
          break;
        case "manage_data":
          // Could be deployment-related
          if (op.name === "deployment") {
            return "deployment";
          }
          break;
      }
    }
    return "transfer"; // Default to transfer for unknown types
  }

  /**
   * Normalize Horizon transaction to our format
   */
  private normalizeTransaction(
    tx: HorizonTransaction,
    effects: HorizonEffect[]
  ): TransactionHistoryItem {
    const type = this.determineTransactionType(tx.operations);

    const normalizedOps = tx.operations.map((op) => ({
      type: op.type,
      from: op.from,
      to: op.to,
      amount: op.amount || op.starting_balance,
      asset: op.asset_code
        ? `${op.asset_code}:${op.asset_issuer}`
        : op.asset_type === "native"
          ? "XLM"
          : undefined,
    }));

    const normalizedEffects = effects.map((effect) => ({
      type: effect.type,
      amount: effect.amount || effect.starting_balance,
      asset: effect.asset_code
        ? `${effect.asset_code}:${effect.asset_issuer}`
        : effect.asset_type === "native"
          ? "XLM"
          : undefined,
    }));

    return {
      id: tx.id,
      hash: tx.hash,
      type,
      ledger: tx.ledger,
      createdAt: tx.created_at,
      sourceAccount: tx.source_account,
      feePaid: tx.fee_paid,
      successful: tx.successful,
      memo: tx.memo,
      operations: normalizedOps,
      effects: normalizedEffects,
    };
  }

  /**
   * Filter transactions by type
   */
  private filterByType(
    transactions: TransactionHistoryItem[],
    type: TransactionType
  ): TransactionHistoryItem[] {
    if (type === "all") {
      return transactions;
    }
    return transactions.filter((tx) => tx.type === type);
  }

  /**
   * Filter transactions by date range
   */
  private filterByDate(
    transactions: TransactionHistoryItem[],
    startDate?: string,
    endDate?: string
  ): TransactionHistoryItem[] {
    let filtered = transactions;

    if (startDate) {
      const start = new Date(startDate);
      filtered = filtered.filter((tx) => new Date(tx.createdAt) >= start);
    }

    if (endDate) {
      const end = new Date(endDate);
      filtered = filtered.filter((tx) => new Date(tx.createdAt) <= end);
    }

    return filtered;
  }

  /**
   * Fetch transactions from Horizon API
   */
  private async fetchTransactions(
    address: string,
    limit: number,
    cursor?: string
  ): Promise<{ transactions: HorizonTransaction[]; nextCursor?: string }> {
    try {
      const builder = this.server
        .transactions()
        .forAccount(address)
        .order("desc")
        .limit(limit);

      if (cursor) {
        builder.cursor(cursor);
      }

      const response = await builder.call();
      const nextCursor =
        response.records.length === limit
          ? response.records[response.records.length - 1].paging_token
          : undefined;

      return {
        transactions: response.records as unknown as HorizonTransaction[],
        nextCursor,
      };
    } catch (error) {
      console.error("Error fetching transactions from Horizon:", error);
      throw new Error(
        `Failed to fetch transactions: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Fetch effects for a transaction
   */
  private async fetchEffects(
    transactionHash: string
  ): Promise<HorizonEffect[]> {
    try {
      const response = await this.server
        .effects()
        .forTransaction(transactionHash)
        .call();
      return response.records as unknown as HorizonEffect[];
    } catch (error) {
      console.error(
        `Error fetching effects for transaction ${transactionHash}:`,
        error
      );
      return [];
    }
  }

  /**
   * Get transaction history for a user
   */
  public async getTransactionHistory(
    userId: string,
    params: TransactionQueryParams = {}
  ): Promise<PaginatedTransactionsResponse> {
    // Check cache first
    const cacheKey = this.generateCacheKey(userId, params);
    const cached = this.getCachedData(cacheKey);
    if (cached) {
      return cached;
    }

    // Find user
    const user = await this.findUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Set default limit
    const limit = params.limit || 20;
    if (limit > 100) {
      throw new Error("Limit cannot exceed 100");
    }

    // Fetch transactions from Horizon
    const { transactions: horizonTxs, nextCursor } =
      await this.fetchTransactions(user.address, limit, params.cursor);

    // Fetch effects for each transaction
    const transactionsWithEffects = await Promise.all(
      horizonTxs.map(async (tx) => {
        const effects = await this.fetchEffects(tx.hash);
        return this.normalizeTransaction(tx, effects);
      })
    );

    // Apply filters
    let filteredTransactions = transactionsWithEffects;

    if (params.type) {
      filteredTransactions = this.filterByType(
        filteredTransactions,
        params.type
      );
    }

    if (params.startDate || params.endDate) {
      filteredTransactions = this.filterByDate(
        filteredTransactions,
        params.startDate,
        params.endDate
      );
    }

    const response: PaginatedTransactionsResponse = {
      transactions: filteredTransactions,
      pagination: {
        nextCursor,
        prevCursor: params.cursor,
        limit,
        total: filteredTransactions.length,
      },
    };

    // Cache the response
    this.setCachedData(cacheKey, response);

    return response;
  }
}

// Export singleton instance
export const transactionHistoryService = new TransactionHistoryService();
