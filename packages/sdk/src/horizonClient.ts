/**
 * Horizon Client for Stellar API interactions with cursor-based pagination support
 */

import { combineSignals, throwIfAborted, abortableSleep } from "./abort";
import type { AbortSignalLike } from "./types";

export interface RetryConfig {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

export interface PaginationOptions {
  cursor?: string;
  limit?: number;
  /** Optional external signal to cancel the request. */
  signal?: AbortSignalLike;
}

export interface AccountOffer {
  id: string;
  paging_token: string;
  seller: string;
  selling: {
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  };
  buying: {
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  };
  amount: string;
  price_r: {
    n: number;
    d: number;
  };
  price: string;
  last_modified_ledger: number;
  last_modified_time: string;
}

export interface PaginatedResponse<T> {
  records: T[];
  nextCursor?: string;
  prevCursor?: string;
}

interface HorizonLinkObject {
  href: string;
}

interface HorizonLinks {
  self: HorizonLinkObject;
  next?: HorizonLinkObject;
  prev?: HorizonLinkObject;
}

interface HorizonApiResponse<T> {
  _links: HorizonLinks;
  _embedded?: {
    records: T[];
  };
  records?: T[];
}

interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

type FetchLike = (url: string, options?: FetchOptions) => Promise<Response>;

interface Response {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface HorizonClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeout?: number;
  retry?: RetryConfig;
}

/**
 * Horizon Client for accessing Stellar Horizon API with cursor-based pagination
 */
export class HorizonClient {
  private baseUrl: string;
  private fetch: FetchLike;
  private timeout?: number;
  private retryConfig: Required<RetryConfig>;

  constructor(options: HorizonClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://horizon.stellar.org";
    this.fetch = options.fetchFn ?? globalThis.fetch;
    this.timeout = options.timeout;
    this.retryConfig = {
      maxAttempts: options.retry?.maxAttempts ?? 3,
      initialDelayMs: options.retry?.initialDelayMs ?? 100,
      maxDelayMs: options.retry?.maxDelayMs ?? 5000,
      backoffMultiplier: options.retry?.backoffMultiplier ?? 2,
    };
  }

  /**
   * Fetch account offers with cursor-based pagination
   * @param accountId - The account ID to fetch offers for
   * @param options - Pagination options (cursor, limit, optional signal)
   * @returns Paginated response with account offers
   */
  async getAccountOffers(
    accountId: string,
    options?: PaginationOptions
  ): Promise<PaginatedResponse<AccountOffer>> {
    const params = new URLSearchParams();

    if (options?.cursor) {
      params.append("cursor", options.cursor);
    }

    if (options?.limit) {
      // Horizon API has a maximum limit of 200
      params.append("limit", Math.min(options.limit, 200).toString());
    } else {
      // Default limit
      params.append("limit", "50");
    }

    const url = `${this.baseUrl}/accounts/${accountId}/offers?${params.toString()}`;

    // Apply one end-to-end deadline across all retry attempts
    const requestStartTime = Date.now();
    const totalDeadline = this.timeout;

    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      // Check if already aborted before starting attempt
      throwIfAborted(options?.signal);

      // Calculate remaining time for this attempt
      let attemptTimeout: number | undefined;
      if (totalDeadline !== undefined) {
        const elapsed = Date.now() - requestStartTime;
        const remaining = totalDeadline - elapsed;
        
        // Don't start a new attempt if deadline already exceeded
        if (remaining <= 0) {
          throw new Error(`Request deadline exceeded after ${elapsed}ms`);
        }
        attemptTimeout = remaining;
      }

      const combined = combineSignals(attemptTimeout, options?.signal);
      try {
        throwIfAborted(combined.signal);
        const response = await this.fetch(url, {
          signal: combined.signal as AbortSignal | undefined,
        });

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(
            `Failed to fetch account offers: ${response.status} ${errorText}`
          );
          
          // Retry on 5xx errors or 429 (rate limit)
          if (response.status >= 500 || response.status === 429) {
            lastError = error;
            combined.cleanup();
            
            // Calculate backoff delay for next retry
            if (attempt < this.retryConfig.maxAttempts - 1) {
              const delay = Math.min(
                this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt),
                this.retryConfig.maxDelayMs
              );
              
              // Check if we have time for backoff within deadline
              if (totalDeadline !== undefined) {
                const elapsed = Date.now() - requestStartTime;
                const remaining = totalDeadline - elapsed;
                if (remaining < delay) {
                  throw new Error(`Request deadline exceeded during retry backoff`);
                }
              }
              
              // Abort during backoff releases timers and prevents next attempt
              await abortableSleep(delay, options?.signal);
            }
            continue;
          }
          
          // Non-retryable error
          throw error;
        }

        const data = (await response.json()) as HorizonApiResponse<AccountOffer>;

        // Extract next and previous cursors from Horizon links
        let nextCursor: string | undefined;
        let prevCursor: string | undefined;

        if (data._links?.next?.href) {
          const nextUrl = new URL(data._links.next.href);
          nextCursor = nextUrl.searchParams.get("cursor") ?? undefined;
        }

        if (data._links?.prev?.href) {
          const prevUrl = new URL(data._links.prev.href);
          prevCursor = prevUrl.searchParams.get("cursor") ?? undefined;
        }

        const records = data._embedded?.records ?? data.records ?? [];

        combined.cleanup();
        return {
          records,
          nextCursor,
          prevCursor,
        };
      } catch (error) {
        combined.cleanup();
        
        // Re-throw abort errors immediately without retry
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        
        lastError = error as Error;
        
        // Only retry if we haven't exhausted attempts
        if (attempt < this.retryConfig.maxAttempts - 1) {
          const delay = Math.min(
            this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt),
            this.retryConfig.maxDelayMs
          );
          
          // Check deadline before backoff
          if (totalDeadline !== undefined) {
            const elapsed = Date.now() - requestStartTime;
            const remaining = totalDeadline - elapsed;
            if (remaining < delay) {
              throw new Error(`Request deadline exceeded during retry backoff`);
            }
          }
          
          await abortableSleep(delay, options?.signal);
        }
      }
    }

    throw lastError ?? new Error("Request failed after all retry attempts");
  }

  /**
   * Async iterator for iterating through all account offers
   * Automatically handles pagination using cursors
   * @param accountId - The account ID to fetch offers for
   * @param pageSize - Number of records per page (default: 50, max: 200)
   * @param signal - Optional external signal to cancel the iteration
   */
  async *iterateAccountOffers(
    accountId: string,
    pageSize: number = 50,
    signal?: AbortSignalLike
  ): AsyncGenerator<AccountOffer> {
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      throwIfAborted(signal);
      const page = await this.getAccountOffers(accountId, {
        cursor,
        limit: pageSize,
        signal,
      });

      for (const record of page.records) {
        yield record;
      }

      if (!page.nextCursor) {
        hasMore = false;
      } else {
        cursor = page.nextCursor;
      }
    }
  }
}
