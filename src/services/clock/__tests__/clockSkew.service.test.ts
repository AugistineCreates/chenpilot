import { ClockSkewService } from "../clockSkew.service";
import { ClockSample } from "../types";

describe("ClockSkewService", () => {
  let service: ClockSkewService;

  beforeEach(() => {
    service = new ClockSkewService({
      degradedThresholdMs: 5000,
      criticalThresholdMs: 30000,
      maxHistorySamples: 100,
      minSamplesForStats: 3,
    });
  });

  describe("recordSample", () => {
    it("should record a clock sample", () => {
      const now = new Date();
      const sample: ClockSample = {
        localTime: now,
        remoteTime: new Date(now.getTime() + 1000),
        source: "horizon",
      };

      service.recordSample(sample);
      const offset = service.getOffsetForSource("horizon");

      expect(offset).toBeDefined();
      expect(offset?.offsetMs).toBe(1000);
      expect(offset?.trusted).toBe(true);
    });

    it("should track multiple sources independently", () => {
      const now = new Date();

      const sample1: ClockSample = {
        localTime: now,
        remoteTime: new Date(now.getTime() + 1000),
        source: "horizon",
      };

      const sample2: ClockSample = {
        localTime: now,
        remoteTime: new Date(now.getTime() - 2000),
        source: "soroban-rpc",
      };

      service.recordSample(sample1);
      service.recordSample(sample2);

      expect(service.getOffsetForSource("horizon")?.offsetMs).toBe(1000);
      expect(service.getOffsetForSource("soroban-rpc")?.offsetMs).toBe(-2000);
    });

    it("should update sample count for repeated source", () => {
      const now = new Date();
      const sample: ClockSample = {
        localTime: now,
        remoteTime: new Date(now.getTime() + 1000),
        source: "horizon",
      };

      service.recordSample(sample);
      service.recordSample(sample);
      service.recordSample(sample);

      const offset = service.getOffsetForSource("horizon");
      expect(offset?.sampleCount).toBe(3);
    });
  });

  describe("getStats", () => {
    it("should return healthy status with small offsets", () => {
      const now = new Date();
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 1000),
        source: "horizon",
      });
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 500),
        source: "soroban-rpc",
      });

      const stats = service.getStats();
      expect(stats.status).toBe("HEALTHY");
      expect(stats.maxOffsetMs).toBeLessThan(5000);
    });

    it("should return degraded status when exceeding degraded threshold", () => {
      const now = new Date();
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 10000), // 10 second offset
        source: "horizon",
      });

      const stats = service.getStats();
      expect(stats.status).toBe("DEGRADED");
    });

    it("should return critical status when exceeding critical threshold", () => {
      const now = new Date();
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 40000), // 40 second offset
        source: "horizon",
      });

      const stats = service.getStats();
      expect(stats.status).toBe("CRITICAL");
    });

    it("should calculate median correctly", () => {
      const now = new Date();
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 1000),
        source: "source1",
      });
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 2000),
        source: "source2",
      });
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 3000),
        source: "source3",
      });

      const stats = service.getStats();
      expect(stats.medianOffsetMs).toBe(2000);
    });

    it("should calculate max and min offsets correctly", () => {
      const now = new Date();
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 1000),
        source: "source1",
      });
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() - 5000),
        source: "source2",
      });

      const stats = service.getStats();
      expect(stats.maxOffsetMs).toBe(5000); // absolute value
      expect(stats.minOffsetMs).toBe(1000); // absolute value
    });
  });

  describe("isSafeComparison", () => {
    it("should return true when times are far apart", () => {
      const time1 = new Date();
      const time2 = new Date(time1.getTime() + 10000);

      const result = service.isSafeComparison(time1, time2);
      expect(result).toBe(true);
    });

    it("should return false when times are close", () => {
      const time1 = new Date();
      const time2 = new Date(time1.getTime() + 100);

      const result = service.isSafeComparison(time1, time2);
      expect(result).toBe(false);
    });
  });

  describe("getTrustedNow", () => {
    it("should return current time when no offset", () => {
      const before = Date.now();
      const trustedNow = service.getTrustedNow();
      const after = Date.now();

      expect(trustedNow.getTime()).toBeGreaterThanOrEqual(before);
      expect(trustedNow.getTime()).toBeLessThanOrEqual(after + 100);
    });

    it("should adjust forward when there is positive offset", () => {
      const now = new Date();
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 5000),
        source: "horizon",
      });

      const trustedNow = service.getTrustedNow();
      // Should be adjusted forward but we don't have other offsets, so median is just 5000
      expect(trustedNow.getTime()).toBeGreaterThanOrEqual(
        Date.now() + 4000
      );
    });
  });

  describe("getSafetyMargin", () => {
    it("should return safety margin", () => {
      const now = new Date();
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 3000),
        source: "horizon",
      });

      const margin = service.getSafetyMargin();
      // Should be abs(3000) + 2000 buffer
      expect(margin).toBeGreaterThanOrEqual(5000);
    });
  });

  describe("isSkewCritical", () => {
    it("should return false when skew is healthy", () => {
      const now = new Date();
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 1000),
        source: "horizon",
      });

      expect(service.isSkewCritical()).toBe(false);
    });

    it("should return true when skew is critical", () => {
      const now = new Date();
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 40000),
        source: "horizon",
      });

      expect(service.isSkewCritical()).toBe(true);
    });
  });

  describe("reset", () => {
    it("should clear all data", () => {
      const now = new Date();
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 1000),
        source: "horizon",
      });

      service.reset();

      const offsets = service.getAllOffsets();
      expect(offsets.size).toBe(0);
    });
  });

  describe("cross-node skew scenarios", () => {
    it("should handle forward clock jump on remote", () => {
      const now = new Date();

      // Simulate remote clock jumping forward 15 seconds
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 15000),
        source: "horizon",
      });

      const stats = service.getStats();
      expect(stats.status).toBe("CRITICAL");
      expect(stats.maxOffsetMs).toBe(15000);
    });

    it("should handle backward clock jump on remote", () => {
      const now = new Date();

      // Simulate remote clock jumping backward 10 seconds
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() - 10000),
        source: "horizon",
      });

      const stats = service.getStats();
      expect(stats.status).toBe("DEGRADED");
      expect(stats.maxOffsetMs).toBe(10000);
    });

    it("should detect consensus across multiple nodes", () => {
      const now = new Date();

      // Multiple nodes reporting similar small skew
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 500),
        source: "node1",
      });
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 600),
        source: "node2",
      });
      service.recordSample({
        localTime: now,
        remoteTime: new Date(now.getTime() + 400),
        source: "node3",
      });

      const stats = service.getStats();
      expect(stats.status).toBe("HEALTHY");
      expect(stats.medianOffsetMs).toBe(500);
      expect(stats.stdDeviation).toBeLessThan(200);
    });
  });

  describe("history trimming", () => {
    it("should respect max history samples", () => {
      const service2 = new ClockSkewService({
        degradedThresholdMs: 5000,
        criticalThresholdMs: 30000,
        maxHistorySamples: 5,
        minSamplesForStats: 3,
      });

      const now = new Date();
      for (let i = 0; i < 10; i++) {
        service2.recordSample({
          localTime: now,
          remoteTime: new Date(now.getTime() + i * 100),
          source: "horizon",
        });
      }

      // Should still be tracking but only recent samples
      expect(service2.getOffsetForSource("horizon")).toBeDefined();
    });
  });
});
