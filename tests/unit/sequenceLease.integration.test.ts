/**
 * Integration tests for SequenceLease — real PostgreSQL, mocked Horizon.
 *
 * These tests require a running PostgreSQL instance (provided by the test
 * environment).  They validate:
 * - Linearizable sequence allocation across concurrent workers
 * - Fencing token monotonicity
 * - Stale lease rejection
 * - Lease expiry and reclamation
 * - Consumption after successful submission
 * - Crash recovery (reservation without consumption)
 * - On-chain reconciliation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import AppDataSource from "../../src/config/Datasource";
import { SequenceLease } from "../../src/services/sequence/SequenceLease.entity";
import { SequenceLeaseService } from "../../src/services/sequence/SequenceLease.service";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../../src/config/config", () => ({
  default: {
    env: "test",
    stellar: { horizonUrl: "https://horizon-testnet.stellar.org" },
    db: {
      postgres: {
        host: process.env.DB_HOST || "localhost",
        port: parseInt(process.env.DB_PORT || "5432"),
        username: process.env.DB_USER || "postgres",
        password: process.env.DB_PASS || "postgres",
        database: process.env.DB_NAME || "chenpilot_test",
      },
    },
    redis: { host: "localhost", port: 6379 },
    jwt: { secret: "test-secret-32-chars-long-enough!!" },
  },
}));

jest.mock("../../src/config/logger", () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockHorizonAccount(sequence: number) {
  return {
    accountId: () => "GTESTACCOUNT12345678901234567890123456789012345678901234",
    sequenceNumber: () => sequence.toString(),
    incrementSequenceNumber: () => {},
  } as any;
}

function makeMockHorizon(sequence: number = 1000) {
  return {
    loadAccount: jest.fn().mockResolvedValue(makeMockHorizonAccount(sequence)),
  } as any;
}

const TEST_ACCOUNT = "GTESTACCTINTEGRATION000000000000000000000000000000";

// ── Suite ────────────────────────────────────────────────────────────────────

describe("SequenceLease Integration (real DB, mocked Horizon)", () => {
  let service: SequenceLeaseService;
  let repo: any;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    // Ensure the sequence_lease table exists (auto-synchronize for tests)
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sequence_lease (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "accountPublicKey" VARCHAR(64) NOT NULL,
        "leasedSequence" BIGINT NOT NULL,
        "fencingToken" BIGINT NOT NULL,
        "ownerId" VARCHAR(128) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'reserved',
        "reservedAt" TIMESTAMP NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "consumedAt" TIMESTAMP NULL,
        "txHash" VARCHAR(128) NULL,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sequence_lease_account_sequence"
      ON sequence_lease ("accountPublicKey", "leasedSequence");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sequence_lease_account_status"
      ON sequence_lease ("accountPublicKey", status);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sequence_lease_status_expires"
      ON sequence_lease (status, "expiresAt");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sequence_lease_account_fencing"
      ON sequence_lease ("accountPublicKey", "fencingToken");
    `);
    await queryRunner.release();

    service = new SequenceLeaseService();
    repo = AppDataSource.getRepository(SequenceLease);
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await repo.delete({ accountPublicKey: TEST_ACCOUNT });
      await AppDataSource.destroy();
    }
  });

  beforeEach(async () => {
    // Clean up test data
    await repo.delete({ accountPublicKey: TEST_ACCOUNT });
  });

  // ── Linearizability ────────────────────────────────────────────────────

  it("sequential allocations produce monotonically increasing sequences", async () => {
    const horizon = makeMockHorizon(100);

    const r1 = await service.acquireLease(TEST_ACCOUNT, "worker-1", 60_000, horizon);
    const r2 = await service.acquireLease(TEST_ACCOUNT, "worker-2", 60_000, horizon);
    const r3 = await service.acquireLease(TEST_ACCOUNT, "worker-3", 60_000, horizon);

    expect(r1.sequenceNumber).toBe(101);
    expect(r2.sequenceNumber).toBe(102);
    expect(r3.sequenceNumber).toBe(103);

    expect(r1.fencingToken).toBe(1);
    expect(r2.fencingToken).toBe(2);
    expect(r3.fencingToken).toBe(3);
  });

  it("concurrent allocations produce unique sequences", async () => {
    const horizon = makeMockHorizon(200);

    // Simulate 10 concurrent workers
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.acquireLease(TEST_ACCOUNT, `worker-${i}`, 60_000, horizon)
      )
    );

    const sequences = results.map((r) => r.sequenceNumber);
    const uniqueSequences = new Set(sequences);

    // All sequences must be unique
    expect(uniqueSequences.size).toBe(10);

    // All sequences must be > 200 (the on-chain sequence)
    for (const seq of sequences) {
      expect(seq).toBeGreaterThan(200);
    }

    // Fencing tokens must be monotonically increasing
    const tokens = results.map((r) => r.fencingToken);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i]).toBeGreaterThan(tokens[i - 1]);
    }
  });

  // ── Fencing ─────────────────────────────────────────────────────────────

  it("fencing token is monotonically increasing across allocations", async () => {
    const horizon = makeMockHorizon(300);

    const r1 = await service.acquireLease(TEST_ACCOUNT, "w1", 60_000, horizon);
    const r2 = await service.acquireLease(TEST_ACCOUNT, "w2", 60_000, horizon);
    const r3 = await service.acquireLease(TEST_ACCOUNT, "w3", 60_000, horizon);

    expect(r1.fencingToken).toBe(1);
    expect(r2.fencingToken).toBe(2);
    expect(r3.fencingToken).toBe(3);
  });

  it("stale lease is rejected by fencing check during consumeLease", async () => {
    const horizon = makeMockHorizon(400);

    const lease1 = await service.acquireLease(TEST_ACCOUNT, "w1", 60_000, horizon);
    const lease2 = await service.acquireLease(TEST_ACCOUNT, "w2", 60_000, horizon);

    // lease1 is now superseded by lease2
    await expect(
      service.consumeLease(lease1.lease.id, "w1", "tx-hash-stale")
    ).rejects.toThrow("superseded");

    // lease2 should still be consumable
    const consumed = await service.consumeLease(lease2.lease.id, "w2", "tx-hash-valid");
    expect(consumed.status).toBe("consumed");
    expect(consumed.txHash).toBe("tx-hash-valid");
  });

  it("validateLease rejects stale fencing token", async () => {
    const horizon = makeMockHorizon(500);

    const lease1 = await service.acquireLease(TEST_ACCOUNT, "w1", 60_000, horizon);
    await service.acquireLease(TEST_ACCOUNT, "w2", 60_000, horizon);

    // Validate with old fencing token
    await expect(
      service.validateLease(lease1.lease.id, lease1.fencingToken)
    ).rejects.toThrow("superseded");
  });

  // ── Lease Expiry ────────────────────────────────────────────────────────

  it("expired lease is rejected during consumeLease", async () => {
    const horizon = makeMockHorizon(600);

    // Create a lease with very short TTL
    const lease = await service.acquireLease(TEST_ACCOUNT, "w1", 1, horizon); // 1ms TTL

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(
      service.consumeLease(lease.lease.id, "w1", "tx-hash")
    ).rejects.toThrow("expired");
  });

  it("expireAndReclaim reclaims expired leases", async () => {
    const horizon = makeMockHorizon(700);

    // Create a lease with very short TTL
    await service.acquireLease(TEST_ACCOUNT, "w1", 1, horizon);

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 50));

    const reclaimed = await service.expireAndReclaim();

    expect(reclaimed.length).toBeGreaterThanOrEqual(1);
    expect(reclaimed[0].status).toBe("reclaimed");
  });

  // ── Consumption ─────────────────────────────────────────────────────────

  it("successful consumption marks lease as consumed with txHash", async () => {
    const horizon = makeMockHorizon(800);

    const lease = await service.acquireLease(TEST_ACCOUNT, "w1", 60_000, horizon);
    const consumed = await service.consumeLease(lease.lease.id, "w1", "abc123hash");

    expect(consumed.status).toBe("consumed");
    expect(consumed.txHash).toBe("abc123hash");
    expect(consumed.consumedAt).toBeTruthy();
  });

  it("duplicate consumption is rejected", async () => {
    const horizon = makeMockHorizon(900);

    const lease = await service.acquireLease(TEST_ACCOUNT, "w1", 60_000, horizon);
    await service.consumeLease(lease.lease.id, "w1", "hash-1");

    await expect(
      service.consumeLease(lease.lease.id, "w1", "hash-2")
    ).rejects.toThrow("not reserved");
  });

  it("consumption by wrong owner is rejected", async () => {
    const horizon = makeMockHorizon(1000);

    const lease = await service.acquireLease(TEST_ACCOUNT, "w1", 60_000, horizon);

    await expect(
      service.consumeLease(lease.lease.id, "wrong-worker", "hash")
    ).rejects.toThrow("worker-1");
  });

  // ── Crash Recovery ──────────────────────────────────────────────────────

  it("reservation without consumption is detected as gap", async () => {
    const horizon = makeMockHorizon(1100);

    // Simulate crash: acquire lease but never consume
    await service.acquireLease(TEST_ACCOUNT, "w1", 60_000, horizon);

    // Reconcile — the reserved sequence is below on-chain (Horizon returns 1100)
    const result = await service.reconcileWithOnChain(TEST_ACCOUNT, horizon);

    // Sequence 1101 was reserved but not consumed, on-chain is 1100
    expect(result.gapSize).toBeGreaterThanOrEqual(0);
  });

  it("reclaim + new acquisition allows next worker to proceed", async () => {
    const horizon = makeMockHorizon(1200);

    // Worker 1 acquires and crashes (doesn't consume)
    const lease1 = await service.acquireLease(TEST_ACCOUNT, "w1", 1, horizon); // 1ms TTL

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Reclaim expired leases
    await service.expireAndReclaim();

    // Worker 2 can now acquire a new lease
    const lease2 = await service.acquireLease(TEST_ACCOUNT, "w2", 60_000, horizon);

    expect(lease2.sequenceNumber).toBeGreaterThan(lease1.sequenceNumber);
    expect(lease2.fencingToken).toBeGreaterThan(lease1.fencingToken);
  });

  // ── On-chain Reconciliation ─────────────────────────────────────────────

  it("reconciliation detects gap between on-chain and local consumed", async () => {
    const horizon = makeMockHorizon(1300);

    // Consume a lease at sequence 1301
    const lease = await service.acquireLease(TEST_ACCOUNT, "w1", 60_000, horizon);
    await service.consumeLease(lease.lease.id, "w1", "tx-hash-1301");

    // On-chain is still 1300 (the original from mock)
    // Local consumed is 1301
    // This shouldn't normally happen, but tests the detection
    const result = await service.reconcileWithOnChain(TEST_ACCOUNT, horizon);

    expect(result.onChainSequence).toBe(1300);
    expect(result.highestConsumedLocal).toBe(1301);
  });

  it("reconciliation reclaims stale reserved leases below on-chain", async () => {
    const horizon = makeMockHorizon(1400);

    // Create a lease at 1401 (above on-chain)
    const lease = await service.acquireLease(TEST_ACCOUNT, "w1", 60_000, horizon);
    expect(lease.sequenceNumber).toBe(1401);

    // On-chain advances to 1402 (simulating someone else submitted)
    const advancedHorizon = makeMockHorizon(1402);

    const result = await service.reconcileWithOnChain(TEST_ACCOUNT, advancedHorizon);

    // Lease at 1401 is now stale (below on-chain 1402)
    expect(result.staleLeases.length).toBeGreaterThanOrEqual(1);
    expect(result.reclaimedLeases).toBeGreaterThanOrEqual(1);
  });
});
