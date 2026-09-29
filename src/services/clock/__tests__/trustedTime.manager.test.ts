import { TrustedTimeManager } from "../trustedTime.manager";
import { ClockSkewService } from "../clockSkew.service";
import { ClockSample } from "../types";

describe("TrustedTimeManager", () => {
  let manager: TrustedTimeManager;
  let clockSkew: ClockSkewService;

  beforeEach(() => {
    clockSkew = new ClockSkewService({
      degradedThresholdMs: 5000,
      criticalThresholdMs: 30000,
    });
    manager = new TrustedTimeManager(clockSkew);
  });

  describe("hasExpired", () => {
    it("should detect expired timestamp", () => {
      const now = new Date();
      const expiryTime = new Date(now.getTime() - 1000);

      expect(manager.hasExpired(expiryTime, now)).toBe(true);
    });

    it("should detect valid timestamp", () => {
      const now = new Date();
      const expiryTime = new Date(now.getTime() + 10000);

      expect(manager.hasExpired(expiryTime, now)).toBe(false);
    });

    it("should apply safety margin", () => {
      const now = new Date();
      manager.setSafetyMargin(5000);

      // Token expires in 6 seconds, but with 5 second safety margin,
      // it should be considered expired
      const expiryTime = new Date(now.getTime() + 6000);

      expect(manager.hasExpired(expiryTime, now)).toBe(true);
    });

    it("should use current time if not provided", () => {
      const expiryTime = new Date(Date.now() + 10000);
      expect(manager.hasExpired(expiryTime)).toBe(false);
    });
  });

  describe("isValid", () => {
    it("should return opposite of hasExpired", () => {
      const now = new Date();
      const expiryTime = new Date(now.getTime() + 10000);

      expect(manager.isValid(expiryTime, now)).toBe(true);
      expect(manager.isValid(new Date(now.getTime() - 1000), now)).toBe(false);
    });
  });

  describe("areTimesEqual", () => {
    it("should return true for identical times", () => {
      const time1 = new Date();
      const time2 = new Date(time1.getTime());

      expect(manager.areTimesEqual(time1, time2)).toBe(true);
    });

    it("should return true for times within tolerance", () => {
      const time1 = new Date();
      const time2 = new Date(time1.getTime() + 3000);

      manager.setSafetyMargin(5000);
      expect(manager.areTimesEqual(time1, time2)).toBe(true);
    });

    it("should return false for times outside tolerance", () => {
      const time1 = new Date();
      const time2 = new Date(time1.getTime() + 10000);

      manager.setSafetyMargin(5000);
      expect(manager.areTimesEqual(time1, time2)).toBe(false);
    });

    it("should use custom tolerance if provided", () => {
      const time1 = new Date();
      const time2 = new Date(time1.getTime() + 100);

      expect(manager.areTimesEqual(time1, time2, 50)).toBe(false);
      expect(manager.areTimesEqual(time1, time2, 200)).toBe(true);
    });
  });

  describe("compareTimesDetailed", () => {
    it("should return detailed comparison", () => {
      const time1 = new Date();
      const time2 = new Date(time1.getTime() + 3000);

      manager.setSafetyMargin(5000);
      const result = manager.compareTimesDetailed(time1, time2);

      expect(result.diffMs).toBe(3000);
      expect(result.isSafe).toBe(true);
      expect(result.safetyMarginMs).toBe(5000);
      expect(result.reason).toContain("within tolerance");
    });
  });

  describe("getFutureDeadline", () => {
    it("should return future date", () => {
      const deadline = manager.getFutureDeadline(10000);
      expect(deadline.getTime()).toBeGreaterThan(Date.now());
    });

    it("should subtract safety margin from duration", () => {
      manager.setSafetyMargin(5000);
      const deadline = manager.getFutureDeadline(10000);

      // Should be approximately now + 5000 (10000 - 5000)
      const now = Date.now();
      const diff = deadline.getTime() - now;
      expect(diff).toBeGreaterThanOrEqual(4000);
      expect(diff).toBeLessThanOrEqual(6000);
    });
  });

  describe("getNow", () => {
    it("should return current time", () => {
      const before = Date.now();
      const now = manager.getNow().getTime();
      const after = Date.now();

      expect(now).toBeGreaterThanOrEqual(before);
      expect(now).toBeLessThanOrEqual(after + 100);
    });
  });

  describe("setSafetyMargin", () => {
    it("should update safety margin", () => {
      manager.setSafetyMargin(10000);
      expect(manager.getSafetyMargin()).toBe(10000);
    });

    it("should reject negative margin", () => {
      expect(() => manager.setSafetyMargin(-1000)).toThrow();
    });
  });

  describe("isLeaseSafe", () => {
    it("should return true for safe lease", () => {
      const expiryTime = new Date(Date.now() + 30000);
      expect(manager.isLeaseSafe(expiryTime)).toBe(true);
    });

    it("should return false for expired lease", () => {
      const expiryTime = new Date(Date.now() - 1000);
      expect(manager.isLeaseSafe(expiryTime)).toBe(false);
    });

    it("should apply extra buffer for lease checks", () => {
      // Lease expires in 6 seconds
      const expiryTime = new Date(Date.now() + 6000);

      manager.setSafetyMargin(5000);
      // With 5 second safety margin + 2 second buffer = 7 second total
      // So lease should be considered unsafe
      expect(manager.isLeaseSafe(expiryTime)).toBe(false);
    });

    it("should use custom buffer if provided", () => {
      const expiryTime = new Date(Date.now() + 8000);

      manager.setSafetyMargin(5000);
      expect(manager.isLeaseSafe(expiryTime, 2000)).toBe(false);
      expect(manager.isLeaseSafe(expiryTime, 1000)).toBe(true);
    });
  });

  describe("getLeaseRenewalDeadline", () => {
    it("should return earlier than expiry", () => {
      const expiryTime = new Date(Date.now() + 30000);
      const renewalDeadline = manager.getLeaseRenewalDeadline(expiryTime);

      expect(renewalDeadline.getTime()).toBeLessThan(expiryTime.getTime());
    });

    it("should use custom renewal window", () => {
      const expiryTime = new Date(Date.now() + 30000);

      manager.setSafetyMargin(2000);
      const renewalDeadline = manager.getLeaseRenewalDeadline(
        expiryTime,
        3000
      );

      // Should be expiry - (2000 + 3000) = expiry - 5000
      const diff =
        expiryTime.getTime() - renewalDeadline.getTime();
      expect(diff).toBeGreaterThanOrEqual(4000);
      expect(diff).toBeLessThanOrEqual(6000);
    });
  });

  describe("isClockHealthy", () => {
    it("should return true when skew is healthy", () => {
      const now = new Date();
      clockSkew.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 1000),
        source: "horizon",
      });

      expect(manager.isClockHealthy()).toBe(true);
    });

    it("should return false when skew is critical", () => {
      const now = new Date();
      clockSkew.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 40000),
        source: "horizon",
      });

      expect(manager.isClockHealthy()).toBe(false);
    });
  });

  describe("getDiagnostics", () => {
    it("should return diagnostic info", () => {
      const diag = manager.getDiagnostics();

      expect(diag).toHaveProperty("safetyMarginMs");
      expect(diag).toHaveProperty("clockHealthy");
      expect(diag).toHaveProperty("maxSkewMs");
      expect(diag).toHaveProperty("currentTime");
      expect(diag).toHaveProperty("trustedTime");
    });
  });

  describe("JWT expiry scenario", () => {
    it("should correctly validate JWT expiry", () => {
      const now = new Date();
      const jwtExpiry = new Date(now.getTime() + 900000); // 15 minutes

      manager.setSafetyMargin(5000);

      // Should still be valid
      expect(manager.isValid(jwtExpiry, now)).toBe(true);

      // Fast forward 14 minutes
      const later = new Date(now.getTime() + 840000);
      expect(manager.isValid(jwtExpiry, later)).toBe(true);

      // Fast forward to within safety margin of expiry
      const almostExpired = new Date(
        now.getTime() + 900000 - 3000
      );
      expect(manager.isValid(jwtExpiry, almostExpired)).toBe(false);
    });
  });

  describe("Quote expiry scenario", () => {
    it("should validate quote validity with clock skew", () => {
      const now = new Date();
      manager.setSafetyMargin(2000); // 2 second margin for quote

      // Quote issued now, expires in 30 seconds
      const quoteExpiry = new Date(now.getTime() + 30000);

      // Quote should be valid immediately
      expect(manager.isValid(quoteExpiry, now)).toBe(true);

      // After 20 seconds, still valid
      const after20s = new Date(now.getTime() + 20000);
      expect(manager.isValid(quoteExpiry, after20s)).toBe(true);

      // Within 2 seconds of expiry, consider expired (to be safe)
      const almostExpired = new Date(
        now.getTime() + 30000 - 1000
      );
      expect(manager.isValid(quoteExpiry, almostExpired)).toBe(false);
    });
  });
});
