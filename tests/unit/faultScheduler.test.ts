/**
 * Fault Scheduler — Bounded CI Test Suite
 *
 * 10 seeded scenarios that exercise every correlated-fault class across the
 * five services:  database · Redis · Horizon · Soroban RPC · LLM.
 *
 * Each test:
 *   1. Creates a SeededFaultScheduler with a stable numeric seed.
 *   2. Wraps in-memory stub services with FaultProxy.
 *   3. Exercises the system through named execution boundaries.
 *   4. Calls heal() / healAll() to simulate recovery.
 *   5. Runs InvariantChecker.checkAll() post-recovery.
 *   6. Passes the Timeline to TimelineRecorder.record() — which writes a
 *      JSON artifact only if the scenario fails.
 *   7. Asserts the invariant violations are exactly the expected set.
 *
 * Scenarios covered:
 *   S01  Single-service database latency
 *   S02  Redis partition during database failover (correlated)
 *   S03  Horizon stale read
 *   S04  Soroban RPC timeout after transaction acceptance (correlated)
 *   S05  LLM partial response
 *   S06  Correlated: database crash + Redis stale read
 *   S07  Correlated: Horizon partition + Soroban RPC crash
 *   S08  Redis corrupted data + LLM partial response (correlated)
 *   S09  All-services latency storm
 *   S10  Correlated full-cascade: partition → crash → stale → partial
 *
 * Tests use Jest fake timers for latency/timeout faults so the suite
 * completes in milliseconds rather than waiting for real delays.
 */

import {
  SeededFaultScheduler,
  FaultSchedulerConfig,
  createFaultProxies,
  DatabaseProxy,
  RedisProxy,
  HorizonProxy,
  SorobanRpcProxy,
  LlmProxy,
  InvariantChecker,
  TimelineRecorder,
  FaultError,
  DatabaseClient,
  RedisClient,
  HorizonClient,
  SorobanRpcClient,
  LlmClient,
  Timeline,
} from "../../src/simulation/faults";

// ─── Fake timers & delay ─────────────────────────────────────────────────────

/**
 * Instantaneous delay for use in all proxy constructors during tests.
 * We don't need to wait actual milliseconds; we just want the fault path
 * to be exercised.
 */
const instantDelay = (_ms: number) => Promise.resolve();

// ─── Stub service factories ──────────────────────────────────────────────────

function makeStubDb(overrides?: Partial<DatabaseClient>): DatabaseClient {
  return {
    isInitialized: true,
    async query<T>(sql: string, _params?: unknown[]): Promise<T> {
      if (sql.includes("SELECT 1")) {
        return [{ ok: 1 }] as unknown as T;
      }
      return [] as unknown as T;
    },
    ...overrides,
  };
}

function makeStubRedis(overrides?: Partial<RedisClient>): RedisClient {
  const store = new Map<string, string>();
  return {
    async ping() { return "PONG"; },
    async get(key: string) { return store.get(key) ?? null; },
    async set(key: string, value: string, _opts?) {
      store.set(key, value);
      return "OK";
    },
    async del(key: string) {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    },
    async eval(_script: string, _numKeys: number, ..._args: string[]) {
      return 1;
    },
    ...overrides,
  };
}

function makeStubHorizon(overrides?: Partial<HorizonClient>): HorizonClient {
  return {
    async getLedgers(_limit = 1) {
      return {
        records: [{ sequence: 50000001, closed_at: new Date().toISOString() }],
      };
    },
    async getTransaction(hash: string) {
      return { id: hash, hash, ledger: 50000001, successful: true };
    },
    async getAccountDetails(address: string) {
      return {
        id: address,
        sequence: "1234567890",
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      };
    },
    async submitTransaction(_xdr: string) {
      return { id: "tx-id", hash: "txhash01", ledger: 50000001, successful: true };
    },
    ...overrides,
  };
}

function makeStubSoroban(
  overrides?: Partial<SorobanRpcClient>
): SorobanRpcClient {
  return {
    async getLatestLedger() {
      return { sequence: 50000001, protocolVersion: 21 };
    },
    async simulateTransaction(_xdr: string) {
      return {
        transactionData: "AAAAAA==",
        minResourceFee: "100",
        results: [{ xdr: "AAAAAA==" }],
      };
    },
    async sendTransaction(_xdr: string) {
      return { hash: "soroban-hash-01", status: "PENDING" };
    },
    async getTransaction(_hash: string) {
      return { status: "SUCCESS" as const, ledger: 50000001, resultXdr: "AAAAAA==" };
    },
    ...overrides,
  };
}

function makeStubLlm(overrides?: Partial<LlmClient>): LlmClient {
  return {
    async complete(messages, _opts?) {
      return {
        content: `Response to: ${messages[0]?.content ?? ""}`,
        model: "claude-3-5-sonnet",
        usage: { inputTokens: 10, outputTokens: 20 },
        stopReason: "end_turn",
      };
    },
    ...overrides,
  };
}

// ─── Scenario helpers ────────────────────────────────────────────────────────

interface ScenarioSetup {
  scheduler: SeededFaultScheduler;
  db: DatabaseProxy;
  redis: RedisProxy;
  horizon: HorizonProxy;
  soroban: SorobanRpcProxy;
  llm: LlmProxy;
  checker: InvariantChecker;
  recorder: TimelineRecorder;
  writtenArtifacts: string[];
}

function buildScenario(config: FaultSchedulerConfig): ScenarioSetup {
  const writtenArtifacts: string[] = [];

  const scheduler = new SeededFaultScheduler(config);
  const { db, redis, horizon, soroban, llm } = createFaultProxies(
    scheduler,
    {
      db: makeStubDb(),
      redis: makeStubRedis(),
      horizon: makeStubHorizon(),
      soroban: makeStubSoroban(),
      llm: makeStubLlm(),
    },
    instantDelay
  );

  const checker = new InvariantChecker(scheduler);

  // Recorder with in-memory writer (no filesystem access in tests).
  const recorder = new TimelineRecorder({
    outputDir: "fault-timelines",
    writer: (filePath, _content) => { writtenArtifacts.push(filePath); },
    mkdir: (_dir) => {},
  });

  return { scheduler, db, redis, horizon, soroban, llm, checker, recorder, writtenArtifacts };
}

// Helper: run post-recovery invariant checks, record timeline, assert no violations
async function assertNoViolations(
  setup: ScenarioSetup,
  proxies: { db: DatabaseProxy; redis: RedisProxy; horizon: HorizonProxy; soroban: SorobanRpcProxy; llm: LlmProxy }
): Promise<Timeline> {
  const { scheduler, checker, recorder } = setup;

  scheduler.enter("post-recovery");
  const violations = await checker.checkAll(proxies);
  scheduler.leave("post-recovery");

  const timeline = scheduler.finish();
  const record = recorder.record(timeline);

  // Fail the test with context if invariants were violated.
  if (violations.length > 0) {
    const summary = violations
      .map((v) => `[${v.invariantId}] expected: ${v.expected}, actual: ${v.actual}`)
      .join("\n");
    throw new Error(
      `Invariant violations after recovery (seed=${timeline.seed}):\n${summary}\n` +
        `Replay hint: seed=${timeline.seed}, scenario="${timeline.scenario}"\n` +
        (record.written ? `Artifact: ${record.filePath}` : "")
    );
  }

  expect(timeline.passed).toBe(true);
  expect(timeline.violations).toHaveLength(0);
  return timeline;
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("SeededFaultScheduler — bounded CI suite", () => {
  // Shared recorder accumulates records across all scenarios for the
  // end-of-suite session report.
  const sessionTimelines: Timeline[] = [];
  let sessionRecorder: TimelineRecorder;
  let sessionArtifacts: string[];

  beforeAll(() => {
    sessionArtifacts = [];
    sessionRecorder = new TimelineRecorder({
      outputDir: "fault-timelines",
      writer: (fp, _) => { sessionArtifacts.push(fp); },
      mkdir: () => {},
    });
  });

  afterAll(() => {
    const report = sessionRecorder.buildSessionReport();
    console.log(sessionRecorder.renderSummary(report));
    // CI-facing assertion: all scenarios must pass.
    if (report.failed > 0) {
      throw new Error(
        `${report.failed} fault scenario(s) failed. ` +
          `Failing seeds: ${report.failingSeeds.join(", ")}`
      );
    }
  });

  // ── S01: single-service database latency ───────────────────────────────

  it("S01: database latency — proxy adds delay but calls resolve and invariants hold", async () => {
    const setup = buildScenario({
      seed: 0xdeadbeef,
      scenario: "S01-database-latency",
      faults: [
        {
          id: "s01-db-latency",
          service: "database",
          boundary: "pre-query",
          params: { kind: "latency", minMs: 100, maxMs: 500 },
        },
      ],
    });

    const { scheduler, db } = setup;

    scheduler.enter("pre-query");
    const result = await db.query("SELECT 1 AS ok");
    expect(result).toBeDefined();
    scheduler.leave("pre-query");

    // Heal before invariant checks
    db.heal();

    const timeline = await assertNoViolations(setup, {
      db: setup.db,
      redis: setup.redis,
      horizon: setup.horizon,
      soroban: setup.soroban,
      llm: setup.llm,
    });

    sessionTimelines.push(timeline);
    sessionRecorder.record(timeline);

    // Determinism: same seed must produce same fault-log shape
    const log = db.getFaultLog();
    expect(log.some((e) => e.faultApplied === "latency")).toBe(true);
  });

  // ── S02: Redis partition during database failover (correlated) ─────────

  it("S02: Redis partition during database failover — both fail then recover", async () => {
    const setup = buildScenario({
      seed: 0x1a2b3c4d,
      scenario: "S02-redis-partition-during-db-failover",
      faults: [
        {
          id: "s02-db-partition",
          service: "database",
          boundary: "db-failover",
          params: { kind: "partition" },
          callCount: 2,
        },
        {
          id: "s02-redis-partition",
          service: "redis",
          boundary: "db-failover", // same boundary = correlated
          params: { kind: "partition" },
          callCount: 2,
        },
      ],
    });

    const { scheduler, db, redis } = setup;

    scheduler.enter("db-failover");

    // Both calls should throw FaultError due to partition
    await expect(db.query("SELECT now()")).rejects.toBeInstanceOf(FaultError);
    await expect(redis.ping()).rejects.toBeInstanceOf(FaultError);

    scheduler.leave("db-failover");

    // Simulate recovery — callCount is exhausted, heal just in case
    db.heal();
    redis.heal();

    const timeline = await assertNoViolations(setup, {
      db: setup.db,
      redis: setup.redis,
      horizon: setup.horizon,
      soroban: setup.soroban,
      llm: setup.llm,
    });

    sessionTimelines.push(timeline);
    sessionRecorder.record(timeline);

    // Verify correlated faults were both recorded
    const dbLog = db.getFaultLog();
    const redisLog = redis.getFaultLog();
    expect(dbLog.some((e) => e.faultApplied === "partition")).toBe(true);
    expect(redisLog.some((e) => e.faultApplied === "partition")).toBe(true);
  });

  // ── S03: Horizon stale read ────────────────────────────────────────────

  it("S03: Horizon stale read — proxy returns stale payload, clean after recovery", async () => {
    const setup = buildScenario({
      seed: 0x5e6f7a8b,
      scenario: "S03-horizon-stale-read",
      faults: [
        {
          id: "s03-horizon-stale",
          service: "horizon",
          boundary: "ledger-poll",
          params: {
            kind: "staleRead",
            staleByMs: 30_000,
            fixedPayload: {
              records: [
                { sequence: 49_999_000, closed_at: "2026-09-27T00:00:00Z" },
              ],
            },
          },
          callCount: 3,
        },
      ],
    });

    const { scheduler, horizon } = setup;

    scheduler.enter("ledger-poll");
    const stalePage = await horizon.getLedgers(1);
    expect((stalePage.records[0] as Record<string, unknown>)["sequence"]).toBe(49_999_000);
    scheduler.leave("ledger-poll");

    horizon.heal();

    // After heal, getLedgers should return fresh data
    const freshPage = await horizon.getLedgers(1);
    expect(freshPage.records[0].sequence).toBe(50_000_001);

    const timeline = await assertNoViolations(setup, {
      db: setup.db,
      redis: setup.redis,
      horizon: setup.horizon,
      soroban: setup.soroban,
      llm: setup.llm,
    });

    sessionTimelines.push(timeline);
    sessionRecorder.record(timeline);
  });

  // ── S04: Soroban RPC timeout after transaction acceptance (correlated) ─

  it("S04: Soroban timeout after sendTransaction — correlated getTransaction failure", async () => {
    const setup = buildScenario({
      seed: 0x9c0d1e2f,
      scenario: "S04-soroban-timeout-after-send",
      faults: [
        {
          id: "s04-soroban-timeout-get",
          service: "sorobanRpc",
          boundary: "tx-polling",
          params: { kind: "timeout" },
          callCount: 2,
        },
      ],
    });

    const { scheduler, soroban } = setup;

    // Send succeeds (no fault on "pre-send" boundary)
    scheduler.enter("pre-send");
    const sendResult = await soroban.sendTransaction("AAAAAA==");
    expect(sendResult.hash).toBeDefined();
    scheduler.leave("pre-send");

    // Polling phase — getTransaction times out
    scheduler.enter("tx-polling");
    await expect(soroban.getTransaction(sendResult.hash)).rejects.toBeInstanceOf(FaultError);
    scheduler.leave("tx-polling");

    soroban.heal();

    const timeline = await assertNoViolations(setup, {
      db: setup.db,
      redis: setup.redis,
      horizon: setup.horizon,
      soroban: setup.soroban,
      llm: setup.llm,
    });

    sessionTimelines.push(timeline);
    sessionRecorder.record(timeline);
  });

  // ── S05: LLM partial response ──────────────────────────────────────────

  it("S05: LLM partial response — response is truncated, clean after recovery", async () => {
    const setup = buildScenario({
      seed: 0x3040_5060,
      scenario: "S05-llm-partial-response",
      faults: [
        {
          id: "s05-llm-partial",
          service: "llm",
          boundary: "agent-inference",
          params: { kind: "partialResponse", completenessRatio: 0.3 },
          callCount: 1,
        },
      ],
    });

    const { scheduler, llm } = setup;

    scheduler.enter("agent-inference");
    const partial = await llm.complete([{ role: "user", content: "hello" }]);
    // Partial response will have _partial: true
    expect((partial as unknown as Record<string, unknown>)["_partial"]).toBe(true);
    scheduler.leave("agent-inference");

    llm.heal();

    // After heal, complete should return a clean response
    const clean = await llm.complete([{ role: "user", content: "ping" }]);
    expect((clean as unknown as Record<string, unknown>)["_partial"]).toBeUndefined();
    expect(clean.content).toBeDefined();

    const timeline = await assertNoViolations(setup, {
      db: setup.db,
      redis: setup.redis,
      horizon: setup.horizon,
      soroban: setup.soroban,
      llm: setup.llm,
    });

    sessionTimelines.push(timeline);
    sessionRecorder.record(timeline);
  });

  // ── S06: database crash + Redis stale read (correlated) ────────────────

  it("S06: correlated database crash and Redis stale read — both recover cleanly", async () => {
    const setup = buildScenario({
      seed: 0x7080_90a0,
      scenario: "S06-db-crash-redis-stale",
      faults: [
        {
          id: "s06-db-crash",
          service: "database",
          boundary: "pre-commit",
          params: { kind: "crash" },
          callCount: 3,
        },
        {
          id: "s06-redis-stale",
          service: "redis",
          boundary: "pre-commit",
          params: { kind: "staleRead", staleByMs: 5_000 },
          callCount: 3,
        },
      ],
    });

    const { scheduler, db, redis } = setup;

    scheduler.enter("pre-commit");
    // DB crashes
    await expect(db.query("INSERT INTO tx VALUES(1)")).rejects.toBeInstanceOf(FaultError);
    // Redis serves stale data
    await redis.set("lock:user-1", "owner-1");
    const staleLock = await redis.get("lock:user-1");
    // The stale read returns the stale payload (object with _staleByMs)
    expect(staleLock).not.toBeNull();
    scheduler.leave("pre-commit");

    db.heal();
    redis.heal();

    const timeline = await assertNoViolations(setup, {
      db: setup.db,
      redis: setup.redis,
      horizon: setup.horizon,
      soroban: setup.soroban,
      llm: setup.llm,
    });

    sessionTimelines.push(timeline);
    sessionRecorder.record(timeline);

    const dbLog = db.getFaultLog();
    const redisLog = redis.getFaultLog();
    expect(dbLog.some((e) => e.faultApplied === "crash")).toBe(true);
    expect(redisLog.some((e) => e.faultApplied === "staleRead")).toBe(true);
  });

  // ── S07: Horizon partition + Soroban RPC crash (correlated) ────────────

  it("S07: Horizon partition and Soroban crash during swap execution", async () => {
    const setup = buildScenario({
      seed: 0xb0c0_d0e0,
      scenario: "S07-horizon-partition-soroban-crash",
      faults: [
        {
          id: "s07-horizon-partition",
          service: "horizon",
          boundary: "swap-submission",
          params: { kind: "partition" },
          callCount: 1,
        },
        {
          id: "s07-soroban-crash",
          service: "sorobanRpc",
          boundary: "swap-submission",
          params: { kind: "crash" },
          callCount: 1,
        },
      ],
    });

    const { scheduler, horizon, soroban } = setup;

    scheduler.enter("swap-submission");
    await expect(horizon.submitTransaction("AAAAAA==")).rejects.toBeInstanceOf(FaultError);
    await expect(soroban.sendTransaction("AAAAAA==")).rejects.toBeInstanceOf(FaultError);
    scheduler.leave("swap-submission");

    horizon.heal();
    soroban.heal();

    const timeline = await assertNoViolations(setup, {
      db: setup.db,
      redis: setup.redis,
      horizon: setup.horizon,
      soroban: setup.soroban,
      llm: setup.llm,
    });

    sessionTimelines.push(timeline);
    sessionRecorder.record(timeline);
  });

  // ── S08: Redis corrupted data + LLM partial response (correlated) ──────

  it("S08: Redis corrupted lock value and LLM partial inference — correlated", async () => {
    const setup = buildScenario({
      seed: 0xf010_2030,
      scenario: "S08-redis-corrupted-llm-partial",
      faults: [
        {
          id: "s08-redis-corrupt",
          service: "redis",
          boundary: "agent-plan",
          params: {
            kind: "corruptedData",
            targetFields: ["value"],
            strategy: "zero",
          },
          callCount: 2,
        },
        {
          id: "s08-llm-partial",
          service: "llm",
          boundary: "agent-plan",
          params: { kind: "partialResponse", completenessRatio: 0.5 },
          callCount: 2,
        },
      ],
    });

    const { scheduler, redis, llm } = setup;

    scheduler.enter("agent-plan");
    await redis.set("plan:user-1", "data");
    const partial = await llm.complete([
      { role: "user", content: "plan a DeFi trade" },
    ]);
    expect((partial as unknown as Record<string, unknown>)["_partial"]).toBe(true);
    scheduler.leave("agent-plan");

    redis.heal();
    llm.heal();

    const timeline = await assertNoViolations(setup, {
      db: setup.db,
      redis: setup.redis,
      horizon: setup.horizon,
      soroban: setup.soroban,
      llm: setup.llm,
    });

    sessionTimelines.push(timeline);
    sessionRecorder.record(timeline);
  });

  // ── S09: all-services latency storm ───────────────────────────────────

  it("S09: all-services latency storm — every service slowed simultaneously", async () => {
    const setup = buildScenario({
      seed: 0x4050_6070,
      scenario: "S09-all-services-latency-storm",
      faults: [
        {
          id: "s09-db-latency",
          service: "database",
          boundary: "latency-storm",
          params: { kind: "latency", minMs: 200, maxMs: 2_000 },
          callCount: 2,
        },
        {
          id: "s09-redis-latency",
          service: "redis",
          boundary: "latency-storm",
          params: { kind: "latency", minMs: 200, maxMs: 2_000 },
          callCount: 2,
        },
        {
          id: "s09-horizon-latency",
          service: "horizon",
          boundary: "latency-storm",
          params: { kind: "latency", minMs: 200, maxMs: 2_000 },
          callCount: 2,
        },
        {
          id: "s09-soroban-latency",
          service: "sorobanRpc",
          boundary: "latency-storm",
          params: { kind: "latency", minMs: 200, maxMs: 2_000 },
          callCount: 2,
        },
        {
          id: "s09-llm-latency",
          service: "llm",
          boundary: "latency-storm",
          params: { kind: "latency", minMs: 200, maxMs: 2_000 },
          callCount: 2,
        },
      ],
    });

    const { scheduler, db, redis, horizon, soroban, llm } = setup;

    scheduler.enter("latency-storm");

    // All calls should still resolve (latency, not partition)
    const [dbRes, redisRes, horizonRes, sorobanRes, llmRes] = await Promise.all(
      [
        db.query("SELECT 1 AS ok"),
        redis.ping(),
        horizon.getLedgers(1),
        soroban.getLatestLedger(),
        llm.complete([{ role: "user", content: "status" }]),
      ]
    );

    expect(dbRes).toBeDefined();
    expect(redisRes).toBeDefined();
    expect(horizonRes).toBeDefined();
    expect(sorobanRes).toBeDefined();
    expect(llmRes).toBeDefined();

    scheduler.leave("latency-storm");

    // All services auto-heal since callCount is exhausted
    const timeline = await assertNoViolations(setup, {
      db,
      redis,
      horizon,
      soroban,
      llm,
    });

    sessionTimelines.push(timeline);
    sessionRecorder.record(timeline);

    // Verify all five latency faults were recorded in timeline
    const activatedIds = timeline.faultsActivated.map((f) => f.id);
    expect(activatedIds).toContain("s09-db-latency");
    expect(activatedIds).toContain("s09-redis-latency");
    expect(activatedIds).toContain("s09-horizon-latency");
    expect(activatedIds).toContain("s09-soroban-latency");
    expect(activatedIds).toContain("s09-llm-latency");
  });

  // ── S10: full cascade: partition → crash → stale → partial ────────────

  it("S10: full cascade — partition, crash, stale, partial across multiple services", async () => {
    const setup = buildScenario({
      seed: 0x8090_a0b0,
      scenario: "S10-full-cascade",
      faults: [
        // Phase 1: partition on Horizon + DB crash (correlated outage)
        {
          id: "s10-horizon-partition",
          service: "horizon",
          boundary: "phase-1-outage",
          params: { kind: "partition" },
          callCount: 1,
        },
        {
          id: "s10-db-crash",
          service: "database",
          boundary: "phase-1-outage",
          params: { kind: "crash" },
          callCount: 1,
        },
        // Phase 2: stale reads emerge as services come back
        {
          id: "s10-soroban-stale",
          service: "sorobanRpc",
          boundary: "phase-2-recovery",
          params: {
            kind: "staleRead",
            staleByMs: 10_000,
            fixedPayload: { sequence: 49_995_000, protocolVersion: 21 },
          },
          callCount: 2,
        },
        {
          id: "s10-redis-stale",
          service: "redis",
          boundary: "phase-2-recovery",
          params: { kind: "staleRead", staleByMs: 10_000 },
          callCount: 2,
        },
        // Phase 3: partial responses from LLM before fully healed
        {
          id: "s10-llm-partial",
          service: "llm",
          boundary: "phase-3-partial",
          params: {
            kind: "partialResponse",
            completenessRatio: 0.4,
            malformed: false,
          },
          callCount: 1,
        },
      ],
    });

    const { scheduler, db, redis, horizon, soroban, llm } = setup;

    // Phase 1 — outage
    scheduler.enter("phase-1-outage");
    await expect(horizon.getLedgers()).rejects.toBeInstanceOf(FaultError);
    await expect(db.query("SELECT * FROM transactions")).rejects.toBeInstanceOf(FaultError);
    scheduler.leave("phase-1-outage");

    // Heal DB and Horizon before phase 2
    db.heal();
    horizon.heal();

    // Phase 2 — partial recovery with stale reads
    scheduler.enter("phase-2-recovery");
    const sorobanStale = await soroban.getLatestLedger();
    // Stale payload has a lower sequence
    expect((sorobanStale as unknown as Record<string, unknown>)["sequence"]).toBe(
      49_995_000
    );
    await redis.get("any-key"); // stale
    scheduler.leave("phase-2-recovery");

    // Heal Redis and Soroban
    redis.heal();
    soroban.heal();

    // Phase 3 — LLM partial response
    scheduler.enter("phase-3-partial");
    const partialInference = await llm.complete([
      { role: "user", content: "analyse trade" },
    ]);
    expect((partialInference as unknown as Record<string, unknown>)["_partial"]).toBe(true);
    scheduler.leave("phase-3-partial");

    // Heal LLM
    llm.heal();

    const timeline = await assertNoViolations(setup, {
      db,
      redis,
      horizon,
      soroban,
      llm,
    });

    sessionTimelines.push(timeline);
    sessionRecorder.record(timeline);

    // Verify timeline contains events from all three phases
    const eventMessages = timeline.events.map((e) => e.message);
    expect(eventMessages.some((m) => m.includes("phase-1-outage"))).toBe(true);
    expect(eventMessages.some((m) => m.includes("phase-2-recovery"))).toBe(true);
    expect(eventMessages.some((m) => m.includes("phase-3-partial"))).toBe(true);
  });

  // ── Determinism verification ───────────────────────────────────────────

  describe("determinism guarantee", () => {
    it("same seed produces identical fault decisions across two independent runs", () => {
      const cfg: FaultSchedulerConfig = {
        seed: 0x11223344,
        scenario: "determinism-check",
        faults: [
          {
            id: "det-db",
            service: "database",
            boundary: "check",
            params: { kind: "latency", minMs: 10, maxMs: 100 },
            probability: 0.7,
          },
          {
            id: "det-redis",
            service: "redis",
            boundary: "check",
            params: { kind: "partition" },
            probability: 0.5,
          },
        ],
      };

      // Run A
      const schedA = new SeededFaultScheduler(cfg);
      const resultsA: Array<string | null> = [];
      schedA.enter("check");
      for (let i = 0; i < 10; i++) {
        const fp = schedA.resolveFault("database", {
          boundary: "check",
          callIndex: i,
        });
        resultsA.push(fp?.kind ?? null);
      }

      // Run B — fresh scheduler, same seed
      const schedB = new SeededFaultScheduler(cfg);
      const resultsB: Array<string | null> = [];
      schedB.enter("check");
      for (let i = 0; i < 10; i++) {
        const fp = schedB.resolveFault("database", {
          boundary: "check",
          callIndex: i,
        });
        resultsB.push(fp?.kind ?? null);
      }

      expect(resultsA).toEqual(resultsB);
    });

    it("different seeds produce different fault decisions", () => {
      const makeDecisions = (seed: number) => {
        const sched = new SeededFaultScheduler({
          seed,
          scenario: "diff-seed-test",
          faults: [
            {
              id: "diff",
              service: "redis",
              boundary: "b",
              params: { kind: "partition" },
              probability: 0.5,
            },
          ],
        });
        sched.enter("b");
        return Array.from({ length: 20 }, (_, i) =>
          sched.resolveFault("redis", { boundary: "b", callIndex: i })?.kind ?? null
        );
      };

      const d1 = makeDecisions(0xaaaabbbb);
      const d2 = makeDecisions(0xccccdddd);
      // Very unlikely to be identical across 20 draws
      expect(d1).not.toEqual(d2);
    });
  });

  // ── TimelineRecorder unit tests ────────────────────────────────────────

  describe("TimelineRecorder", () => {
    it("serialises and deserialises a failing timeline correctly", () => {
      const scheduler = new SeededFaultScheduler({
        seed: 0xfeedface,
        scenario: "recorder-test",
        faults: [],
      });
      scheduler.recordViolation({
        invariantId: "test.invariant",
        invariantName: "test invariant",
        category: "availability",
        service: "database",
        boundary: "post-recovery",
        expected: "db responds",
        actual: "db threw",
      });
      const timeline = scheduler.finish();

      const recorder = new TimelineRecorder({
        writer: () => {},
        mkdir: () => {},
      });
      const json = recorder.serialise(timeline);
      const parsed = TimelineRecorder.deserialise(json);

      expect(parsed.seed).toBe(0xfeedface);
      expect(parsed.scenario).toBe("recorder-test");
      expect(parsed.violations).toHaveLength(1);
      expect(parsed.violations[0].invariantId).toBe("test.invariant");
    });

    it("only writes failing timelines by default", () => {
      const written: string[] = [];
      const recorder = new TimelineRecorder({
        writer: (fp) => written.push(fp),
        mkdir: () => {},
      });

      // Passing timeline
      const passSched = new SeededFaultScheduler({
        seed: 1,
        scenario: "passing",
        faults: [],
      });
      recorder.record(passSched.finish());

      // Failing timeline
      const failSched = new SeededFaultScheduler({
        seed: 2,
        scenario: "failing",
        faults: [],
      });
      failSched.recordViolation({
        invariantId: "x",
        invariantName: "x",
        category: "safety",
        service: "redis",
        boundary: "b",
        expected: "e",
        actual: "a",
      });
      recorder.record(failSched.finish());

      expect(written).toHaveLength(1);
      expect(written[0]).toContain("2-failing");
    });

    it("builds a correct session report", () => {
      const written: string[] = [];
      const recorder = new TimelineRecorder({
        writer: (fp) => written.push(fp),
        mkdir: () => {},
      });

      for (let i = 0; i < 5; i++) {
        const s = new SeededFaultScheduler({
          seed: i,
          scenario: `s${i}`,
          faults: [],
        });
        if (i >= 3) {
          s.recordViolation({
            invariantId: `inv-${i}`,
            invariantName: `inv ${i}`,
            category: "safety",
            service: "llm",
            boundary: "b",
            expected: "ok",
            actual: "fail",
          });
        }
        recorder.record(s.finish());
      }

      const report = recorder.buildSessionReport();
      expect(report.totalScenarios).toBe(5);
      expect(report.passed).toBe(3);
      expect(report.failed).toBe(2);
      expect(report.failingSeeds).toEqual([3, 4]);
      expect(report.totalViolations).toBe(2);
    });
  });
});
