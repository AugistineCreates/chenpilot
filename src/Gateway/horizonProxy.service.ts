import config from "../config/config";
import { createBudget, budgetedFetch, BudgetExhaustedError, type RequestBudget } from "../utils/budget";

const BLOCKED_QUERY_KEYS = [
  "api_key",
  "apikey",
  "token",
  "authorization",
  "auth",
  "x-api-key",
];

const ALLOWED_PATH_PATTERNS: RegExp[] = [
  /^\/accounts\/[A-Z0-9]+$/,
  /^\/accounts\/[A-Z0-9]+\/(payments|operations|transactions|effects|offers|trades)$/,
  /^\/(transactions|operations|payments|ledgers|offers|trades|assets|fee_stats|claimable_balances|liquidity_pools)$/,
  /^\/(transactions|operations|ledgers)\/[A-Za-z0-9-]+$/,
];

export class HorizonProxyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "HorizonProxyError";
  }
}

const DEFAULT_BUDGET: RequestBudget = createBudget({
  deadlineMs: config.externalRequest.defaultBudget.deadlineMs,
  attempts: config.externalRequest.defaultBudget.attempts,
  bytes: config.externalRequest.defaultBudget.bytes,
  downstreamCalls: config.externalRequest.defaultBudget.downstreamCalls,
  path: "horizon.proxy",
});

export class HorizonProxyService {
  private readonly requestTimeoutMs = 10000;

  async proxyGet(
    path: string,
    query: Record<string, string | string[] | undefined>,
    budget: RequestBudget = DEFAULT_BUDGET
  ): Promise<unknown> {
    this.validatePath(path);

    const url = new URL(path, config.stellar.horizonUrl);
    const sanitizedQuery = this.sanitizeQuery(query);

    for (const key in sanitizedQuery) {
      if (!Object.prototype.hasOwnProperty.call(sanitizedQuery, key)) {
        continue;
      }

      url.searchParams.set(key, sanitizedQuery[key]);
    }

    try {
      const response = await budgetedFetch(budget, url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new HorizonProxyError(
          `Horizon request failed with status ${response.status}`,
          502
        );
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return response.json();
      }

      return response.text();
    } catch (error) {
      if (error instanceof HorizonProxyError) {
        throw error;
      }

      if (error instanceof BudgetExhaustedError) {
        throw new HorizonProxyError(
          `Horizon request budget exhausted: ${error.resource}`,
          504
        );
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new HorizonProxyError("Horizon request timed out", 504);
      }

      throw new HorizonProxyError("Failed to proxy Horizon request", 502);
    }
  }

  private validatePath(path: string): void {
    if (!path || typeof path !== "string") {
      throw new HorizonProxyError("Path is required", 400);
    }

    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new HorizonProxyError(
        "Path must be a valid relative Horizon path",
        400
      );
    }

    if (
      path.includes("..") ||
      path.includes("\\") ||
      /https?:\/\//i.test(path)
    ) {
      throw new HorizonProxyError("Path contains forbidden characters", 400);
    }

    const isAllowed = ALLOWED_PATH_PATTERNS.some((pattern) =>
      pattern.test(path)
    );
    if (!isAllowed) {
      throw new HorizonProxyError(
        "Requested Horizon path is not allowlisted",
        403
      );
    }
  }

  private sanitizeQuery(
    query: Record<string, string | string[] | undefined>
  ): Record<string, string> {
    const sanitized: Record<string, string> = {};

    let queryCount = 0;
    for (const rawKey in query) {
      if (!Object.prototype.hasOwnProperty.call(query, rawKey)) {
        continue;
      }

      const rawValue = query[rawKey];
      if (rawValue === undefined || rawKey === "") {
        continue;
      }

      queryCount += 1;
      if (queryCount > 25) {
        throw new HorizonProxyError("Too many query parameters", 400);
      }

      const key = rawKey.trim();
      const normalizedKey = key.toLowerCase();

      if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
        throw new HorizonProxyError(`Invalid query key: ${key}`, 400);
      }

      if (BLOCKED_QUERY_KEYS.includes(normalizedKey)) {
        throw new HorizonProxyError(`Forbidden query key: ${key}`, 400);
      }

      const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
      if (value === undefined) {
        continue;
      }

      const normalizedValue = String(value);
      if (normalizedValue.length > 500) {
        throw new HorizonProxyError(
          `Query value too long for key: ${key}`,
          400
        );
      }

      sanitized[key] = normalizedValue;
    }

    return sanitized;
  }
}

export const horizonProxyService = new HorizonProxyService();
