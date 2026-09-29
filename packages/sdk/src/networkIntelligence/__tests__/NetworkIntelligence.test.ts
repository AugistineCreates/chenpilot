import { NetworkIntelligence } from "../NetworkIntelligence";
import { NetworkAvailability } from "../types";

// Mock fetch globally
const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

// Mock HorizonClient internals
jest.mock("../../horizonClient", () => {
  return {
    HorizonClient: jest.fn().mockImplementation(() => ({
      getAccountOffers: jest.fn(),
      iterateAccountOffers: jest.fn(),
    })),
  };
});

// Mock networkStatus
jest.mock("../../networkStatus", () => ({
  checkNetworkHealth: jest.fn(),
  checkLedgerLatency: jest.fn(),
  getProtocolVersion: jest.fn(),
  getNetworkStatus: jest.fn(),
}));

import {
  checkNetworkHealth,
  checkLedgerLatency,
  getProtocolVersion,
  getNetworkStatus,
} from "../../networkStatus";

describe("NetworkIntelligence", () => {
  let ni: NetworkIntelligence;

  beforeEach(() => {
    jest.clearAllMocks();
    ni = new NetworkIntelligence({
      network: "testnet",
      fetchFn: mockFetch,
    });
  });

  describe("constructor", () => {
    it("should initialize with default config", () => {
      const defaultNi = new NetworkIntelligence();
      expect(defaultNi.config.network).toBe("testnet");
      expect(defaultNi.config.horizonUrl).toBe(
        "https://horizon-testnet.stellar.org"
      );
      expect(defaultNi.config.rpcUrl).toBe(
        "https://soroban-testnet.stellar.org"
      );
      expect(defaultNi.config.timeout).toBe(10_000);
    });

    it("should initialize with custom config", () => {
      const customNi = new NetworkIntelligence({
        network: "mainnet",
        timeout: 5000,
      });
      expect(customNi.config.network).toBe("mainnet");
      expect(customNi.config.horizonUrl).toBe(
        "https://horizon.stellar.org"
      );
      expect(customNi.config.rpcUrl).toBe(
        "https://soroban-mainnet.stellar.org"
      );
      expect(customNi.config.timeout).toBe(5000);
    });

    it("should expose horizon and assetCache instances", () => {
      expect(ni.horizon).toBeDefined();
      expect(ni.assetCache).toBeDefined();
    });
  });

  describe("checkHealth", () => {
    it("should delegate to checkNetworkHealth", async () => {
      const mockResult = {
        isHealthy: true,
        responseTimeMs: 100,
        latestLedger: 12345,
      };
      (checkNetworkHealth as jest.Mock).mockResolvedValue(mockResult);

      const result = await ni.checkHealth();
      expect(result).toEqual(mockResult);
      expect(checkNetworkHealth).toHaveBeenCalledWith({
        network: "testnet",
        rpcUrl: "https://soroban-testnet.stellar.org",
        timeout: 10_000,
      });
    });
  });

  describe("checkLatency", () => {
    it("should delegate to checkLedgerLatency", async () => {
      const mockResult = {
        currentLedger: 12345,
        timeSinceLastLedgerSec: 3,
        averageLedgerTimeSec: 5,
        isNormal: true,
      };
      (checkLedgerLatency as jest.Mock).mockResolvedValue(mockResult);

      const result = await ni.checkLatency();
      expect(result).toEqual(mockResult);
    });
  });

  describe("getProtocolVersion", () => {
    it("should delegate to getProtocolVersion", async () => {
      const mockResult = {
        version: 22,
        coreVersion: "22.1.0",
        networkPassphrase: "Test SDF Network ; September 2015",
      };
      (getProtocolVersion as jest.Mock).mockResolvedValue(mockResult);

      const result = await ni.getProtocolVersion();
      expect(result).toEqual(mockResult);
    });
  });

  describe("getStatus", () => {
    it("should delegate to getNetworkStatus", async () => {
      const mockStatus = {
        health: {
          isHealthy: true,
          responseTimeMs: 100,
          latestLedger: 12345,
        },
        latency: {
          currentLedger: 12345,
          timeSinceLastLedgerSec: 3,
          averageLedgerTimeSec: 5,
          isNormal: true,
        },
        protocol: {
          version: 22,
          coreVersion: "22.1.0",
          networkPassphrase: "Test SDF Network ; September 2015",
        },
        checkedAt: Date.now(),
      };
      (getNetworkStatus as jest.Mock).mockResolvedValue(mockStatus);

      const result = await ni.getStatus();
      expect(result).toEqual(mockStatus);
    });

    it("should cache status for TTL duration", async () => {
      const mockStatus = {
        health: { isHealthy: true, responseTimeMs: 100, latestLedger: 12345 },
        latency: {
          currentLedger: 12345,
          timeSinceLastLedgerSec: 3,
          averageLedgerTimeSec: 5,
          isNormal: true,
        },
        protocol: {
          version: 22,
          coreVersion: "22.1.0",
          networkPassphrase: "Test SDF Network ; September 2015",
        },
        checkedAt: Date.now(),
      };
      (getNetworkStatus as jest.Mock).mockResolvedValue(mockStatus);

      // First call
      await ni.getStatus();
      // Second call should use cache
      await ni.getStatus();

      expect(getNetworkStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe("checkAvailability", () => {
    it("should return OPERATIONAL when healthy", async () => {
      (getNetworkStatus as jest.Mock).mockResolvedValue({
        health: { isHealthy: true, responseTimeMs: 200, latestLedger: 12345 },
        latency: {
          currentLedger: 12345,
          timeSinceLastLedgerSec: 3,
          averageLedgerTimeSec: 5,
          isNormal: true,
        },
        protocol: { version: 22, coreVersion: "22.1.0", networkPassphrase: "" },
        checkedAt: Date.now(),
      });

      const result = await ni.checkAvailability();
      expect(result.level).toBe(NetworkAvailability.OPERATIONAL);
      expect(result.isOperational).toBe(true);
    });

    it("should return UNAVAILABLE when unhealthy", async () => {
      (getNetworkStatus as jest.Mock).mockResolvedValue({
        health: {
          isHealthy: false,
          responseTimeMs: 5000,
          latestLedger: 0,
          error: "Connection refused",
        },
        latency: {
          currentLedger: 0,
          timeSinceLastLedgerSec: 0,
          averageLedgerTimeSec: 5,
          isNormal: false,
        },
        protocol: { version: 0, coreVersion: "", networkPassphrase: "" },
        checkedAt: Date.now(),
      });

      const result = await ni.checkAvailability();
      expect(result.level).toBe(NetworkAvailability.UNAVAILABLE);
      expect(result.isOperational).toBe(false);
    });

    it("should return DEGRADED when latency is abnormal", async () => {
      (getNetworkStatus as jest.Mock).mockResolvedValue({
        health: { isHealthy: true, responseTimeMs: 200, latestLedger: 12345 },
        latency: {
          currentLedger: 12345,
          timeSinceLastLedgerSec: 30,
          averageLedgerTimeSec: 5,
          isNormal: false,
        },
        protocol: { version: 22, coreVersion: "22.1.0", networkPassphrase: "" },
        checkedAt: Date.now(),
      });

      const result = await ni.checkAvailability();
      expect(result.level).toBe(NetworkAvailability.DEGRADED);
      expect(result.isOperational).toBe(true);
    });

    it("should return DEGRADED when response time is slow", async () => {
      (getNetworkStatus as jest.Mock).mockResolvedValue({
        health: { isHealthy: true, responseTimeMs: 6000, latestLedger: 12345 },
        latency: {
          currentLedger: 12345,
          timeSinceLastLedgerSec: 3,
          averageLedgerTimeSec: 5,
          isNormal: true,
        },
        protocol: { version: 22, coreVersion: "22.1.0", networkPassphrase: "" },
        checkedAt: Date.now(),
      });

      const result = await ni.checkAvailability();
      expect(result.level).toBe(NetworkAvailability.DEGRADED);
      expect(result.isOperational).toBe(true);
    });

    it("should return UNAVAILABLE when getStatus throws", async () => {
      (getNetworkStatus as jest.Mock).mockRejectedValue(
        new Error("Network timeout")
      );

      const result = await ni.checkAvailability();
      expect(result.level).toBe(NetworkAvailability.UNAVAILABLE);
      expect(result.isOperational).toBe(false);
      expect(result.summary).toContain("Network timeout");
    });
  });

  describe("resolveAsset", () => {
    it("should resolve native XLM", async () => {
      const result = await ni.resolveAsset("XLM");
      expect(result.code).toBe("XLM");
      expect(result.isNative).toBe(true);
      expect(result.issuer).toBe("");
    });

    it("should return from cache if available", async () => {
      // Pre-populate cache
      const assetLike = {
        isNative: () => false,
        getCode: () => "USDC",
        getIssuer: () => "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      } as any;
      ni.assetCache.set(assetLike, {
        code: "USDC",
        issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        lastUpdated: Date.now(),
      });

      const result = await ni.resolveAsset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );
      expect(result.code).toBe("USDC");
      expect(result.fromCache).toBe(true);
      expect(result.info).toBeDefined();
    });
  });

  describe("clearAssetCache", () => {
    it("should clear the asset cache", () => {
      const assetLike = {
        isNative: () => false,
        getCode: () => "USDC",
        getIssuer: () => "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      } as any;
      ni.assetCache.set(assetLike, {
        code: "USDC",
        issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        lastUpdated: Date.now(),
      });

      ni.clearAssetCache();
      const result = ni.assetCache.get(assetLike);
      expect(result).toBeUndefined();
    });
  });

  describe("snapshot", () => {
    it("should return a complete snapshot", async () => {
      const mockStatus = {
        health: { isHealthy: true, responseTimeMs: 100, latestLedger: 12345 },
        latency: {
          currentLedger: 12345,
          timeSinceLastLedgerSec: 3,
          averageLedgerTimeSec: 5,
          isNormal: true,
        },
        protocol: {
          version: 22,
          coreVersion: "22.1.0",
          networkPassphrase: "Test SDF Network ; September 2015",
        },
        checkedAt: Date.now(),
      };
      (getNetworkStatus as jest.Mock).mockResolvedValue(mockStatus);

      const result = await ni.snapshot();
      expect(result.status).toEqual(mockStatus);
      expect(result.availability).toBeDefined();
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should handle getStatus failure gracefully", async () => {
      (getNetworkStatus as jest.Mock).mockRejectedValue(
        new Error("Network error")
      );

      const result = await ni.snapshot();
      expect(result.status).toBeNull();
      expect(result.availability.isOperational).toBe(false);
    });
  });
});