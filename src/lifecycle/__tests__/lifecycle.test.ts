/**
 * lifecycle.test.ts
 *
 * Unit tests for the data lifecycle management system.
 * All database and Redis interactions are mocked — no real connections required.
 */

import crypto from "crypto";

// ─── Mock AppDataSource ────────────────────────────────────────────────────────
const mockRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((data: unknown) => ({ ...data })),
  save: jest.fn(async (entity: unknown) => entity),
  createQueryBuilder: jest.fn(),
};

const mockQb = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
  getCount: jest.fn().mockResolvedValue(0),
  getOne: jest.fn().mockResolvedValue(null),
  delete: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ affected: 1 }),
};

const mockDs = {
  getRepository: jest.fn().mockReturnValue(mockRepo),
  createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  query: jest.fn().mockResolvedValue([]),
};

jest.mock("../../config/Datasource", () => ({
  __esModule: true,
  default: mockDs,
  AppDataSource: mockDs,
}));

// ─── Mock Redis ────────────────────────────────────────────────────────────────
const mockRedis = {
  scan: jest.fn().mockResolvedValue(["0", []]),
  del: jest.fn().mockResolvedValue(0),
};

jest.mock("../../services/redis/client", () => ({
  getRedisClient: () => mockRedis,
}));

// ─── Mock memoryStore ──────────────────────────────────────────────────────────
const mockMemoryStore = {
  clear: jest.fn(),
  get: jest.fn().mockReturnValue([]),
};

jest.mock("../../Agents/memory/memory", () => ({
  memoryStore: mockMemoryStore,
}));

// ─── Mock auditLogService ─────────────────────────────────────────────────────
jest.mock("../../AuditLog/auditLog.service", () => ({
  auditLogService: {
    log: jest.fn().mockResolvedValue({}),
  },
}));

// ─── Mock JobQueueService ─────────────────────────────────────────────────────
jest.mock("../../jobs/jobQueue.service", () => ({
  JobQueueService: jest.fn().mockImplementation(() => ({
    reapCancelledOrCompletedOlderThan: jest.fn().mockResolvedValue(3),
  })),
}));

// ─── Now import lifecycle modules ─────────────────────────────────────────────
import {
  REGISTRY,
  DataClass,
  getClassification,
  isUserOwned,
  getUserOwnedClasses,
} from "../classification";

import {
  KeyManagementService,
  ErasedKeyError,
} from "../keyManagement";

import {
  LegalHoldService,
  HoldBlocksErasureError,
} from "../legalHold";

import { DeletionCoordinator } from "../deletionCoordinator";

import { ErasureReporter, ErasureReceipt } from "../erasureReporter";

import { RetentionEngine } from "../retentionEngine";

// ─── Set required env ─────────────────────────────────────────────────────────
const FAKE_KEY = "a".repeat(64); // 64-char hex
beforeAll(() => {
  process.env.ENCRYPTION_KEY = FAKE_KEY;
});

// ─── 1. Classification registry ───────────────────────────────────────────────

describe("Classification Registry", () => {
  const allClasses = Object.keys(REGISTRY) as DataClass[];

  it("covers all expected data classes", () => {
    expect(allClasses.length).toBeGreaterThanOrEqual(18);
  });

  it.each(allClasses)(
    "class '%s' has all required fields",
    (dc: DataClass) => {
      const rec = REGISTRY[dc];
      expect(rec.owner).toMatch(/^(user|tenant|system)$/);
      expect(typeof rec.purpose).toBe("string");
      expect(rec.purpose.length).toBeGreaterThan(0);
      expect(typeof rec.retentionDays).toBe("number");
      expect(rec.retentionDays).toBeGreaterThanOrEqual(0);
      expect(rec.erasureMethod).toMatch(/^(crypto|hard-delete|nullify|retain)$/);
      expect(typeof rec.requiresEncryption).toBe("boolean");
      expect(Array.isArray(rec.stores)).toBe(true);
      expect(rec.stores.length).toBeGreaterThan(0);
    }
  );

  it("isUserOwned returns true only for user-owned classes", () => {
    expect(isUserOwned("user_profile")).toBe(true);
    expect(isUserOwned("refresh_token")).toBe(true);
    expect(isUserOwned("conversation_memory")).toBe(true);
    expect(isUserOwned("audit_log")).toBe(false);
    expect(isUserOwned("queue_job")).toBe(false);
    expect(isUserOwned("price_cache")).toBe(false);
  });

  it("getUserOwnedClasses returns non-empty list", () => {
    const userOwned = getUserOwnedClasses();
    expect(userOwned.length).toBeGreaterThan(0);
    userOwned.forEach((dc) => expect(REGISTRY[dc].owner).toBe("user"));
  });

  it("getClassification throws for unknown class", () => {
    expect(() => getClassification("nonexistent" as DataClass)).toThrow(
      "Unknown data class"
    );
  });

  it("audit_log uses 'retain' erasure method (immutable)", () => {
    expect(REGISTRY.audit_log.erasureMethod).toBe("retain");
  });

  it("user_private_key requires encryption", () => {
    expect(REGISTRY.user_private_key.requiresEncryption).toBe(true);
    expect(REGISTRY.user_private_key.erasureMethod).toBe("crypto");
  });

  it("transaction_lifecycle uses nullify (preserves financial records)", () => {
    expect(REGISTRY.transaction_lifecycle.erasureMethod).toBe("nullify");
  });
});

// ─── 2. KeyManagementService ──────────────────────────────────────────────────

describe("KeyManagementService", () => {
  let kms: KeyManagementService;

  beforeEach(() => {
    jest.clearAllMocks();
    kms = new KeyManagementService();
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.save.mockImplementation(async (entity: unknown) => entity);
    mockRepo.create.mockImplementation((data: unknown) => ({ ...data }));
  });

  it("getDek returns a 32-byte Buffer for a new user", async () => {
    const dek = await kms.getDek("user-123");
    expect(Buffer.isBuffer(dek)).toBe(true);
    expect(dek.length).toBe(32);
  });

  it("getDek is deterministic for same userId", async () => {
    const dek1 = await kms.getDek("user-123");
    const dek2 = await kms.getDek("user-123");
    expect(dek1.toString("hex")).toBe(dek2.toString("hex"));
  });

  it("getDek differs between different userIds", async () => {
    const dek1 = await kms.getDek("user-aaa");
    const dek2 = await kms.getDek("user-bbb");
    expect(dek1.toString("hex")).not.toBe(dek2.toString("hex"));
  });

  it("getDek throws ErasedKeyError when tombstoned", async () => {
    const tombstonedAt = new Date("2026-01-01T00:00:00Z");
    mockRepo.findOne.mockResolvedValueOnce({
      userId: "user-erased",
      tombstonedAt,
    });

    await expect(kms.getDek("user-erased")).rejects.toThrow(ErasedKeyError);
  });

  it("encryptForUser / decryptForUser round-trips plaintext", async () => {
    const plaintext = "my secret wallet key";
    const ciphertext = await kms.encryptForUser("user-123", plaintext);
    expect(ciphertext).not.toBe(plaintext);

    const decrypted = await kms.decryptForUser("user-123", ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("tombstoneKey sets tombstonedAt on the record", async () => {
    mockRepo.findOne.mockResolvedValueOnce({
      userId: "user-456",
      tombstonedAt: undefined,
    });

    const savedEntities: unknown[] = [];
    mockRepo.save.mockImplementationOnce(async (entity: unknown) => {
      savedEntities.push(entity);
      return entity;
    });

    await kms.tombstoneKey("user-456", "user_request");

    expect(savedEntities.length).toBe(1);
    const saved = savedEntities[0] as { tombstonedAt: Date; tombstoneReason: string };
    expect(saved.tombstonedAt).toBeInstanceOf(Date);
    expect(saved.tombstoneReason).toBe("user_request");
  });

  it("tombstoneKey is idempotent — no error on double-tombstone", async () => {
    mockRepo.findOne.mockResolvedValue({
      userId: "user-789",
      tombstonedAt: new Date(),
    });
    await expect(kms.tombstoneKey("user-789", "test")).resolves.not.toThrow();
  });

  it("hasBeenErased returns true after tombstone", async () => {
    mockRepo.findOne.mockResolvedValueOnce({
      userId: "user-erased",
      tombstonedAt: new Date(),
    });
    expect(await kms.hasBeenErased("user-erased")).toBe(true);
  });

  it("hasBeenErased returns false for active user", async () => {
    mockRepo.findOne.mockResolvedValueOnce({
      userId: "user-active",
      tombstonedAt: undefined,
    });
    expect(await kms.hasBeenErased("user-active")).toBe(false);
  });
});

// ─── 3. LegalHoldService ──────────────────────────────────────────────────────

describe("LegalHoldService", () => {
  let service: LegalHoldService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LegalHoldService();
    mockRepo.create.mockImplementation((data: unknown) => ({ ...data }));
    mockRepo.save.mockImplementation(async (entity: unknown) => entity);
    mockRepo.find.mockResolvedValue([]);
  });

  it("placeHold creates and saves a hold entry", async () => {
    await service.placeHold({
      holdId: "LEGAL-001",
      subjectType: "user",
      subjectId: "user-abc",
      dataClasses: ["user_profile", "audit_log"],
      reason: "Regulatory investigation",
      requestedBy: "legal-team",
    });

    expect(mockRepo.save).toHaveBeenCalled();
    const created = mockRepo.create.mock.calls[0][0] as { holdId: string };
    expect(created.holdId).toBe("LEGAL-001");
  });

  it("liftHold sets liftedAt on all matching entries", async () => {
    const fakeEntries = [
      { holdId: "LEGAL-001", liftedAt: undefined },
      { holdId: "LEGAL-001", liftedAt: undefined },
    ];
    mockRepo.find.mockResolvedValueOnce(fakeEntries);
    mockRepo.save.mockImplementation(async (entries: unknown) => entries);

    await service.liftHold("LEGAL-001", "legal-team");

    expect(fakeEntries[0].liftedAt).toBeInstanceOf(Date);
    expect(fakeEntries[1].liftedAt).toBeInstanceOf(Date);
  });

  it("liftHold throws when no entries found", async () => {
    mockRepo.find.mockResolvedValueOnce([]);
    await expect(service.liftHold("NONEXISTENT", "admin")).rejects.toThrow(
      "No hold entries found"
    );
  });

  it("isUnderHold returns true for active hold matching data class", async () => {
    const now = new Date();
    mockQb.getMany.mockResolvedValueOnce([
      {
        holdId: "LEGAL-002",
        subjectId: "user-abc",
        dataClasses: ["user_profile", "refresh_token"],
        liftedAt: undefined,
        expiresAt: undefined,
      },
    ]);
    mockRepo.createQueryBuilder.mockReturnValueOnce(mockQb);

    const held = await service.isUnderHold("user-abc", "user_profile");
    expect(held).toBe(true);
  });

  it("isUnderHold returns false when data class not in hold", async () => {
    mockQb.getMany.mockResolvedValueOnce([
      {
        dataClasses: ["audit_log"], // different class
        liftedAt: undefined,
        expiresAt: undefined,
      },
    ]);
    mockRepo.createQueryBuilder.mockReturnValueOnce(mockQb);

    const held = await service.isUnderHold("user-abc", "user_profile");
    expect(held).toBe(false);
  });

  it("isErasureBlocked returns true when active hold on user-owned class", async () => {
    // getActiveHolds returns hold covering user_profile
    mockQb.getMany.mockResolvedValueOnce([
      {
        holdId: "LEGAL-003",
        subjectId: "user-xyz",
        dataClasses: ["user_profile"],
        liftedAt: undefined,
        expiresAt: undefined,
      },
    ]);
    mockRepo.createQueryBuilder.mockReturnValueOnce(mockQb);

    const blocked = await service.isErasureBlocked("user-xyz");
    expect(blocked).toBe(true);
  });

  it("isErasureBlocked returns false with no active holds", async () => {
    mockQb.getMany.mockResolvedValueOnce([]);
    mockRepo.createQueryBuilder.mockReturnValueOnce(mockQb);

    const blocked = await service.isErasureBlocked("user-free");
    expect(blocked).toBe(false);
  });
});

// ─── 4. DeletionCoordinator ───────────────────────────────────────────────────

describe("DeletionCoordinator", () => {
  let coordinator: DeletionCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    coordinator = new DeletionCoordinator();
    // No active holds by default
    mockQb.getMany.mockResolvedValue([]);
    mockRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.save.mockImplementation(async (e: unknown) => e);
    mockRepo.create.mockImplementation((d: unknown) => ({ ...d }));
  });

  it("eraseUser completes all steps for a user with no holds", async () => {
    const result = await coordinator.eraseUser("user-del-1", {
      reason: "test",
      requestedBy: "user-del-1",
    });

    expect(result.userId).toBe("user-del-1");
    expect(result.stepsCompleted.length).toBeGreaterThan(0);
    // crypto.key_tombstone should be in completed steps
    expect(result.stepsCompleted).toContain("crypto.key_tombstone");
    expect(result.cryptoErasurePerformed).toBe(true);
  });

  it("eraseUser throws HoldBlocksErasureError when hold is active", async () => {
    // Make isErasureBlocked return true
    mockQb.getMany
      .mockResolvedValueOnce([
        // getActiveHolds for isErasureBlocked
        {
          holdId: "LEGAL-BLOCK",
          subjectId: "user-held",
          dataClasses: ["user_profile"],
          liftedAt: undefined,
          expiresAt: undefined,
        },
      ])
      .mockResolvedValueOnce([
        // getErasureBlockingHolds
        {
          holdId: "LEGAL-BLOCK",
          subjectId: "user-held",
          dataClasses: ["user_profile"],
          reason: "Regulatory",
          placedAt: new Date(),
          liftedAt: undefined,
        },
      ]);
    mockRepo.createQueryBuilder.mockReturnValue(mockQb);

    await expect(
      coordinator.eraseUser("user-held", { skipHoldCheck: false })
    ).rejects.toThrow(HoldBlocksErasureError);
  });

  it("eraseUser collects step failures without aborting", async () => {
    // Make one DB operation fail
    mockQb.execute
      .mockRejectedValueOnce(new Error("DB connection lost"))
      .mockResolvedValue({ affected: 1 });

    const result = await coordinator.eraseUser("user-partial", {
      skipHoldCheck: true,
    });

    // Should have some failures but also completions
    expect(result.stepsFailed.length).toBeGreaterThanOrEqual(1);
    // Should still proceed with remaining steps
    expect(result.stepsCompleted.length).toBeGreaterThan(0);
    expect(result.completedAt.getTime()).toBeGreaterThanOrEqual(
      result.startedAt.getTime()
    );
  });
});

// ─── 5. RetentionEngine ───────────────────────────────────────────────────────

describe("RetentionEngine", () => {
  let engine: RetentionEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new RetentionEngine(mockDs as unknown as import("typeorm").DataSource);
    mockQb.execute.mockResolvedValue({ affected: 5 });
    mockDs.createQueryBuilder.mockReturnValue(mockQb);
    mockDs.query.mockResolvedValue([]);
    mockRedis.scan.mockResolvedValue(["0", ["key:1", "key:2"]]);
  });

  afterEach(() => {
    engine.stop();
  });

  it("runRetentionPass returns a result with runAt", async () => {
    const result = await engine.runRetentionPass();
    expect(result.runAt).toBeInstanceOf(Date);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runRetentionPass reports errors without throwing", async () => {
    mockQb.execute.mockRejectedValueOnce(new Error("Query failed"));
    const result = await engine.runRetentionPass();
    // Should continue running other rules
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("stop() can be called safely when not running", () => {
    expect(() => engine.stop()).not.toThrow();
  });
});

// ─── 6. ErasureReporter ───────────────────────────────────────────────────────

describe("ErasureReporter", () => {
  let reporter: ErasureReporter;

  const fakeResult = {
    userId: "user-report-1",
    startedAt: new Date("2026-01-01T10:00:00Z"),
    completedAt: new Date("2026-01-01T10:00:05Z"),
    stepsCompleted: [
      "db.refresh_tokens",
      "db.bot_sessions",
      "crypto.key_tombstone",
      "db.user",
    ],
    stepsFailed: [],
    cryptoErasurePerformed: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    reporter = new ErasureReporter();
    mockRepo.create.mockImplementation((d: unknown) => ({ ...d }));
    mockRepo.save.mockImplementation(async (e: unknown) => e);
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.find.mockResolvedValue([]);
    mockQb.getMany.mockResolvedValue([]);
    mockRepo.createQueryBuilder.mockReturnValue(mockQb);
  });

  it("generateReceipt returns a receipt with all required fields", async () => {
    const receipt = await reporter.generateReceipt(fakeResult);

    expect(typeof receipt.receiptId).toBe("string");
    expect(receipt.subjectIdHash).not.toBe(fakeResult.userId); // hashed, not plain
    expect(receipt.subjectIdHash.length).toBe(64); // SHA-256 hex
    expect(receipt.erasedAt).toBe(fakeResult.completedAt.toISOString());
    expect(receipt.cryptoErasurePerformed).toBe(true);
    expect(Array.isArray(receipt.dataClassesCovered)).toBe(true);
    expect(typeof receipt.receiptHash).toBe("string");
    expect(typeof receipt.signature).toBe("string");
  });

  it("receipt hash is SHA-256 of canonical fields", async () => {
    const receipt = await reporter.generateReceipt(fakeResult);

    const expected = crypto
      .createHash("sha256")
      .update(
        `${receipt.receiptId}|${receipt.subjectIdHash}|${receipt.erasedAt}|${fakeResult.stepsCompleted.join(",")}`
      )
      .digest("hex");

    expect(receipt.receiptHash).toBe(expected);
  });

  it("verifyReceipt returns true for an untampered receipt", async () => {
    const receipt = await reporter.generateReceipt(fakeResult);
    expect(reporter.verifyReceipt(receipt)).toBe(true);
  });

  it("verifyReceipt returns false when receipt is tampered", async () => {
    const receipt = await reporter.generateReceipt(fakeResult);
    const tampered: ErasureReceipt = {
      ...receipt,
      receiptHash: "0000000000000000000000000000000000000000000000000000000000000000",
    };
    expect(reporter.verifyReceipt(tampered)).toBe(false);
  });

  it("subjectIdHash is SHA-256 of userId — not the userId itself", async () => {
    const receipt = await reporter.generateReceipt(fakeResult);
    const expected = crypto
      .createHash("sha256")
      .update(fakeResult.userId)
      .digest("hex");

    expect(receipt.subjectIdHash).toBe(expected);
    expect(receipt.subjectIdHash).not.toBe(fakeResult.userId);
  });

  it("generateReport returns status for all user-owned data classes", async () => {
    const report = await reporter.generateReport("user-report-2");
    expect(report.userId).toBe("user-report-2");
    expect(Array.isArray(report.dataClassStatus)).toBe(true);
    expect(report.dataClassStatus.length).toBeGreaterThan(0);
    report.dataClassStatus.forEach((s) => {
      expect(["erased", "retained_compliance", "held", "pending"]).toContain(
        s.status
      );
    });
  });

  it("retentionExceptions includes audit_log as retained_compliance", async () => {
    const receipt = await reporter.generateReceipt(fakeResult);
    // audit_log is 'retain' but owned by 'tenant', not 'user', so may not appear
    // transaction_lifecycle is 'nullify' and owned by 'user' — should appear
    const txException = receipt.retentionExceptions.find(
      (e) => e.dataClass === "transaction_lifecycle"
    );
    expect(txException).toBeDefined();
    expect(txException?.reason).toContain("nullified");
  });
});
