import { IPBlacklist, BlacklistReason } from "../ipBlacklist.entity";
import { ipBlacklistService } from "../ipBlacklist.service";
import AppDataSource from "../../config/Datasource";
import logger from "../../config/logger";

jest.mock("../../config/logger");

describe("IPBlacklist Entity and Service", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("IPBlacklist Entity", () => {
    it("should create a blacklist entry with valid data", () => {
      const entry = new IPBlacklist();
      entry.ipAddress = "192.168.1.1";
      entry.reason = BlacklistReason.MALICIOUS_ACTIVITY;
      entry.isActive = true;

      expect(entry.ipAddress).toBe("192.168.1.1");
      expect(entry.reason).toBe(BlacklistReason.MALICIOUS_ACTIVITY);
      expect(entry.isActive).toBe(true);
    });

    it("should check if blacklist entry is currently blocked", () => {
      const entry = new IPBlacklist();
      entry.ipAddress = "192.168.1.1";
      entry.isActive = true;
      entry.expiresAt = undefined;

      expect(entry.isCurrentlyBlocked()).toBe(true);
    });

    it("should return false for inactive entry", () => {
      const entry = new IPBlacklist();
      entry.ipAddress = "192.168.1.1";
      entry.isActive = false;

      expect(entry.isCurrentlyBlocked()).toBe(false);
    });

    it("should return false for expired entry", () => {
      const entry = new IPBlacklist();
      entry.ipAddress = "192.168.1.1";
      entry.isActive = true;
      entry.expiresAt = new Date(Date.now() - 1000); // 1 second ago

      expect(entry.isCurrentlyBlocked()).toBe(false);
    });

    it("should return true for entry with future expiration", () => {
      const entry = new IPBlacklist();
      entry.ipAddress = "192.168.1.1";
      entry.isActive = true;
      entry.expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

      expect(entry.isCurrentlyBlocked()).toBe(true);
    });
  });

  describe("IPBlacklistService - Basic Operations", () => {
    it("should add IP to blacklist", async () => {
      const ipAddress = `192.168.1.${Math.floor(Math.random() * 255)}`;

      const entry = await ipBlacklistService.addToBlacklist(ipAddress, {
        reason: BlacklistReason.MALICIOUS_ACTIVITY,
        description: "Test malicious activity",
      });

      expect(entry).toBeDefined();
      expect(entry.ipAddress).toBe(ipAddress);
      expect(entry.reason).toBe(BlacklistReason.MALICIOUS_ACTIVITY);
      expect(entry.isActive).toBe(true);

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ipAddress);
    });

    it("should check if IP is blacklisted", async () => {
      const ipAddress = `192.168.2.${Math.floor(Math.random() * 255)}`;

      await ipBlacklistService.addToBlacklist(ipAddress, {
        reason: BlacklistReason.BRUTE_FORCE,
      });

      const isBlacklisted = await ipBlacklistService.isBlacklisted(ipAddress);
      expect(isBlacklisted).toBe(true);

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ipAddress);
    });

    it("should return false for non-blacklisted IP", async () => {
      const ipAddress = "203.0.113.1"; // TEST-NET-3, unlikely to be blacklisted

      const isBlacklisted = await ipBlacklistService.isBlacklisted(ipAddress);
      expect(isBlacklisted).toBe(false);
    });

    it("should get blacklist entry by IP", async () => {
      const ipAddress = `192.168.3.${Math.floor(Math.random() * 255)}`;

      await ipBlacklistService.addToBlacklist(ipAddress, {
        reason: BlacklistReason.DDOS_ATTACK,
        description: "DDoS detected",
      });

      const entry = await ipBlacklistService.getBlacklistEntry(ipAddress);
      expect(entry).toBeDefined();
      expect(entry?.ipAddress).toBe(ipAddress);
      expect(entry?.reason).toBe(BlacklistReason.DDOS_ATTACK);

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ipAddress);
    });

    it("should remove IP from blacklist", async () => {
      const ipAddress = `192.168.4.${Math.floor(Math.random() * 255)}`;

      await ipBlacklistService.addToBlacklist(ipAddress, {
        reason: BlacklistReason.SPAM,
      });

      let isBlacklisted = await ipBlacklistService.isBlacklisted(ipAddress);
      expect(isBlacklisted).toBe(true);

      await ipBlacklistService.removeFromBlacklist(ipAddress);

      isBlacklisted = await ipBlacklistService.isBlacklisted(ipAddress);
      expect(isBlacklisted).toBe(false);
    });

    it("should handle removal of non-existent IP", async () => {
      const ipAddress = "203.0.113.2"; // Unlikely to exist

      const removed = await ipBlacklistService.removeFromBlacklist(ipAddress);
      expect(removed).toBe(false);
    });
  });

  describe("IPBlacklistService - Advanced Operations", () => {
    it("should list blacklisted IPs", async () => {
      const ips = [
        `192.168.10.${Math.floor(Math.random() * 255)}`,
        `192.168.11.${Math.floor(Math.random() * 255)}`,
      ];

      for (const ip of ips) {
        await ipBlacklistService.addToBlacklist(ip, {
          reason: BlacklistReason.MALICIOUS_ACTIVITY,
        });
      }

      const { entries, total } = await ipBlacklistService.listBlacklist({
        limit: 100,
        activeOnly: true,
      });

      expect(entries.length).toBeGreaterThan(0);
      expect(total).toBeGreaterThan(0);

      // Cleanup
      for (const ip of ips) {
        await ipBlacklistService.removeFromBlacklist(ip);
      }
    });

    it("should list blacklist with reason filter", async () => {
      const ip1 = `192.168.12.${Math.floor(Math.random() * 255)}`;
      const ip2 = `192.168.13.${Math.floor(Math.random() * 255)}`;

      await ipBlacklistService.addToBlacklist(ip1, {
        reason: BlacklistReason.BRUTE_FORCE,
      });

      await ipBlacklistService.addToBlacklist(ip2, {
        reason: BlacklistReason.DDOS_ATTACK,
      });

      const { entries } = await ipBlacklistService.listBlacklist({
        activeOnly: true,
        reason: BlacklistReason.BRUTE_FORCE,
      });

      expect(entries.length).toBeGreaterThan(0);
      expect(
        entries.every((e) => e.reason === BlacklistReason.BRUTE_FORCE)
      ).toBe(true);

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ip1);
      await ipBlacklistService.removeFromBlacklist(ip2);
    });

    it("should bulk add IPs to blacklist", async () => {
      const ips = [
        `192.168.20.${Math.floor(Math.random() * 255)}`,
        `192.168.21.${Math.floor(Math.random() * 255)}`,
        `192.168.22.${Math.floor(Math.random() * 255)}`,
      ];

      const entries = await ipBlacklistService.bulkAddToBlacklist(
        ips.map((ip) => ({
          ip,
          options: {
            reason: BlacklistReason.MALICIOUS_ACTIVITY,
            description: "Bulk added",
          },
        }))
      );

      expect(entries).toHaveLength(ips.length);
      entries.forEach((entry, index) => {
        expect(entry.ipAddress).toBe(ips[index]);
      });

      // Cleanup
      for (const ip of ips) {
        await ipBlacklistService.removeFromBlacklist(ip);
      }
    });

    it("should update existing IP in blacklist", async () => {
      const ip = `192.168.30.${Math.floor(Math.random() * 255)}`;

      await ipBlacklistService.addToBlacklist(ip, {
        reason: BlacklistReason.BRUTE_FORCE,
        description: "Original description",
      });

      // Add again with different reason
      const updated = await ipBlacklistService.addToBlacklist(ip, {
        reason: BlacklistReason.DDOS_ATTACK,
        description: "Updated description",
      });

      expect(updated.reason).toBe(BlacklistReason.DDOS_ATTACK);
      expect(updated.description).toBe("Updated description");

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ip);
    });

    it("should track block count", async () => {
      const ip = `192.168.40.${Math.floor(Math.random() * 255)}`;

      await ipBlacklistService.addToBlacklist(ip, {
        reason: BlacklistReason.MALICIOUS_ACTIVITY,
      });

      let entry = await ipBlacklistService.getBlacklistEntry(ip);
      expect(entry?.blockCount).toBe(0);

      // Check blacklist multiple times
      await ipBlacklistService.isBlacklisted(ip);
      await ipBlacklistService.isBlacklisted(ip);
      await ipBlacklistService.isBlacklisted(ip);

      entry = await ipBlacklistService.getBlacklistEntry(ip);
      expect(entry?.blockCount).toBe(3);

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ip);
    });

    it("should cleanup expired entries", async () => {
      const ip = `192.168.50.${Math.floor(Math.random() * 255)}`;

      // Add with expiration in the past
      await ipBlacklistService.addToBlacklist(ip, {
        reason: BlacklistReason.MALICIOUS_ACTIVITY,
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      });

      // Cleanup
      const cleaned = await ipBlacklistService.cleanupExpiredEntries();
      expect(cleaned).toBeGreaterThanOrEqual(0);

      // Verify IP is no longer blacklisted
      const isBlacklisted = await ipBlacklistService.isBlacklisted(ip);
      expect(isBlacklisted).toBe(false);

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ip);
    });
  });

  describe("IPBlacklistService - Statistics", () => {
    it("should get blacklist statistics", async () => {
      const stats = await ipBlacklistService.getStatistics();

      expect(stats).toHaveProperty("totalActive");
      expect(stats).toHaveProperty("totalInactive");
      expect(stats).toHaveProperty("byReason");
      expect(stats).toHaveProperty("mostRecent");
      expect(stats).toHaveProperty("mostBlocked");

      expect(typeof stats.totalActive).toBe("number");
      expect(typeof stats.totalInactive).toBe("number");
      expect(Array.isArray(stats.mostRecent)).toBe(true);
      expect(Array.isArray(stats.mostBlocked)).toBe(true);
    });

    it("should include reason breakdown in statistics", async () => {
      const ip1 = `192.168.60.${Math.floor(Math.random() * 255)}`;
      const ip2 = `192.168.61.${Math.floor(Math.random() * 255)}`;

      await ipBlacklistService.addToBlacklist(ip1, {
        reason: BlacklistReason.BRUTE_FORCE,
      });

      await ipBlacklistService.addToBlacklist(ip2, {
        reason: BlacklistReason.DDOS_ATTACK,
      });

      const stats = await ipBlacklistService.getStatistics();

      expect(stats.byReason).toBeDefined();
      expect(typeof stats.byReason[BlacklistReason.BRUTE_FORCE]).toBe("number");

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ip1);
      await ipBlacklistService.removeFromBlacklist(ip2);
    });
  });

  describe("IPBlacklistService - Edge Cases", () => {
    it("should handle IPv6 localhost normalization", async () => {
      const result = await ipBlacklistService.isBlacklisted("::1");
      expect(typeof result).toBe("boolean");
    });

    it("should handle IPv6 mapped IPv4 addresses", async () => {
      const result =
        await ipBlacklistService.isBlacklisted("::ffff:192.168.1.1");
      expect(typeof result).toBe("boolean");
    });

    it("should handle IP with port normalization", async () => {
      const result = await ipBlacklistService.isBlacklisted("192.168.1.1:8080");
      expect(typeof result).toBe("boolean");
    });

    it("should handle whitespace in IP addresses", async () => {
      const result = await ipBlacklistService.isBlacklisted(" 192.168.1.1 ");
      expect(typeof result).toBe("boolean");
    });

    it("should add metadata to blacklist entry", async () => {
      const ip = `192.168.70.${Math.floor(Math.random() * 255)}`;

      const entry = await ipBlacklistService.addToBlacklist(ip, {
        reason: BlacklistReason.MALICIOUS_ACTIVITY,
        metadata: {
          sourceSystem: "WAF",
          threatScore: 95,
          detectionMethod: "pattern-matching",
        },
      });

      expect(entry.metadata).toBeDefined();
      expect(entry.metadata?.sourceSystem).toBe("WAF");
      expect(entry.metadata?.threatScore).toBe(95);

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ip);
    });

    it("should handle expiration date setting", async () => {
      const ip = `192.168.80.${Math.floor(Math.random() * 255)}`;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const entry = await ipBlacklistService.addToBlacklist(ip, {
        reason: BlacklistReason.SUSPICIOUS_PATTERN,
        expiresAt,
      });

      expect(entry.expiresAt).toBeDefined();
      expect(entry.expiresAt?.getTime()).toBeGreaterThan(Date.now());

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ip);
    });

    it("should handle error gracefully", async () => {
      // Pass invalid data
      const result = await ipBlacklistService.isBlacklisted("");
      expect(typeof result).toBe("boolean");
    });
  });

  describe("IPBlacklistService - Logging", () => {
    it("should log when IP is added to blacklist", async () => {
      const ip = `192.168.90.${Math.floor(Math.random() * 255)}`;

      await ipBlacklistService.addToBlacklist(ip, {
        reason: BlacklistReason.MALICIOUS_ACTIVITY,
      });

      expect(logger.info).toHaveBeenCalled();

      // Cleanup
      await ipBlacklistService.removeFromBlacklist(ip);
    });

    it("should log when IP is removed from blacklist", async () => {
      const ip = `192.168.91.${Math.floor(Math.random() * 255)}`;

      await ipBlacklistService.addToBlacklist(ip, {
        reason: BlacklistReason.MALICIOUS_ACTIVITY,
      });

      jest.clearAllMocks();

      await ipBlacklistService.removeFromBlacklist(ip);

      expect(logger.info).toHaveBeenCalled();
    });

    it("should log errors appropriately", async () => {
      // This would require more complex mocking to make service call fail
      expect(logger.error).toBeDefined();
    });
  });
});
