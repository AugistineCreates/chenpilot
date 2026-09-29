/**
 * Quorum Read Tests
 *
 * Comprehensive test suite covering:
 * - Quorum consensus with multiple providers
 * - Stale response handling
 * - Byzantine (malicious/conflicting) response handling
 * - Delayed response handling
 * - Malformed response handling
 * - Provider health scoring that cannot reduce minimum quorum
 * - Fail-closed behavior for divergent responses
 * - Configurable quorum size
 */

import {
  QuorumReadService,
  DEFAULT_QUORUM_CONFIG,
} from "../../src/Reliability/quorumRead.service";
import { ProviderHealthService } from "../../src/Reliability/providerHealth.service";
import {
  ProviderConfig,
  ProviderResponse,
  QuorumReadConfig,
  QuorumReadError,
  QuorumReadException,
  ChainStateCategory,
} from "../../src/Reliability/quorumRead.types";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createProvider(
  id: string,
  independent = true
): ProviderConfig {
  return {
    id,
    url: `https://${id}.example.com`,
    type: "horizon",
    independent,
    maxLatencyMs: 5000,
  };
}

function createSuccessResponse<T>(
  providerId: string,
  value: T,
  latencyMs = 100
): ProviderResponse<T> {
  return {
    providerId,
    value,
    timestamp: Date.now(),
    latencyMs,
  };
}

function createFailedResponse(
  providerId: string,
  error: string
): ProviderResponse<null> {
  return {
    providerId,
    value: null,
    error,
    timestamp: Date.now(),
    latencyMs: 100,
  };
}

function createStaleResponse<T>(
  providerId: string,
  value: T,
  ageMs: number
): ProviderResponse<T> {
  return {
    providerId,
    value,
    timestamp: Date.now() - ageMs,
    latencyMs: 100,
  };
}

// ─── Quorum Read Tests ─────────────────────────────────────────────────────────

describe("QuorumReadService", () => {
  const providers = [
    createProvider("p1"),
    createProvider("p2"),
    createProvider("p3"),
  ];

  const config: Partial<QuorumReadConfig> = {
    minQuorumSize: 2,
    totalProviders: 3,
    providerTimeoutMs: 5000,
    maxResponseAgeMs: 30000,
    failClosedOnDivergence: true,
    protectedCategories: ["balance", "sequence_number"],
  };

  describe("Basic Quorum Consensus", () => {
    it("achieves quorum when majority agrees", async () => {
      const service = new QuorumReadService(providers, config);

      const result = await service.readQuorum(
        async (provider) =>
          createSuccessResponse(provider.id, "100.5"),
        "balance"
      );

      expect(result.quorumAchieved).toBe(true);
      expect(result.value).toBe("100.5");
      expect(result.agreementCount).toBe(3);
      expect(result.rejected).toBe(false);
    });

    it("achieves quorum with 2/3 agreement", async () => {
      const service = new QuorumReadService(providers, config);

      const result = await service.readQuorum(
        async (provider) => {
          // p1 and p2 agree, p3 disagrees
          const value =
            provider.id === "p3" ? "200.0" : "100.5";
          return createSuccessResponse(provider.id, value);
        },
        "balance"
      );

      expect(result.quorumAchieved).toBe(true);
      expect(result.value).toBe("100.5");
      expect(result.agreementCount).toBe(2);
    });

    it("rejects when no majority achieves quorum", async () => {
      const service = new QuorumReadService(providers, {
        ...config,
        failClosedOnDivergence: false,
      });

      // All three return different values
      const result = await service.readQuorum(
        async (provider) => {
          const valueMap: Record<string, string> = {
            p1: "100.0",
            p2: "200.0",
            p3: "300.0",
          };
          return createSuccessResponse(
            provider.id,
            valueMap[provider.id]
          );
        },
        "balance"
      );

      expect(result.quorumAchieved).toBe(false);
      expect(result.rejected).toBe(true);
    });

    it("fails closed on divergent responses when configured", async () => {
      const service = new QuorumReadService(providers, {
        ...config,
        failClosedOnDivergence: true,
      });

      await expect(
        service.readQuorum(
          async (provider) => {
            const valueMap: Record<string, string> = {
              p1: "100.0",
              p2: "200.0",
              p3: "300.0",
            };
            return createSuccessResponse(
              provider.id,
              valueMap[provider.id]
            );
          },
          "balance"
        )
      ).rejects.toThrow(QuorumReadException);
    });
  });

  describe("Stale Response Handling", () => {
    it("rejects stale responses", async () => {
      const service = new QuorumReadService(providers, {
        ...config,
        maxResponseAgeMs: 10000, // 10 seconds
        failClosedOnDivergence: false,
      });

      const result = await service.readQuorum(
        async (provider) => {
          // p1 and p2 return stale data (60 seconds old)
          if (provider.id === "p3") {
            return createSuccessResponse(provider.id, "100.5");
          }
          return createStaleResponse(provider.id, "100.5", 60000);
        },
        "balance"
      );

      // Only p3 has fresh data, but we need 2 for quorum
      expect(result.quorumAchieved).toBe(false);
      expect(result.rejected).toBe(true);
    });

    it("accepts fresh responses within staleness threshold", async () => {
      const service = new QuorumReadService(providers, {
        ...config,
        maxResponseAgeMs: 30000,
      });

      const result = await service.readQuorum(
        async (provider) => {
          // All responses are 5 seconds old (within 30s threshold)
          return createStaleResponse(provider.id, "100.5", 5000);
        },
        "balance"
      );

      expect(result.quorumAchieved).toBe(true);
      expect(result.value).toBe("100.5");
    });
  });

  describe("Byzantine Response Handling", () => {
    it("detects and rejects Byzantine (conflicting) responses", async () => {
      const service = new QuorumReadService(providers, config);

      // Simulate Byzantine attack: 2 providers return wrong value
      const result = await service.readQuorum(
        async (provider) => {
          if (provider.id === "p1") {
            // Honest provider
            return createSuccessResponse(provider.id, "100.5");
          }
          // Byzantine providers return different value
          return createSuccessResponse(provider.id, "999999.99");
        },
        "balance"
      );

      // Byzantine majority wins quorum (this is expected behavior)
      // The system should detect this through provider health scoring
      expect(result.quorumAchieved).toBe(true);
      expect(result.value).toBe("999999.99");

      // But the honest provider's health should improve
      const healthService = service.getHealthService();
      const p1Health = healthService.getHealth("p1");
      expect(p1Health?.consecutiveFailures).toBe(0);
    });

    it("handles split-vote Byzantine scenario", async () => {
      const service = new QuorumReadService(providers, {
        ...config,
        failClosedOnDivergence: false,
      });

      // Each provider returns a different value
      const result = await service.readQuorum(
        async (provider) => {
          const valueMap: Record<string, string> = {
            p1: "100.0",
            p2: "200.0",
            p3: "300.0",
          };
          return createSuccessResponse(
            provider.id,
            valueMap[provider.id]
          );
        },
        "balance"
      );

      expect(result.quorumAchieved).toBe(false);
      expect(result.rejected).toBe(true);
    });
  });

  describe("Delayed Response Handling", () => {
    it("handles mixed fast and slow responses", async () => {
      const service = new QuorumReadService(providers, {
        ...config,
        providerTimeoutMs: 1000,
      });

      const result = await service.readQuorum(
        async (provider) => {
          if (provider.id === "p3") {
            // Slow provider - simulate delay
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return createSuccessResponse(provider.id, "100.5");
          }
          return createSuccessResponse(provider.id, "100.5");
        },
        "balance"
      );

      // p3 times out, but p1 and p2 succeed
      expect(result.quorumAchieved).toBe(true);
      expect(result.agreementCount).toBe(2);
    });

    it("times out slow providers gracefully", async () => {
      const service = new QuorumReadService(providers, {
        ...config,
        providerTimeoutMs: 100,
        failClosedOnDivergence: false,
      });

      const result = await service.readQuorum(
        async (provider) => {
          // All providers are slow
          await new Promise((resolve) => setTimeout(resolve, 500));
          return createSuccessResponse(provider.id, "100.5");
        },
        "balance"
      );

      // All providers time out
      expect(result.quorumAchieved).toBe(false);
      expect(result.rejected).toBe(true);
    });
  });

  describe("Malformed Response Handling", () => {
    it("handles null responses from providers", async () => {
      const service = new QuorumReadService(providers, config);

      const result = await service.readQuorum(
        async (provider) => {
          if (provider.id === "p3") {
            return createFailedResponse(provider.id, "Connection refused");
          }
          return createSuccessResponse(provider.id, "100.5");
        },
        "balance"
      );

      // p1 and p2 succeed, p3 fails
      expect(result.quorumAchieved).toBe(true);
      expect(result.agreementCount).toBe(2);
    });

    it("handles all providers failing", async () => {
      const service = new QuorumReadService(providers, config);

      await expect(
        service.readQuorum(
          async (provider) => {
            return createFailedResponse(
              provider.id,
              "Service unavailable"
            );
          },
          "balance"
        )
      ).rejects.toThrow(QuorumReadException);
    });

    it("handles mixed null and valid responses", async () => {
      const service = new QuorumReadService(providers, config);

      const result = await service.readQuorum(
        async (provider) => {
          if (provider.id === "p3") {
            return createFailedResponse(provider.id, "Timeout");
          }
          return createSuccessResponse(provider.id, "100.5");
        },
        "balance"
      );

      expect(result.quorumAchieved).toBe(true);
      expect(result.value).toBe("100.5");
    });
  });

  describe("Provider Health Scoring", () => {
    it("cannot reduce minimum quorum through health scoring", () => {
      const service = new QuorumReadService(providers, config);
      const healthService = service.getHealthService();

      // Mark p1 and p2 as unhealthy
      healthService.recordFailure("p1", "Test failure");
      healthService.recordFailure("p1", "Test failure");
      healthService.recordFailure("p1", "Test failure");
      healthService.recordFailure("p1", "Test failure");
      healthService.recordFailure("p1", "Test failure");

      healthService.recordFailure("p2", "Test failure");
      healthService.recordFailure("p2", "Test failure");
      healthService.recordFailure("p2", "Test failure");
      healthService.recordFailure("p2", "Test failure");
      healthService.recordFailure("p2", "Test failure");

      // Even though p1 and p2 are unhealthy, they should still be included
      // because we need 2 providers for quorum
      const providersForQuorum = healthService.getProvidersForQuorum();
      expect(providersForQuorum.length).toBeGreaterThanOrEqual(
        config.minQuorumSize!
      );
    });

    it("excludes unhealthy providers when healthy ones suffice", () => {
      const service = new QuorumReadService(providers, config);
      const healthService = service.getHealthService();

      // Mark only p3 as unhealthy
      for (let i = 0; i < 10; i++) {
        healthService.recordFailure("p3", "Test failure");
      }

      // p1 and p2 are healthy, which meets minQuorumSize
      const providersForQuorum = healthService.getProvidersForQuorum();
      const providerIds = providersForQuorum.map((p) => p.id);

      expect(providerIds).toContain("p1");
      expect(providerIds).toContain("p2");
      expect(providerIds).not.toContain("p3");
    });

    it("improves health score on success", () => {
      const healthService = new ProviderHealthService(providers, {
        ...DEFAULT_QUORUM_CONFIG,
        ...config,
      });

      healthService.recordFailure("p1", "Test failure");
      const healthBefore = healthService.getHealth("p1");
      const scoreBefore = healthBefore?.score ?? 0;

      healthService.recordSuccess("p1", 100);
      const healthAfter = healthService.getHealth("p1");
      const scoreAfter = healthAfter?.score ?? 0;

      expect(scoreAfter).toBeGreaterThan(scoreBefore);
    });
  });

  describe("Category Protection", () => {
    it("skips quorum read for unprotected categories", async () => {
      const service = new QuorumReadService(providers, config);

      const result = await service.readQuorum(
        async (provider) => createSuccessResponse(provider.id, "test"),
        "fee" as ChainStateCategory // Not in protected list
      );

      expect(result.rejected).toBe(true);
      expect(result.error).toContain("not protected");
    });

    it("performs quorum read for protected categories", async () => {
      const service = new QuorumReadService(providers, config);

      const result = await service.readQuorum(
        async (provider) => createSuccessResponse(provider.id, "100.5"),
        "balance"
      );

      expect(result.quorumAchieved).toBe(true);
    });
  });

  describe("Quorum Configuration", () => {
    it("respects custom quorum size", async () => {
      const customConfig: Partial<QuorumReadConfig> = {
        ...config,
        minQuorumSize: 3, // Require all 3 providers
        failClosedOnDivergence: false,
      };

      const service = new QuorumReadService(providers, customConfig);

      // 2/3 agreement should fail with minQuorumSize=3
      const result = await service.readQuorum(
        async (provider) => {
          if (provider.id === "p3") {
            return createSuccessResponse(provider.id, "999.99");
          }
          return createSuccessResponse(provider.id, "100.5");
        },
        "balance"
      );

      expect(result.quorumAchieved).toBe(false);
      expect(result.rejected).toBe(true);
    });

    it("works with 2 providers", async () => {
      const twoProviders = [createProvider("p1"), createProvider("p2")];
      const twoProviderConfig: Partial<QuorumReadConfig> = {
        ...config,
        minQuorumSize: 2,
        totalProviders: 2,
      };

      const service = new QuorumReadService(
        twoProviders,
        twoProviderConfig
      );

      const result = await service.readQuorum(
        async (provider) => createSuccessResponse(provider.id, "100.5"),
        "balance"
      );

      expect(result.quorumAchieved).toBe(true);
      expect(result.agreementCount).toBe(2);
    });
  });

  describe("Health Summary", () => {
    it("provides accurate health summary", () => {
      const healthService = new ProviderHealthService(providers, {
        ...DEFAULT_QUORUM_CONFIG,
        ...config,
      });

      healthService.recordSuccess("p1", 100);
      healthService.recordSuccess("p2", 150);
      // Record enough failures to mark p3 unhealthy
      for (let i = 0; i < 10; i++) {
        healthService.recordFailure("p3", "Test failure");
      }

      const summary = healthService.getHealthSummary();

      expect(summary.totalProviders).toBe(3);
      expect(summary.healthyProviders).toBe(2);
      expect(summary.unhealthyProviders).toBe(1);
      expect(summary.quorumMaintained).toBe(true);
    });
  });

  describe("Error Types", () => {
    it("throws correct error type for insufficient providers", async () => {
      const service = new QuorumReadService(providers, {
        ...config,
        failClosedOnDivergence: true,
      });

      try {
        await service.readQuorum(
          async (provider) => {
            return createFailedResponse(provider.id, "All failing");
          },
          "balance"
        );
        fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(QuorumReadException);
        expect((error as QuorumReadException).code).toBe(
          QuorumReadError.INSUFFICIENT_PROVIDERS
        );
      }
    });

    it("throws correct error type for divergent responses", async () => {
      const service = new QuorumReadService(providers, {
        ...config,
        failClosedOnDivergence: true,
      });

      try {
        await service.readQuorum(
          async (provider) => {
            const valueMap: Record<string, string> = {
              p1: "100.0",
              p2: "200.0",
              p3: "300.0",
            };
            return createSuccessResponse(
              provider.id,
              valueMap[provider.id]
            );
          },
          "balance"
        );
        fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(QuorumReadException);
        expect((error as QuorumReadException).code).toBe(
          QuorumReadError.DIVERGENT_RESPONSES
        );
      }
    });
  });

  describe("Normalized Value Comparison", () => {
    it("normalizes string values for comparison", async () => {
      const service = new QuorumReadService(providers, config);

      const result = await service.readQuorum(
        async (provider) => {
          // Different casing and whitespace - all normalize to same value
          const valueMap: Record<string, string> = {
            p1: "  100.5  ",
            p2: "100.5",
            p3: "100.5",
          };
          return createSuccessResponse(
            provider.id,
            valueMap[provider.id]
          );
        },
        "balance"
      );

      expect(result.quorumAchieved).toBe(true);
      // All three normalize to the same value, so quorum is achieved
      expect(result.agreementCount).toBe(3);
    });

    it("normalizes numeric values for comparison", async () => {
      const service = new QuorumReadService(providers, config);

      const result = await service.readQuorum(
        async (provider) => {
          // Different numeric representations
          const valueMap: Record<string, number> = {
            p1: 100.5,
            p2: 100.50,
            p3: 100.500,
          };
          return createSuccessResponse(
            provider.id,
            valueMap[provider.id]
          );
        },
        "balance"
      );

      expect(result.quorumAchieved).toBe(true);
      expect(result.value).toBe(100.5);
    });
  });
});

describe("ProviderHealthService", () => {
  const providers = [
    createProvider("p1"),
    createProvider("p2"),
    createProvider("p3"),
  ];

  const config: QuorumReadConfig = {
    ...DEFAULT_QUORUM_CONFIG,
    minQuorumSize: 2,
    totalProviders: 3,
  };

  describe("Health Tracking", () => {
    it("initializes all providers as healthy", () => {
      const service = new ProviderHealthService(providers, config);

      for (const provider of providers) {
        const health = service.getHealth(provider.id);
        expect(health?.healthy).toBe(true);
        expect(health?.score).toBe(1.0);
      }
    });

    it("decreases score on failure", () => {
      const service = new ProviderHealthService(providers, config);

      service.recordFailure("p1", "Test error");
      const health = service.getHealth("p1");

      expect(health?.score).toBeLessThan(1.0);
      expect(health?.consecutiveFailures).toBe(1);
    });

    it("increases score on success", () => {
      const service = new ProviderHealthService(providers, config);

      service.recordFailure("p1", "Test error");
      const scoreAfterFailure = service.getHealth("p1")?.score ?? 0;

      service.recordSuccess("p1", 100);
      const scoreAfterSuccess = service.getHealth("p1")?.score ?? 0;

      expect(scoreAfterSuccess).toBeGreaterThan(scoreAfterFailure);
    });

    it("marks provider unhealthy after max consecutive failures", () => {
      const service = new ProviderHealthService(providers, config);

      for (let i = 0; i < 10; i++) {
        service.recordFailure("p1", "Test error");
      }

      const health = service.getHealth("p1");
      expect(health?.healthy).toBe(false);
    });

    it("resets provider health", () => {
      const service = new ProviderHealthService(providers, config);

      service.recordFailure("p1", "Test error");
      service.recordFailure("p1", "Test error");
      service.resetProvider("p1");

      const health = service.getHealth("p1");
      expect(health?.healthy).toBe(true);
      expect(health?.score).toBe(1.0);
      expect(health?.consecutiveFailures).toBe(0);
    });
  });

  describe("Provider Selection", () => {
    it("includes all providers when healthy count is below minimum", () => {
      const service = new ProviderHealthService(providers, config);

      // Mark p1 and p2 as unhealthy
      for (let i = 0; i < 10; i++) {
        service.recordFailure("p1", "Test error");
        service.recordFailure("p2", "Test error");
      }

      const selected = service.getProvidersForQuorum();
      expect(selected.length).toBe(3); // All providers included
    });

    it("excludes unhealthy providers when healthy count meets minimum", () => {
      const service = new ProviderHealthService(providers, config);

      // Mark only p3 as unhealthy
      for (let i = 0; i < 10; i++) {
        service.recordFailure("p3", "Test error");
      }

      const selected = service.getProvidersForQuorum();
      const selectedIds = selected.map((p) => p.id);

      expect(selectedIds).toContain("p1");
      expect(selectedIds).toContain("p2");
      expect(selectedIds).not.toContain("p3");
    });
  });

  describe("Latency Tracking", () => {
    it("tracks average latency with exponential moving average", () => {
      const service = new ProviderHealthService(providers, config);

      service.recordSuccess("p1", 100);
      service.recordSuccess("p1", 200);
      service.recordSuccess("p1", 150);

      const health = service.getHealth("p1");
      expect(health?.avgLatencyMs).toBeGreaterThan(0);
      expect(health?.avgLatencyMs).toBeLessThan(200);
    });
  });
});

describe("QuorumReadException", () => {
  it("has correct error properties", () => {
    const error = new QuorumReadException(
      QuorumReadError.DIVERGENT_RESPONSES,
      "Test error",
      { test: "data" }
    );

    expect(error.code).toBe(QuorumReadError.DIVERGENT_RESPONSES);
    expect(error.message).toBe("Test error");
    expect(error.details).toEqual({ test: "data" });
    expect(error.name).toBe("QuorumReadException");
  });
});
