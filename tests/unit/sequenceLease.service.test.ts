/**
 * Unit tests for SequenceLeaseService.
 *
 * Uses runtime-level spying on all dependencies to avoid conflicts with
 * tests/setup.ts importing real modules before jest.mock takes effect.
 */
import { describe, it, expect, beforeEach, jest, afterEach } from "@jest/globals";

import { SequenceLeaseService } from "../../src/services/sequence/SequenceLease.service";
import AppDataSource from "../../src/config/Datasource";
import logger from "../../src/config/logger";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeLease(overrides: Record<string, unknown> = {}) {
  return {
    id: "lease-1",
    accountPublicKey: "GABC...",
    leasedSequence: 101,
    fencingToken: 1,
    ownerId: "worker-1",
    status: "reserved",
    reservedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    txHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function fakeHorizonAccount(sequence: number = 100) {
  return {
    accountId: () => "GABC...",
    sequenceNumber: () => sequence.toString(),
    incrementSequenceNumber: () => {},
  } as any;
}

function makeMockQb(overrides: Record<string, any> = {}) {
  return {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(null),
    getOne: jest.fn().mockResolvedValue(null),
    getMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SequenceLeaseService", () => {
  let service: SequenceLeaseService;
  let transactionSpy: jest.SpiedFunction<typeof AppDataSource.transaction>;
  let loggerSpies: Record<string, jest.SpyInstance>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SequenceLeaseService();

    // Spy on logger methods at runtime
    loggerSpies = {
      info: jest.spyOn(logger, "info").mockImplementation(() => {}),
      warn: jest.spyOn(logger, "warn").mockImplementation(() => {}),
      error: jest.spyOn(logger, "error").mockImplementation(() => {}),
      debug: jest.spyOn(logger, "debug").mockImplementation(() => {}),
    };

    // Spy on AppDataSource.transaction at runtime
    transactionSpy = jest.spyOn(AppDataSource, "transaction").mockImplementation(
      (fn: any) => fn({})
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── acquireLease ────────────────────────────────────────────────────────

  describe("acquireLease", () => {
    it("allocates sequence = max(onChain, local) + 1", async () => {
      const horizon = { loadAccount: jest.fn().mockResolvedValue(fakeHorizonAccount(100)) } as any;

      transactionSpy.mockImplementation(async (fn: any) => {
        const mgr = {
          create: jest.fn().mockReturnValue(fakeLease()),
          save: jest.fn().mockImplementation(async (e: any) => ({ ...e, id: "new" })),
          createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
            getRawOne: jest.fn().mockResolvedValue({ maxSeq: "95" }),
          })),
        };
        return fn(mgr);
      });

      const result = await service.acquireLease("GABC...", "worker-1", 60_000, horizon);
      expect(result.sequenceNumber).toBe(101); // max(100, 95) + 1
      expect(result.fencingToken).toBe(1);
    });

    it("falls back to local max when Horizon fails", async () => {
      const horizon = { loadAccount: jest.fn().mockRejectedValue(new Error("down")) } as any;

      transactionSpy.mockImplementation(async (fn: any) => {
        const mgr = {
          create: jest.fn().mockReturnValue(fakeLease()),
          save: jest.fn().mockImplementation(async (e: any) => e),
          createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
            getRawOne: jest.fn().mockResolvedValue({ maxSeq: "200" }),
          })),
        };
        return fn(mgr);
      });

      const result = await service.acquireLease("GABC...", "w1", 60_000, horizon);
      expect(result.sequenceNumber).toBe(201);
    });

    it("increments fencing token for existing account", async () => {
      const horizon = { loadAccount: jest.fn().mockResolvedValue(fakeHorizonAccount(50)) } as any;

      transactionSpy.mockImplementation(async (fn: any) => {
        let callCount = 0;
        const mgr = {
          create: jest.fn().mockReturnValue(fakeLease()),
          save: jest.fn().mockImplementation(async (e: any) => e),
          createQueryBuilder: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getRawOne: jest.fn().mockImplementation(() => {
              callCount++;
              return Promise.resolve(callCount === 1 ? { maxSeq: "50" } : { maxToken: "3" });
            }),
          }),
        };
        return fn(mgr);
      });

      const result = await service.acquireLease("GABC...", "w1", 60_000, horizon);
      expect(result.fencingToken).toBe(4);
    });
  });

  // ── consumeLease ────────────────────────────────────────────────────────

  describe("consumeLease", () => {
    it("consumes a valid reserved lease", async () => {
      const lease = fakeLease();
      transactionSpy.mockImplementation(async (fn: any) => {
        const mgr = {
          findOne: jest.fn().mockResolvedValue(lease),
          save: jest.fn().mockImplementation(async (e: any) => ({ ...e, status: "consumed" })),
          createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
            getOne: jest.fn().mockResolvedValue(null),
          })),
        };
        return fn(mgr);
      });

      const result = await service.consumeLease("lease-1", "worker-1", "tx-hash-123");
      expect(result.status).toBe("consumed");
      expect(result.txHash).toBe("tx-hash-123");
    });

    it("rejects non-existent lease", async () => {
      transactionSpy.mockImplementation(async (fn: any) => {
        return fn({ findOne: jest.fn().mockResolvedValue(null) });
      });

      await expect(service.consumeLease("bad", "w1", "tx")).rejects.toThrow("not found");
    });

    it("rejects already-consumed lease", async () => {
      transactionSpy.mockImplementation(async (fn: any) => {
        return fn({ findOne: jest.fn().mockResolvedValue(fakeLease({ status: "consumed" })) });
      });

      await expect(service.consumeLease("lease-1", "worker-1", "tx")).rejects.toThrow("not in reserved status");
    });

    it("rejects expired lease", async () => {
      transactionSpy.mockImplementation(async (fn: any) => {
        const mgr = {
          findOne: jest.fn().mockResolvedValue(fakeLease({ expiresAt: new Date(Date.now() - 10_000) })),
          save: jest.fn().mockImplementation(async (e: any) => e),
        };
        return fn(mgr);
      });

      await expect(service.consumeLease("lease-1", "w1", "tx")).rejects.toThrow("expired");
    });

    it("rejects when superseded (fencing)", async () => {
      const lease = fakeLease({ fencingToken: 1, ownerId: "worker-1" });
      const newer = fakeLease({ id: "lease-2", fencingToken: 2 });

      transactionSpy.mockImplementation(async (fn: any) => {
        const mgr = {
          findOne: jest.fn().mockResolvedValue(lease),
          save: jest.fn().mockImplementation(async (e: any) => e),
          createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
            getOne: jest.fn().mockResolvedValue(newer),
          })),
        };
        return fn(mgr);
      });

      await expect(service.consumeLease("lease-1", "worker-1", "tx")).rejects.toThrow("superseded");
    });

    it("rejects wrong owner", async () => {
      transactionSpy.mockImplementation(async (fn: any) => {
        return fn({ findOne: jest.fn().mockResolvedValue(fakeLease({ ownerId: "worker-A" })) });
      });

      await expect(service.consumeLease("lease-1", "worker-B", "tx")).rejects.toThrow("worker-A");
    });
  });

  // ── validateLease ──────────────────────────────────────────────────────

  describe("validateLease", () => {
    it("returns lease when valid", async () => {
      const lease = fakeLease({ fencingToken: 5 });
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        findOne: jest.fn().mockResolvedValue(lease),
        createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
          getOne: jest.fn().mockResolvedValue(null),
        })),
      } as any);

      const result = await service.validateLease("lease-1", 5);
      expect(result.id).toBe("lease-1");
    });

    it("rejects fencing token mismatch", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        findOne: jest.fn().mockResolvedValue(fakeLease({ fencingToken: 5 })),
      } as any);

      await expect(service.validateLease("lease-1", 99)).rejects.toThrow("fencing token mismatch");
    });

    it("rejects when superseded", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        findOne: jest.fn().mockResolvedValue(fakeLease({ fencingToken: 5 })),
        createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
          getOne: jest.fn().mockResolvedValue(fakeLease({ fencingToken: 6 })),
        })),
      } as any);

      await expect(service.validateLease("lease-1", 5)).rejects.toThrow("superseded");
    });

    it("rejects non-existent lease", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        findOne: jest.fn().mockResolvedValue(null),
      } as any);

      await expect(service.validateLease("bad", 1)).rejects.toThrow("not found");
    });

    it("rejects non-reserved lease", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        findOne: jest.fn().mockResolvedValue(fakeLease({ status: "consumed" })),
      } as any);

      await expect(service.validateLease("lease-1", 1)).rejects.toThrow("not reserved");
    });

    it("rejects expired lease", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        findOne: jest.fn().mockResolvedValue(fakeLease({ expiresAt: new Date(Date.now() - 5000) })),
      } as any);

      await expect(service.validateLease("lease-1", 1)).rejects.toThrow("expired");
    });
  });

  // ── expireAndReclaim ────────────────────────────────────────────────────

  describe("expireAndReclaim", () => {
    it("reclaims expired reserved leases", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
          getMany: jest.fn().mockResolvedValue([fakeLease({ expiresAt: new Date(Date.now() - 5000) })]),
        })),
        save: jest.fn().mockImplementation(async (e: any) => ({ ...e, status: "reclaimed" })),
      } as any);

      const result = await service.expireAndReclaim();
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("reclaimed");
    });

    it("returns empty when no stale leases", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
          getMany: jest.fn().mockResolvedValue([]),
        })),
      } as any);

      const result = await service.expireAndReclaim();
      expect(result).toHaveLength(0);
    });
  });

  // ── reconcileWithOnChain ────────────────────────────────────────────────

  describe("reconcileWithOnChain", () => {
    it("detects gap between on-chain and local consumed", async () => {
      const horizon = { loadAccount: jest.fn().mockResolvedValue(fakeHorizonAccount(110)) } as any;
      let callCount = 0;
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockImplementation(() => {
            callCount++;
            return Promise.resolve(callCount === 1 ? { maxSeq: "105" } : null);
          }),
          getMany: jest.fn().mockResolvedValue([]),
        }),
      } as any);

      const result = await service.reconcileWithOnChain("GABC...", horizon);
      expect(Number(result.onChainSequence)).toBe(110);
      expect(result.highestConsumedLocal).toBe(105);
      expect(result.gapSize).toBe(5);
    });

    it("reclaims stale reserved leases", async () => {
      const horizon = { loadAccount: jest.fn().mockResolvedValue(fakeHorizonAccount(100)) } as any;
      const staleLease = fakeLease({ leasedSequence: 98, status: "reserved" });
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
          getRawOne: jest.fn().mockResolvedValue({ maxSeq: "98" }),
          getMany: jest.fn().mockResolvedValue([staleLease]),
        })),
        save: jest.fn().mockImplementation(async (e: any) => ({ ...e, status: "reclaimed" })),
      } as any);

      const result = await service.reconcileWithOnChain("GABC...", horizon);
      expect(result.reclaimedLeases).toBe(1);
      expect(result.staleLeases).toHaveLength(1);
    });
  });

  // ── getActiveLease / getCurrentFencingToken ─────────────────────────────

  describe("getActiveLease", () => {
    it("returns lease", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        findOne: jest.fn().mockResolvedValue(fakeLease({ fencingToken: 5 })),
      } as any);

      const result = await service.getActiveLease("GABC...");
      expect(result?.fencingToken).toBe(5);
    });

    it("returns null when none", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        findOne: jest.fn().mockResolvedValue(null),
      } as any);

      expect(await service.getActiveLease("GABC...")).toBeNull();
    });
  });

  describe("getCurrentFencingToken", () => {
    it("returns max token", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
          getRawOne: jest.fn().mockResolvedValue({ maxToken: "7" }),
        })),
      } as any);

      expect(await service.getCurrentFencingToken("GABC...")).toBe(7);
    });

    it("returns 0 when none", async () => {
      jest.spyOn(AppDataSource, "getRepository").mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(makeMockQb({
          getRawOne: jest.fn().mockResolvedValue(null),
        })),
      } as any);

      expect(await service.getCurrentFencingToken("GABC...")).toBe(0);
    });
  });
});
