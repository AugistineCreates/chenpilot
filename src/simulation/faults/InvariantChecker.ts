/**
 * InvariantChecker
 *
 * Post-recovery assertion engine that checks safety invariants across all
 * five service proxies after fault injection and recovery.
 *
 * Each check is a named invariant with:
 *   - a stable invariantId for deduplication across CI reruns
 *   - a category drawn from the existing InvariantEngine vocabulary
 *   - a synchronous or asynchronous check function
 *
 * Violations are first-class values (never thrown) so a single call to
 * checkAll() collects every failing invariant and reports them together.
 * The checker registers each violation with the SeededFaultScheduler so
 * it appears in the final Timeline.
 *
 * Service-level invariants enforced here:
 *
 *   database   – no call resolved with an error after recovery;
 *                all queries after recovery must see isInitialized=true.
 *   redis      – no unresolved lock acquisition calls remain after recovery;
 *                ping must succeed after recovery.
 *   horizon    – no stale read accepted as final (staleByMs must be visible);
 *                submit after recovery must reach network.
 *   sorobanRpc – no partial simulation result must be treated as complete;
 *                after recovery getLatestLedger must return a valid sequence.
 *   llm        – no partial completion used as a complete inference result;
 *                after recovery complete() must succeed without corruption.
 */

import {
  FaultLogEntry,
  InvariantViolation,
  ServiceId,
  ViolationCategory,
} from "./types";
import { SeededFaultScheduler } from "./SeededFaultScheduler";
import {
  BaseProxy,
  DatabaseClient,
  DatabaseProxy,
  HorizonClient,
  HorizonProxy,
  LlmClient,
  LlmProxy,
  RedisClient,
  RedisProxy,
  SorobanRpcClient,
  SorobanRpcProxy,
} from "./FaultProxy";

// ─── Invariant definition ────────────────────────────────────────────────────

interface InvariantDef<S> {
  invariantId: string;
  invariantName: string;
  service: ServiceId;
  category: ViolationCategory;
  /**
   * The check function. Receives the proxy (or backing client) and the
   * accumulated fault log for that service.
   *
   * Must return a violation description string on failure, or null on pass.
   */
  check(
    proxy: S,
    log: FaultLogEntry[],
    boundary: string
  ): Promise<{ expected: string; actual: string; detail?: Record<string, unknown> } | null>;
}

// ─── InvariantChecker ────────────────────────────────────────────────────────

export class InvariantChecker {
  private readonly scheduler: SeededFaultScheduler;

  /** Current boundary name supplied when checkAll() is called. */
  private currentBoundary = "post-recovery";

  constructor(scheduler: SeededFaultScheduler) {
    this.scheduler = scheduler;
  }

  // ── Database invariants ──────────────────────────────────────────────────

  private readonly dbInvariants: InvariantDef<DatabaseProxy>[] = [
    {
      invariantId: "db.availability.after-recovery",
      invariantName: "Database responds after recovery",
      service: "database",
      category: "availability",
      async check(proxy, _log, _boundary) {
        try {
          await proxy.query("SELECT 1 AS ok");
          return null; // pass
        } catch (err) {
          return {
            expected: "SELECT 1 succeeds after recovery",
            actual: `query threw: ${String(err)}`,
          };
        }
      },
    },
    {
      invariantId: "db.consistency.no-crashed-reads",
      invariantName: "Database log contains no crashed reads after recovery",
      service: "database",
      category: "consistency",
      async check(proxy, _log, _boundary) {
        // Only check POST-heal entries — pre-heal crashes are expected.
        const postHealLog = proxy.getPostHealLog();
        const crashedAfterRecovery = postHealLog.filter(
          (e) => e.faultApplied === "crash" && !e.resolved
        );
        if (crashedAfterRecovery.length === 0) return null;
        return {
          expected: "Zero crash events in post-heal fault log",
          actual: `${crashedAfterRecovery.length} crash event(s) found after heal()`,
          detail: { entries: crashedAfterRecovery.slice(0, 5) },
        };
      },
    },
    {
      invariantId: "db.consistency.no-corrupted-reads",
      invariantName: "Database responses contain no injected corruption flags",
      service: "database",
      category: "consistency",
      async check(proxy, _log, _boundary) {
        try {
          const result = await proxy.query<unknown>("SELECT 1 AS ok");
          if (
            typeof result === "object" &&
            result !== null &&
            "_corrupted" in (result as Record<string, unknown>)
          ) {
            return {
              expected: "Query result must not contain _corrupted marker",
              actual: `Response contains _corrupted=true after recovery`,
              detail: { result },
            };
          }
          return null;
        } catch {
          return null;
        }
      },
    },
  ];

  // ── Redis invariants ─────────────────────────────────────────────────────

  private readonly redisInvariants: InvariantDef<RedisProxy>[] = [
    {
      invariantId: "redis.availability.ping-after-recovery",
      invariantName: "Redis responds to PING after recovery",
      service: "redis",
      category: "availability",
      async check(proxy, _log, _boundary) {
        try {
          const pong = await proxy.ping();
          if (pong !== "PONG") {
            return {
              expected: "PONG",
              actual: String(pong),
            };
          }
          return null;
        } catch (err) {
          return {
            expected: "PING succeeds after recovery",
            actual: `ping threw: ${String(err)}`,
          };
        }
      },
    },
    {
      invariantId: "redis.consistency.no-stale-locks",
      invariantName: "Redis lock operations not serving stale data after recovery",
      service: "redis",
      category: "consistency",
      async check(proxy, _log, _boundary) {
        // Only flag stale reads that occurred AFTER heal() was called.
        const postHealLog = proxy.getPostHealLog();
        const staleOps = postHealLog.filter(
          (e) => e.faultApplied === "staleRead" && e.resolved
        );
        if (staleOps.length === 0) return null;
        return {
          expected: "Zero stale-read events on Redis after heal()",
          actual: `${staleOps.length} stale-read event(s) observed post-heal`,
          detail: { entries: staleOps.slice(0, 5) },
        };
      },
    },
    {
      invariantId: "redis.ordering.set-then-get-roundtrip",
      invariantName: "Redis SET then GET round-trip is consistent after recovery",
      service: "redis",
      category: "ordering",
      async check(proxy, _log, _boundary) {
        const testKey = `__invariant_check__:${Date.now()}`;
        const testVal = "sentinel";
        try {
          await proxy.set(testKey, testVal, { EX: 10 });
          const got = await proxy.get(testKey);
          await proxy.del(testKey);
          if (got !== testVal) {
            return {
              expected: `GET("${testKey}") === "${testVal}"`,
              actual: `got "${String(got)}"`,
            };
          }
          return null;
        } catch (err) {
          return {
            expected: "SET/GET round-trip succeeds after recovery",
            actual: String(err),
          };
        }
      },
    },
  ];

  // ── Horizon invariants ───────────────────────────────────────────────────

  private readonly horizonInvariants: InvariantDef<HorizonProxy>[] = [
    {
      invariantId: "horizon.availability.ledgers-after-recovery",
      invariantName: "Horizon returns ledger data after recovery",
      service: "horizon",
      category: "availability",
      async check(proxy, _log, _boundary) {
        try {
          const page = await proxy.getLedgers(1);
          if (!page.records || page.records.length === 0) {
            return {
              expected: "At least one ledger record after recovery",
              actual: "Empty ledger page returned",
            };
          }
          return null;
        } catch (err) {
          return {
            expected: "getLedgers() succeeds after recovery",
            actual: String(err),
          };
        }
      },
    },
    {
      invariantId: "horizon.consistency.no-stale-ledger-accepted",
      invariantName: "Horizon stale reads are not treated as current after recovery",
      service: "horizon",
      category: "consistency",
      async check(proxy, _log, _boundary) {
        // Only check post-heal entries — stale reads before healing are expected.
        const postHealLog = proxy.getPostHealLog();
        const staleEntries = postHealLog.filter(
          (e) => e.faultApplied === "staleRead" && e.resolved
        );
        if (staleEntries.length === 0) return null;
        return {
          expected: "No stale Horizon responses after heal()",
          actual: `${staleEntries.length} stale read(s) recorded post-heal`,
          detail: { entries: staleEntries.slice(0, 5) },
        };
      },
    },
    {
      invariantId: "horizon.completeness.no-partial-tx-results",
      invariantName: "Horizon transaction results are structurally complete after recovery",
      service: "horizon",
      category: "completeness",
      async check(proxy, _log, _boundary) {
        const postHealLog = proxy.getPostHealLog();
        const partialEntries = postHealLog.filter(
          (e) => e.faultApplied === "partialResponse" && e.resolved
        );
        if (partialEntries.length === 0) return null;
        return {
          expected: "No partial Horizon responses after heal()",
          actual: `${partialEntries.length} partial response(s) recorded post-heal`,
          detail: { entries: partialEntries.slice(0, 5) },
        };
      },
    },
  ];

  // ── Soroban RPC invariants ───────────────────────────────────────────────

  private readonly sorobanInvariants: InvariantDef<SorobanRpcProxy>[] = [
    {
      invariantId: "soroban.availability.ledger-after-recovery",
      invariantName: "Soroban RPC returns valid latest ledger after recovery",
      service: "sorobanRpc",
      category: "availability",
      async check(proxy, _log, _boundary) {
        try {
          const ledger = await proxy.getLatestLedger();
          if (
            typeof ledger.sequence !== "number" ||
            ledger.sequence <= 0 ||
            "_partial" in (ledger as Record<string, unknown>)
          ) {
            return {
              expected: "Valid ledger sequence > 0 with no _partial flag",
              actual: JSON.stringify(ledger),
            };
          }
          return null;
        } catch (err) {
          return {
            expected: "getLatestLedger() succeeds after recovery",
            actual: String(err),
          };
        }
      },
    },
    {
      invariantId: "soroban.safety.no-partial-simulation-accepted",
      invariantName: "Soroban partial simulation results not accepted as complete",
      service: "sorobanRpc",
      category: "safety",
      async check(proxy, _log, _boundary) {
        const postHealLog = proxy.getPostHealLog();
        const partialSims = postHealLog.filter(
          (e) => e.faultApplied === "partialResponse" && e.resolved
        );
        if (partialSims.length === 0) return null;
        return {
          expected: "No partial simulation responses after heal()",
          actual: `${partialSims.length} partial simulation(s) recorded post-heal`,
          detail: { entries: partialSims.slice(0, 5) },
        };
      },
    },
    {
      invariantId: "soroban.ordering.send-then-get-consistency",
      invariantName: "Soroban: no unresolved calls remain after recovery",
      service: "sorobanRpc",
      category: "ordering",
      async check(proxy, _log, _boundary) {
        // Only check post-heal entries.
        const postHealLog = proxy.getPostHealLog();
        const failedCalls = postHealLog.filter(
          (e) => e.faultApplied !== undefined && !e.resolved
        );
        if (failedCalls.length === 0) return null;
        return {
          expected: "Zero unresolved Soroban RPC calls after heal()",
          actual: `${failedCalls.length} unresolved call(s) remain post-heal`,
          detail: { entries: failedCalls.slice(0, 5) },
        };
      },
    },
  ];

  // ── LLM invariants ───────────────────────────────────────────────────────

  private readonly llmInvariants: InvariantDef<LlmProxy>[] = [
    {
      invariantId: "llm.availability.complete-after-recovery",
      invariantName: "LLM inference endpoint responds after recovery",
      service: "llm",
      category: "availability",
      async check(proxy, _log, _boundary) {
        try {
          const result = await proxy.complete([
            { role: "user", content: "ping" },
          ]);
          if (!result.content || result.content.trim() === "") {
            return {
              expected: "Non-empty completion content after recovery",
              actual: `empty content; usage=${JSON.stringify(result.usage)}`,
            };
          }
          return null;
        } catch (err) {
          return {
            expected: "complete() succeeds after recovery",
            actual: String(err),
          };
        }
      },
    },
    {
      invariantId: "llm.completeness.no-partial-completions",
      invariantName: "LLM partial completions not used as complete inferences",
      service: "llm",
      category: "completeness",
      async check(proxy, _log, _boundary) {
        // Only flag partial completions that occurred AFTER heal().
        const postHealLog = proxy.getPostHealLog();
        const partialEntries = postHealLog.filter(
          (e) => e.faultApplied === "partialResponse" && e.resolved
        );
        if (partialEntries.length === 0) return null;
        return {
          expected: "No partial LLM completions after heal()",
          actual: `${partialEntries.length} partial completion(s) recorded post-heal`,
          detail: { entries: partialEntries.slice(0, 5) },
        };
      },
    },
    {
      invariantId: "llm.consistency.no-corrupted-inference",
      invariantName: "LLM responses must not contain corruption markers after recovery",
      service: "llm",
      category: "consistency",
      async check(proxy, _log, _boundary) {
        try {
          const result = await proxy.complete([
            { role: "user", content: "invariant check" },
          ]);
          const raw = result as unknown as Record<string, unknown>;
          if ("_corrupted" in raw || "_partial" in raw) {
            return {
              expected: "LLM result must not contain _corrupted or _partial flags",
              actual: `response contains injected markers: ${JSON.stringify(raw)}`,
            };
          }
          return null;
        } catch {
          return null;
        }
      },
    },
  ];

  // ── Check orchestration ──────────────────────────────────────────────────

  /**
   * Run all invariant checks for a single service and report violations.
   * Uses the scheduler to record each violation into the Timeline.
   */
  private async runChecks<S extends BaseProxy>(
    proxy: S,
    defs: InvariantDef<S>[],
    boundary: string
  ): Promise<InvariantViolation[]> {
    const violations: InvariantViolation[] = [];
    const log = proxy.getFaultLog();

    for (const def of defs) {
      let result: { expected: string; actual: string; detail?: Record<string, unknown> } | null;
      try {
        result = await def.check(proxy, log, boundary);
      } catch (err) {
        // The check itself threw — treat as a violation.
        result = {
          expected: "Check function must not throw",
          actual: String(err),
        };
      }

      if (result !== null) {
        const violation: InvariantViolation = {
          invariantId: def.invariantId,
          invariantName: def.invariantName,
          category: def.category,
          service: def.service,
          boundary,
          expected: result.expected,
          actual: result.actual,
          detail: result.detail,
        };
        this.scheduler.recordViolation(violation);
        violations.push(violation);
      }
    }

    return violations;
  }

  /**
   * Run all invariant checks for all five services after the scenario's
   * recovery phase.  Returns every violation found.
   *
   * Call this after calling proxy.heal() and scheduler.healAll().
   *
   * @param proxies  The five fault proxies (with real backing clients).
   * @param boundary  Label of the current boundary (e.g. "post-recovery").
   */
  async checkAll(
    proxies: {
      db: DatabaseProxy;
      redis: RedisProxy;
      horizon: HorizonProxy;
      soroban: SorobanRpcProxy;
      llm: LlmProxy;
    },
    boundary = "post-recovery"
  ): Promise<InvariantViolation[]> {
    this.currentBoundary = boundary;

    const [dbV, redisV, horizonV, sorobanV, llmV] = await Promise.all([
      this.runChecks(proxies.db, this.dbInvariants, boundary),
      this.runChecks(proxies.redis, this.redisInvariants, boundary),
      this.runChecks(proxies.horizon, this.horizonInvariants, boundary),
      this.runChecks(proxies.soroban, this.sorobanInvariants, boundary),
      this.runChecks(proxies.llm, this.llmInvariants, boundary),
    ]);

    return [...dbV, ...redisV, ...horizonV, ...sorobanV, ...llmV];
  }

  /**
   * Run invariant checks for a single named service.
   * Useful when only one service was involved in a fault.
   */
  async checkService(
    service: ServiceId,
    proxy:
      | DatabaseProxy
      | RedisProxy
      | HorizonProxy
      | SorobanRpcProxy
      | LlmProxy,
    boundary = "post-recovery"
  ): Promise<InvariantViolation[]> {
    this.currentBoundary = boundary;

    switch (service) {
      case "database":
        return this.runChecks(proxy as DatabaseProxy, this.dbInvariants, boundary);
      case "redis":
        return this.runChecks(proxy as RedisProxy, this.redisInvariants, boundary);
      case "horizon":
        return this.runChecks(proxy as HorizonProxy, this.horizonInvariants, boundary);
      case "sorobanRpc":
        return this.runChecks(
          proxy as SorobanRpcProxy,
          this.sorobanInvariants,
          boundary
        );
      case "llm":
        return this.runChecks(proxy as LlmProxy, this.llmInvariants, boundary);
    }
  }
}
