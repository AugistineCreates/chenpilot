/**
 * FaultProxy
 *
 * Injectable adapters that wrap each of the five real services and consult
 * SeededFaultScheduler on every call to decide whether to apply a fault.
 *
 * Each proxy implements a minimal interface (the same surface area that the
 * production code calls) and honours the FaultProxyStub contract so that
 * InvariantChecker can inspect call history without access to a live service.
 *
 * Supported fault kinds per service:
 *
 *   latency        – delay resolution by [minMs, maxMs] ms (seeded uniform).
 *   partition      – throw a "PARTITION" error immediately.
 *   staleRead      – resolve with a fixed or cached stale payload.
 *   crash          – mark service as crashed; all subsequent calls throw until
 *                    heal() is called.
 *   partialResponse– strip (1 - completenessRatio) of response fields; optionally
 *                    append malformed suffix.
 *   timeout        – delay resolution by a very large value (simulated via
 *                    a rejected Promise after a timeout threshold).
 *   corruptedData  – mutate selected fields according to the strategy.
 *
 * All delays use the passed-in `delayFn` (defaults to real setTimeout) so
 * tests can inject jest.useFakeTimers / vi.useFakeTimers without breakage.
 */

import {
  CallContext,
  FaultKind,
  FaultLogEntry,
  FaultParams,
  FaultProxyStub,
  ServiceId,
} from "./types";
import { SeededFaultScheduler } from "./SeededFaultScheduler";

// ─── Delay helper ────────────────────────────────────────────────────────────

/** Injectable delay function; defaults to real setTimeout. */
export type DelayFn = (ms: number) => Promise<void>;

const realDelay: DelayFn = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─── Base proxy ──────────────────────────────────────────────────────────────

/**
 * BaseProxy encapsulates all fault-application logic and fault-log bookkeeping.
 * Concrete per-service proxies extend this and add typed method wrappers.
 */
export abstract class BaseProxy implements FaultProxyStub {
  protected readonly scheduler: SeededFaultScheduler;
  protected readonly service: ServiceId;
  protected readonly delay: DelayFn;

  private faultLog: FaultLogEntry[] = [];
  private crashed = false;
  private callCounter = 0;
  /** Index into this.faultLog at which heal() was called; -1 = not healed. */
  private healedAtLogLength = -1;

  constructor(
    scheduler: SeededFaultScheduler,
    service: ServiceId,
    delay: DelayFn = realDelay
  ) {
    this.scheduler = scheduler;
    this.service = service;
    this.delay = delay;
  }

  // ── FaultProxyStub implementation ─────────────────────────────────────────

  heal(): void {
    this.crashed = false;
    // Watermark: everything at or after this log-array index is post-heal.
    this.healedAtLogLength = this.faultLog.length;
    this.scheduler.healService(this.service);
  }

  getFaultLog(): FaultLogEntry[] {
    return [...this.faultLog];
  }

  /**
   * Returns only the fault log entries that were recorded AFTER heal() was
   * called.  Invariant checks use this to avoid flagging pre-recovery faults.
   */
  getPostHealLog(): FaultLogEntry[] {
    if (this.healedAtLogLength === -1) return [];
    return this.faultLog.slice(this.healedAtLogLength);
  }

  reset(): void {
    this.faultLog = [];
    this.crashed = false;
    this.callCounter = 0;
    this.healedAtLogLength = -1;
  }

  // ── Protected helpers used by concrete proxies ────────────────────────────

  /**
   * Wraps any async service call with fault-injection logic.
   * Returns a Promise that resolves/rejects according to the active fault.
   *
   * @param fn     The original (clean) call to the backing service.
   * @param meta   Optional extra data to store on the fault-log entry.
   */
  protected async call<T>(
    fn: () => Promise<T>,
    meta?: Record<string, unknown>
  ): Promise<T> {
    const callIndex = this.scheduler.nextCallIndex();
    const ctx: CallContext = {
      boundary: this.scheduler.getCurrentBoundary(),
      callIndex,
      meta,
    };

    const startTs = Date.now();

    // Crash gate: if the service is currently crashed, fail immediately.
    if (this.crashed) {
      const latencyMs = Date.now() - startTs;
      this.recordLog(callIndex, ctx.boundary, "crash", false, latencyMs);
      throw new FaultError(
        "crash",
        `${this.service}: service is crashed`
      );
    }

    const faultParams = this.scheduler.resolveFault(this.service, ctx);

    if (faultParams === null) {
      // Clean call — execute the real function.
      try {
        const result = await fn();
        const latencyMs = Date.now() - startTs;
        this.recordLog(callIndex, ctx.boundary, undefined, true, latencyMs);
        return result;
      } catch (err) {
        const latencyMs = Date.now() - startTs;
        this.recordLog(callIndex, ctx.boundary, undefined, false, latencyMs);
        throw err;
      }
    }

    // Apply the fault.
    return this.applyFault<T>(faultParams, fn, callIndex, ctx.boundary, startTs);
  }

  private async applyFault<T>(
    params: FaultParams,
    fn: () => Promise<T>,
    callIndex: number,
    boundary: string,
    startTs: number
  ): Promise<T> {
    switch (params.kind) {
      case "latency": {
        const range = params.maxMs - params.minMs;
        // Use the scheduler's RNG indirectly via a deterministic fraction
        // drawn by the *next* resolveFault call would consume state; we use
        // a secondary approach: derive a deterministic value from callIndex.
        const fraction = ((callIndex * 0x9e3779b9) >>> 0) / 0xffffffff;
        const extraMs = params.minMs + Math.floor(fraction * range);
        await this.delay(extraMs);
        const result = await fn();
        const latencyMs = Date.now() - startTs;
        this.recordLog(callIndex, boundary, "latency", true, latencyMs);
        return result;
      }

      case "partition": {
        await this.delay(0); // yield to event loop for realism
        const latencyMs = Date.now() - startTs;
        this.recordLog(callIndex, boundary, "partition", false, latencyMs);
        throw new FaultError("partition", `${this.service}: PARTITION`);
      }

      case "staleRead": {
        if (params.fixedPayload !== undefined) {
          const latencyMs = Date.now() - startTs;
          this.recordLog(callIndex, boundary, "staleRead", true, latencyMs);
          return params.fixedPayload as T;
        }
        // No fixed payload — call through but stamp the response as stale.
        const fresh = await fn();
        const stale = this.applyStaleTag(fresh, params.staleByMs);
        const latencyMs = Date.now() - startTs;
        this.recordLog(callIndex, boundary, "staleRead", true, latencyMs);
        return stale as T;
      }

      case "crash": {
        this.crashed = true;
        const latencyMs = Date.now() - startTs;
        this.recordLog(callIndex, boundary, "crash", false, latencyMs);
        throw new FaultError("crash", `${this.service}: CRASH`);
      }

      case "partialResponse": {
        const full = await fn();
        const partial = this.applyPartialResponse(
          full,
          params.completenessRatio,
          params.malformed ?? false
        );
        const latencyMs = Date.now() - startTs;
        this.recordLog(callIndex, boundary, "partialResponse", true, latencyMs);
        return partial as T;
      }

      case "timeout": {
        // Simulate a timeout by delaying past a threshold and then rejecting.
        // Default threshold: 30 000 ms — tests should use fake timers.
        await this.delay(30_000);
        const latencyMs = Date.now() - startTs;
        this.recordLog(callIndex, boundary, "timeout", false, latencyMs);
        throw new FaultError("timeout", `${this.service}: TIMEOUT`);
      }

      case "corruptedData": {
        const clean = await fn();
        const corrupted = this.applyCorruption(
          clean,
          params.targetFields,
          params.strategy
        );
        const latencyMs = Date.now() - startTs;
        this.recordLog(callIndex, boundary, "corruptedData", true, latencyMs);
        return corrupted as T;
      }
    }
  }

  // ── Data-mutation helpers ─────────────────────────────────────────────────

  private applyStaleTag<T>(value: T, staleByMs: number): T {
    if (typeof value !== "object" || value === null) return value;
    return {
      ...(value as Record<string, unknown>),
      _staleByMs: staleByMs,
      _injected: true,
    } as T;
  }

  private applyPartialResponse<T>(
    value: T,
    ratio: number,
    malformed: boolean
  ): T {
    if (typeof value !== "object" || value === null) {
      return malformed ? ("__MALFORMED__" as unknown as T) : value;
    }
    const keys = Object.keys(value as Record<string, unknown>);
    const keepCount = Math.max(1, Math.floor(keys.length * ratio));
    const keptKeys = keys.slice(0, keepCount);
    const partial: Record<string, unknown> = { _partial: true };
    for (const k of keptKeys) {
      partial[k] = (value as Record<string, unknown>)[k];
    }
    if (malformed) partial["__malformed__"] = "}{invalid";
    return partial as T;
  }

  private applyCorruption<T>(
    value: T,
    targetFields: string[],
    strategy: "negate" | "zero" | "wrongType" | "swapWithAnother"
  ): T {
    if (typeof value !== "object" || value === null) return value;
    const obj = { ...(value as Record<string, unknown>), _corrupted: true };

    for (let i = 0; i < targetFields.length; i++) {
      const field = targetFields[i];
      if (!(field in obj)) continue;
      const original = obj[field];

      switch (strategy) {
        case "negate":
          obj[field] =
            typeof original === "number"
              ? -original
              : typeof original === "boolean"
                ? !original
                : null;
          break;
        case "zero":
          obj[field] = typeof original === "string" ? "" : 0;
          break;
        case "wrongType":
          obj[field] = typeof original === "number" ? String(original) : 0;
          break;
        case "swapWithAnother": {
          const nextField = targetFields[(i + 1) % targetFields.length];
          if (nextField !== field && nextField in obj) {
            const tmp = obj[field];
            obj[field] = obj[nextField];
            obj[nextField] = tmp;
          }
          break;
        }
      }
    }

    return obj as T;
  }

  private recordLog(
    callIndex: number,
    boundary: string,
    faultApplied: FaultKind | undefined,
    resolved: boolean,
    latencyMs: number
  ): void {
    this.faultLog.push({
      callIndex,
      boundary,
      faultApplied,
      resolved,
      latencyMs,
      timestamp: Date.now(),
    });
    this.callCounter++;
  }
}

// ─── FaultError ──────────────────────────────────────────────────────────────

/**
 * Typed error thrown by fault proxies so callers can distinguish injected
 * failures from real ones.
 */
export class FaultError extends Error {
  constructor(
    public readonly kind: FaultKind,
    message: string
  ) {
    super(message);
    this.name = "FaultError";
  }
}

// ─── Database proxy ──────────────────────────────────────────────────────────

/**
 * Minimal interface covering the TypeORM DataSource methods used by
 * production services.  Extend as more methods are tested.
 */
export interface DatabaseClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
  isInitialized: boolean;
}

/** Fault-injectable wrapper for the PostgreSQL database. */
export class DatabaseProxy extends BaseProxy implements DatabaseClient {
  private readonly real: DatabaseClient;

  constructor(
    real: DatabaseClient,
    scheduler: SeededFaultScheduler,
    delay?: DelayFn
  ) {
    super(scheduler, "database", delay);
    this.real = real;
  }

  get isInitialized(): boolean {
    return this.real.isInitialized;
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T> {
    return this.call(() => this.real.query<T>(sql, params), {
      sql: sql.slice(0, 120),
    });
  }
}

// ─── Redis proxy ─────────────────────────────────────────────────────────────

/**
 * Minimal interface covering the Redis operations used by the production
 * lock service and rate-limiter.
 */
export interface RedisClient {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean }
  ): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<unknown>;
}

/** Fault-injectable wrapper for Redis. */
export class RedisProxy extends BaseProxy implements RedisClient {
  private readonly real: RedisClient;

  constructor(
    real: RedisClient,
    scheduler: SeededFaultScheduler,
    delay?: DelayFn
  ) {
    super(scheduler, "redis", delay);
    this.real = real;
  }

  async ping(): Promise<string> {
    return this.call(() => this.real.ping(), { op: "ping" });
  }

  async get(key: string): Promise<string | null> {
    return this.call(() => this.real.get(key), { op: "get", key });
  }

  async set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean }
  ): Promise<string | null> {
    return this.call(() => this.real.set(key, value, options), {
      op: "set",
      key,
    });
  }

  async del(key: string): Promise<number> {
    return this.call(() => this.real.del(key), { op: "del", key });
  }

  async eval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<unknown> {
    return this.call(() => this.real.eval(script, numKeys, ...args), {
      op: "eval",
    });
  }
}

// ─── Horizon proxy ───────────────────────────────────────────────────────────

export interface HorizonLedgerPage {
  records: Array<{ sequence: number; closed_at: string }>;
}

export interface HorizonTransactionResult {
  id: string;
  hash: string;
  ledger: number;
  successful: boolean;
}

export interface HorizonAccountDetails {
  id: string;
  sequence: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    balance: string;
  }>;
}

/** Minimal Stellar Horizon API surface used by production code. */
export interface HorizonClient {
  getLedgers(limit?: number): Promise<HorizonLedgerPage>;
  getTransaction(hash: string): Promise<HorizonTransactionResult>;
  getAccountDetails(address: string): Promise<HorizonAccountDetails>;
  submitTransaction(xdr: string): Promise<HorizonTransactionResult>;
}

/** Fault-injectable wrapper for the Horizon REST API. */
export class HorizonProxy extends BaseProxy implements HorizonClient {
  private readonly real: HorizonClient;

  constructor(
    real: HorizonClient,
    scheduler: SeededFaultScheduler,
    delay?: DelayFn
  ) {
    super(scheduler, "horizon", delay);
    this.real = real;
  }

  async getLedgers(limit = 1): Promise<HorizonLedgerPage> {
    return this.call(() => this.real.getLedgers(limit), {
      op: "getLedgers",
      limit,
    });
  }

  async getTransaction(hash: string): Promise<HorizonTransactionResult> {
    return this.call(() => this.real.getTransaction(hash), {
      op: "getTransaction",
      hash,
    });
  }

  async getAccountDetails(address: string): Promise<HorizonAccountDetails> {
    return this.call(() => this.real.getAccountDetails(address), {
      op: "getAccountDetails",
      address,
    });
  }

  async submitTransaction(xdr: string): Promise<HorizonTransactionResult> {
    return this.call(() => this.real.submitTransaction(xdr), {
      op: "submitTransaction",
    });
  }
}

// ─── Soroban RPC proxy ───────────────────────────────────────────────────────

export interface SorobanLedgerInfo {
  sequence: number;
  protocolVersion: number;
}

export interface SorobanSimulateResult {
  transactionData: string;
  minResourceFee: string;
  results?: Array<{ xdr: string }>;
  error?: string;
}

export interface SorobanSendResult {
  hash: string;
  status: string;
  errorResult?: string;
}

export interface SorobanGetTransactionResult {
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  ledger?: number;
  resultXdr?: string;
}

/** Minimal Soroban RPC surface. */
export interface SorobanRpcClient {
  getLatestLedger(): Promise<SorobanLedgerInfo>;
  simulateTransaction(xdr: string): Promise<SorobanSimulateResult>;
  sendTransaction(xdr: string): Promise<SorobanSendResult>;
  getTransaction(hash: string): Promise<SorobanGetTransactionResult>;
}

/** Fault-injectable wrapper for the Soroban JSON-RPC endpoint. */
export class SorobanRpcProxy extends BaseProxy implements SorobanRpcClient {
  private readonly real: SorobanRpcClient;

  constructor(
    real: SorobanRpcClient,
    scheduler: SeededFaultScheduler,
    delay?: DelayFn
  ) {
    super(scheduler, "sorobanRpc", delay);
    this.real = real;
  }

  async getLatestLedger(): Promise<SorobanLedgerInfo> {
    return this.call(() => this.real.getLatestLedger(), {
      op: "getLatestLedger",
    });
  }

  async simulateTransaction(xdr: string): Promise<SorobanSimulateResult> {
    return this.call(() => this.real.simulateTransaction(xdr), {
      op: "simulateTransaction",
    });
  }

  async sendTransaction(xdr: string): Promise<SorobanSendResult> {
    return this.call(() => this.real.sendTransaction(xdr), {
      op: "sendTransaction",
    });
  }

  async getTransaction(hash: string): Promise<SorobanGetTransactionResult> {
    return this.call(() => this.real.getTransaction(hash), {
      op: "getTransaction",
      hash,
    });
  }
}

// ─── LLM proxy ───────────────────────────────────────────────────────────────

export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LlmCompletionResult {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string;
}

/** Minimal Anthropic / LLM surface used by production agents. */
export interface LlmClient {
  complete(
    messages: LlmMessage[],
    options?: { maxTokens?: number; system?: string }
  ): Promise<LlmCompletionResult>;
}

/** Fault-injectable wrapper for the LLM inference endpoint. */
export class LlmProxy extends BaseProxy implements LlmClient {
  private readonly real: LlmClient;

  constructor(
    real: LlmClient,
    scheduler: SeededFaultScheduler,
    delay?: DelayFn
  ) {
    super(scheduler, "llm", delay);
    this.real = real;
  }

  async complete(
    messages: LlmMessage[],
    options?: { maxTokens?: number; system?: string }
  ): Promise<LlmCompletionResult> {
    return this.call(
      () => this.real.complete(messages, options),
      { op: "complete", messageCount: messages.length }
    );
  }
}

// ─── Factory function ────────────────────────────────────────────────────────

/**
 * Convenience factory that creates all five proxies in one call.
 *
 * @example
 * ```ts
 * const { db, redis, horizon, soroban, llm } = createFaultProxies(
 *   scheduler,
 *   { db: realDb, redis: realRedis, horizon: realHorizon,
 *     soroban: realSoroban, llm: realLlm },
 * );
 * ```
 */
export function createFaultProxies(
  scheduler: SeededFaultScheduler,
  backing: {
    db: DatabaseClient;
    redis: RedisClient;
    horizon: HorizonClient;
    soroban: SorobanRpcClient;
    llm: LlmClient;
  },
  delay?: DelayFn
): {
  db: DatabaseProxy;
  redis: RedisProxy;
  horizon: HorizonProxy;
  soroban: SorobanRpcProxy;
  llm: LlmProxy;
} {
  return {
    db: new DatabaseProxy(backing.db, scheduler, delay),
    redis: new RedisProxy(backing.redis, scheduler, delay),
    horizon: new HorizonProxy(backing.horizon, scheduler, delay),
    soroban: new SorobanRpcProxy(backing.soroban, scheduler, delay),
    llm: new LlmProxy(backing.llm, scheduler, delay),
  };
}
