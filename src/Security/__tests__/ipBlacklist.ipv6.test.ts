import AppDataSource from "../../config/Datasource";
import IPBlacklistService from "../ipBlacklist.service";
import { IPBlacklist } from "../ipBlacklist.entity";

/**
 * IPv6 handling tests for IP Blacklist
 * Verifies that IPv6 addresses are properly normalized and blocked
 * Covers compressed, expanded, and IPv4-mapped IPv6 formats
 */

describe("IPBlacklist IPv6 Handling", () => {
  let ipBlacklistService: IPBlacklistService;
  let repository: any;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    ipBlacklistService = new IPBlacklistService();
    repository = AppDataSource.getRepository(IPBlacklist);
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  afterEach(async () => {
    // Clean up test entries
    await repository
      .createQueryBuilder()
      .delete()
      .where("ip_address LIKE :pattern", { pattern: "::%" })
      .orWhere("ip_address LIKE :pattern2", { pattern2: "2001:%" })
      .orWhere("ip_address = :ipv4", { ipv4: "192.0.2.1" })
      .execute();
  });

  describe("IPv4-Mapped IPv6 Addresses", () => {
    it("should normalize ::ffff:192.0.2.1 to 192.0.2.1", async () => {
      const ipv4MappedAddress = "::ffff:192.0.2.1";

      await ipBlacklistService.addToBlacklist(ipv4MappedAddress, {
        reason: "BRUTE_FORCE",
        description: "IPv4-mapped IPv6 address",
      });

      // Check with IPv4 equivalent
      const isBlacklisted = await ipBlacklistService.isBlacklisted("192.0.2.1");
      expect(isBlacklisted).toBe(true);
    });

    it("should block requests from IPv4-mapped IPv6 equivalent", async () => {
      const ipv4Address = "192.0.2.10";

      // Add IPv4 to blacklist
      await ipBlacklistService.addToBlacklist(ipv4Address, {
        reason: "MALICIOUS_ACTIVITY",
        description: "Direct IPv4 address",
      });

      // Check with IPv4-mapped IPv6 form
      const ipv4MappedForm = "::ffff:192.0.2.10";
      const isBlacklisted = await ipBlacklistService.isBlacklisted(ipv4MappedForm);
      expect(isBlacklisted).toBe(true);
    });

    it("should handle uppercase and lowercase ::FFFF variants", async () => {
      const uppercase = "::FFFF:192.0.2.20";
      const lowercase = "::ffff:192.0.2.20";

      await ipBlacklistService.addToBlacklist(uppercase, {
        reason: "DDOS_ATTACK",
      });

      // Both forms should be blocked
      const upperBlacklisted =
        await ipBlacklistService.isBlacklisted(uppercase);
      const lowerBlacklisted =
        await ipBlacklistService.isBlacklisted(lowercase);

      expect(upperBlacklisted).toBe(true);
      expect(lowerBlacklisted).toBe(true);
    });
  });

  describe("Compressed IPv6 Addresses", () => {
    it("should normalize compressed IPv6 to canonical form", async () => {
      const compressedAddress = "2001:db8::1";

      await ipBlacklistService.addToBlacklist(compressedAddress, {
        reason: "BRUTE_FORCE",
        description: "Compressed IPv6 address",
      });

      // Check with the same address
      const isBlacklisted = await ipBlacklistService.isBlacklisted(
        compressedAddress
      );
      expect(isBlacklisted).toBe(true);
    });

    it("should block expanded form of compressed IPv6", async () => {
      const compressedAddress = "2001:db8::1";

      await ipBlacklistService.addToBlacklist(compressedAddress, {
        reason: "MALICIOUS_ACTIVITY",
      });

      // Expanded form should also be blocked
      const expandedAddress = "2001:0db8:0000:0000:0000:0000:0000:0001";
      const isBlacklisted = await ipBlacklistService.isBlacklisted(
        expandedAddress
      );
      expect(isBlacklisted).toBe(true);
    });

    it("should handle double colon :: compression", async () => {
      const addresses = [
        "2001:db8::1",
        "::1", // Loopback
        "fe80::1", // Link-local
        "ff00::1", // Multicast
      ];

      for (const addr of addresses) {
        const result = await ipBlacklistService.addToBlacklist(addr, {
          reason: "SPAM",
        });
        expect(result).toBeDefined();
        expect(result.ipAddress).toBeDefined();
      }
    });
  });

  describe("IPv6 Localhost and Special Addresses", () => {
    it("should handle IPv6 localhost ::1", async () => {
      const ipv6Localhost = "::1";

      await ipBlacklistService.addToBlacklist(ipv6Localhost, {
        reason: "BRUTE_FORCE",
      });

      const isBlacklisted = await ipBlacklistService.isBlacklisted(
        ipv6Localhost
      );
      expect(isBlacklisted).toBe(true);
    });

    it("should handle IPv6 unspecified address ::", async () => {
      const unspecified = "::";

      await ipBlacklistService.addToBlacklist(unspecified, {
        reason: "MALICIOUS_ACTIVITY",
      });

      const isBlacklisted = await ipBlacklistService.isBlacklisted(unspecified);
      expect(isBlacklisted).toBe(true);
    });

    it("should handle link-local addresses", async () => {
      const linkLocal = "fe80::1";

      await ipBlacklistService.addToBlacklist(linkLocal, {
        reason: "SPAM",
      });

      const isBlacklisted = await ipBlacklistService.isBlacklisted(linkLocal);
      expect(isBlacklisted).toBe(true);
    });
  });

  describe("IPv6 with Port Numbers", () => {
    it("should strip port from IPv6 addresses in brackets", async () => {
      const ipv6WithPort = "[2001:db8::1]:8080";

      // The service should handle port removal
      const result = await ipBlacklistService.addToBlacklist(ipv6WithPort, {
        reason: "DDOS_ATTACK",
      });

      // Should be stored without port
      expect(result.ipAddress).toBeDefined();
      expect(result.ipAddress).not.toContain(":8080");
    });
  });

  describe("Case Sensitivity in IPv6", () => {
    it("should treat uppercase and lowercase IPv6 addresses as equal", async () => {
      const lowercase = "2001:db8::abcd";
      const uppercase = "2001:DB8::ABCD";

      await ipBlacklistService.addToBlacklist(lowercase, {
        reason: "BRUTE_FORCE",
      });

      // Uppercase should be blocked too
      const isBlacklisted = await ipBlacklistService.isBlacklisted(uppercase);
      expect(isBlacklisted).toBe(true);
    });
  });

  describe("IPv6 Bypass Prevention", () => {
    it("should prevent bypass using different IPv6 representations of same address", async () => {
      const compressedForm = "2001:db8::1";
      const expandedForm = "2001:0db8:0000:0000:0000:0000:0000:0001";
      const alternateCompressed = "2001:db8:0:0:0:0:0:1";

      await ipBlacklistService.addToBlacklist(compressedForm, {
        reason: "MALICIOUS_ACTIVITY",
      });

      // All forms should be recognized as the same address
      const compressed = await ipBlacklistService.isBlacklisted(compressedForm);
      const expanded = await ipBlacklistService.isBlacklisted(expandedForm);
      const alternate = await ipBlacklistService.isBlacklisted(
        alternateCompressed
      );

      expect(compressed).toBe(true);
      expect(expanded).toBe(true);
      expect(alternate).toBe(true);
    });

    it("should prevent bypass using IPv4-mapped form", async () => {
      const ipv4Address = "192.0.2.5";
      const ipv4MappedForm = "::ffff:192.0.2.5";

      await ipBlacklistService.addToBlacklist(ipv4Address, {
        reason: "BRUTE_FORCE",
      });

      const ipv4Result = await ipBlacklistService.isBlacklisted(ipv4Address);
      const ipv4MappedResult = await ipBlacklistService.isBlacklisted(
        ipv4MappedForm
      );

      expect(ipv4Result).toBe(true);
      expect(ipv4MappedResult).toBe(true);
    });
  });

  describe("IPv6 Entry Retrieval", () => {
    it("should retrieve IPv6 entry regardless of representation", async () => {
      const compressedAddress = "2001:db8::cafe";

      await ipBlacklistService.addToBlacklist(compressedAddress, {
        reason: "SPAM",
        description: "IPv6 spam source",
      });

      // Retrieve with expanded form
      const expandedForm = "2001:0db8:0000:0000:0000:0000:0000:cafe";
      const entry = await ipBlacklistService.getBlacklistEntry(expandedForm);

      expect(entry).toBeDefined();
      expect(entry?.description).toBe("IPv6 spam source");
    });
  });

  describe("Mixed IPv4 and IPv6 in Blacklist", () => {
    it("should handle mixed IPv4 and IPv6 addresses", async () => {
      const ipv4 = "192.0.2.1";
      const ipv6 = "2001:db8::1";

      await ipBlacklistService.addToBlacklist(ipv4, {
        reason: "BRUTE_FORCE",
      });
      await ipBlacklistService.addToBlacklist(ipv6, {
        reason: "MALICIOUS_ACTIVITY",
      });

      const ipv4Blocked = await ipBlacklistService.isBlacklisted(ipv4);
      const ipv6Blocked = await ipBlacklistService.isBlacklisted(ipv6);

      expect(ipv4Blocked).toBe(true);
      expect(ipv6Blocked).toBe(true);
    });
  });
});
