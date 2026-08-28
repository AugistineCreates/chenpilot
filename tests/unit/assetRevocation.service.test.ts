/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for AssetRevocationService.
 *
 * Uses runtime spying (jest.spyOn) instead of module-level jest.mock
 * to avoid conflicts with tests/setup.ts which imports the real
 * AppDataSource before mocks take effect.
 */
import { AssetRevocation, RevocationReason, RevocationType } from "../../src/Security/assetRevocation.entity";
import AppDataSource from "../../src/config/Datasource";
import logger from "../../src/config/logger";

// Mock logger before importing the service
jest.spyOn(logger, "warn").mockImplementation(() => undefined as any);
jest.spyOn(logger, "info").mockImplementation(() => undefined as any);
jest.spyOn(logger, "error").mockImplementation(() => undefined as any);

import { AssetRevocationService } from "../../src/Security/assetRevocation.service";

// Helper to create a mock entity
function mockRevocation(overrides: Partial<AssetRevocation> = {}): AssetRevocation {
  const entry = new AssetRevocation();
  entry.id = overrides.id || "test-uuid";
  entry.type = overrides.type || "asset";
  entry.code = overrides.code || "SCAM";
  entry.reason = overrides.reason || "fraud";
  entry.scope = overrides.scope || "global";
  entry.userId = overrides.userId || null;
  entry.description = overrides.description || null;
  entry.expiresAt = overrides.expiresAt ?? null;
  entry.isActive = overrides.isActive ?? true;
  entry.addedBy = overrides.addedBy || "admin";
  entry.signature = overrides.signature || null;
  entry.signatureAlgorithm = overrides.signatureAlgorithm || null;
  entry.metadata = overrides.metadata || null;
  entry.createdAt = overrides.createdAt || new Date("2026-08-28T10:00:00Z");
  entry.updatedAt = overrides.updatedAt || new Date("2026-08-28T10:00:00Z");
  return entry;
}

describe("AssetRevocationService", () => {
  let service: AssetRevocationService;
  let mockRepo: any;
  let repoSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock repository
    mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    // Mock the query builder chain
    const mockQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getMany: jest.fn(),
    };
    mockRepo.createQueryBuilder.mockReturnValue(mockQb);

    // Spy on AppDataSource.getRepository to return mock
    repoSpy = jest.spyOn(AppDataSource, "getRepository").mockReturnValue(mockRepo);

    service = new AssetRevocationService();
  });

  afterEach(() => {
    repoSpy.mockRestore();
  });

  describe("revoke()", () => {
    it("should create and save a revocation entry", async () => {
      const savedEntry = mockRevocation();
      mockRepo.create.mockReturnValue(savedEntry);
      mockRepo.save.mockResolvedValue(savedEntry);

      const result = await service.revoke({
        type: "asset",
        code: "scam",
        reason: "fraud",
        addedBy: "admin",
      });

      expect(result.code).toBe("SCAM");
      expect(result.reason).toBe("fraud");
      expect(result.scope).toBe("global");
      expect(result.isActive).toBe(true);
      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
      expect(result.signature).toBeDefined();
      expect(result.signatureAlgorithm).toBe("sha256-hmac");
    });

    it("should normalize asset code to uppercase", async () => {
      const savedEntry = mockRevocation({ code: "USDC" });
      mockRepo.create.mockReturnValue(savedEntry);
      mockRepo.save.mockResolvedValue(savedEntry);

      const result = await service.revoke({
        type: "asset",
        code: "usdc",
        reason: "compromised",
      });

      expect(result.code).toBe("USDC");
    });
  });

  describe("isRevoked()", () => {
    it("should return revoked=true for an active global revocation", async () => {
      const entry = mockRevocation({ isActive: true, expiresAt: null });
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(entry),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.isRevoked("SCAM", "asset");

      expect(result.revoked).toBe(true);
      expect(result.entry?.code).toBe("SCAM");
    });

    it("should return revoked=false when no active revocation exists", async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.isRevoked("XLM", "asset");

      expect(result.revoked).toBe(false);
    });

    it("should return revoked=false for an expired revocation", async () => {
      const pastEntry = mockRevocation({
        isActive: true,
        expiresAt: new Date("2026-01-01T00:00:00Z"),
      });
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null), // expired entries filtered by query
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.isRevoked("SCAM", "asset");

      expect(result.revoked).toBe(false);
    });

    it("should return revoked=false for per_user scope when userId doesn't match", async () => {
      const entry = mockRevocation({
        scope: "per_user",
        userId: "user-A",
        isActive: true,
        expiresAt: null,
      });
      // First query (direct asset) finds the entry but scope doesn't match
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(entry),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.isRevoked("SCAM", "asset", "user-B");

      expect(result.revoked).toBe(false);
    });

    it("should return revoked=true for per_user scope when userId matches", async () => {
      const entry = mockRevocation({
        scope: "per_user",
        userId: "user-A",
        isActive: true,
        expiresAt: null,
      });
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(entry),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.isRevoked("SCAM", "asset", "user-A");

      expect(result.revoked).toBe(true);
    });
  });

  describe("checkAssetWithIssuer()", () => {
    it("should return revoked=true for directly revoked asset", async () => {
      const entry = mockRevocation({ type: "asset" });
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(entry),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.checkAssetWithIssuer("SCAM", "GABC...");

      expect(result.revoked).toBe(true);
    });

    it("should return revoked=true when issuer is revoked", async () => {
      const assetQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      const issuerEntry = mockRevocation({ type: "issuer" });
      const issuerQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(issuerEntry),
      };

      let callCount = 0;
      mockRepo.createQueryBuilder.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? assetQb : issuerQb;
      });

      const result = await service.checkAssetWithIssuer("USDC", "GABC...");

      expect(result.revoked).toBe(true);
      expect(result.reason).toContain("Issuer revocation");
    });

    it("should return revoked=false when neither asset nor issuer is revoked", async () => {
      const nullQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      mockRepo.createQueryBuilder.mockReturnValue(nullQb);

      const result = await service.checkAssetWithIssuer("USDC", "GABC...");

      expect(result.revoked).toBe(false);
    });
  });

  describe("revokeIssuer()", () => {
    it("should create an issuer revocation", async () => {
      const entry = mockRevocation({ type: "issuer", code: "GABC..." });
      mockRepo.create.mockReturnValue(entry);
      mockRepo.save.mockResolvedValue(entry);

      const result = await service.revokeIssuer("GABC...", "compromised", "admin");

      expect(result.type).toBe("issuer");
      expect(result.code).toBe("GABC...");
    });
  });

  describe("getActiveRevocations()", () => {
    it("should return active non-expired revocations", async () => {
      const entries = [mockRevocation(), mockRevocation({ code: "ETH" })];
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(entries),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getActiveRevocations();

      expect(result).toHaveLength(2);
    });
  });

  describe("getRevocationFeed()", () => {
    it("should return feed entries", async () => {
      const entries = [mockRevocation()];
      mockRepo.find.mockResolvedValue(entries);

      const result = await service.getRevocationFeed();

      expect(result).toHaveLength(1);
      expect(result[0].code).toBe("SCAM");
    });
  });

  describe("cleanupExpired()", () => {
    it("should mark expired entries as inactive", async () => {
      const expiredEntry = mockRevocation({ expiresAt: new Date("2026-01-01") });
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([expiredEntry]),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);
      mockRepo.save.mockResolvedValue(expiredEntry);

      const count = await service.cleanupExpired();

      expect(count).toBe(1);
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it("should return 0 when no expired entries exist", async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);

      const count = await service.cleanupExpired();

      expect(count).toBe(0);
    });
  });

  describe("verifySignature()", () => {
    it("should return false when signature is null", () => {
      const entry = {
        id: "1",
        type: "asset" as RevocationType,
        code: "SCAM",
        reason: "fraud" as RevocationReason,
        scope: "global" as const,
        userId: null,
        expiresAt: null,
        signature: null,
        signatureAlgorithm: null,
        createdAt: new Date(),
      };

      expect(service.verifySignature(entry)).toBe(false);
    });

    it("should verify a valid signature", () => {
      // Create an entry with a signature
      const entry = mockRevocation();
      const payload = [
        entry.type,
        entry.code,
        entry.reason,
        entry.scope,
        "",
        "",
        entry.createdAt.toISOString(),
      ].join("|");

      // Compute the expected signature using HMAC
      const { createHmac } = require("crypto");
      const secret = process.env.REVOCATION_SIGNING_KEY || "default-dev-signing-key";
      const expectedSig = createHmac("sha256", secret).update(payload).digest("hex");

      const feedEntry = {
        id: entry.id,
        type: entry.type,
        code: entry.code,
        reason: entry.reason,
        scope: entry.scope,
        userId: entry.userId,
        expiresAt: entry.expiresAt,
        signature: expectedSig,
        signatureAlgorithm: "sha256-hmac",
        createdAt: entry.createdAt,
      };

      expect(service.verifySignature(feedEntry)).toBe(true);
    });
  });

  describe("entity behavior", () => {
    it("should correctly report isCurrentlyRevoked for active non-expired entry", () => {
      const entry = mockRevocation({
        isActive: true,
        expiresAt: new Date(Date.now() + 86400000), // future
      });
      expect(entry.isCurrentlyRevoked()).toBe(true);
    });

    it("should report not revoked when isActive is false", () => {
      const entry = mockRevocation({ isActive: false });
      expect(entry.isCurrentlyRevoked()).toBe(false);
    });

    it("should report not revoked when expired", () => {
      const entry = mockRevocation({
        isActive: true,
        expiresAt: new Date("2020-01-01"),
      });
      expect(entry.isCurrentlyRevoked()).toBe(false);
    });

    it("should report revoked when no expiry and active", () => {
      const entry = mockRevocation({ isActive: true, expiresAt: null });
      expect(entry.isCurrentlyRevoked()).toBe(true);
    });
  });
});
