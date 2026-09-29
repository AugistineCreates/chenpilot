/**
 * Tests for ModelRegistry
 */

import {
  ModelRegistry,
  SelectionStrategy,
} from "../ModelRegistry";
import {
  ModelCapability,
  PlanVersion,
  OutputFormat,
  CertificationStatus,
} from "../ModelCapability";

describe("ModelRegistry", () => {
  let registry: ModelRegistry;

  const mockModel1: ModelCapability = {
    modelId: "model-1",
    displayName: "Model 1",
    provider: "test",
    certifiedToolSchemas: [],
    supportedPlanVersions: [PlanVersion.V1_WORKFLOW],
    supportedOutputFormats: [OutputFormat.JSON],
    safetyCompatibility: {
      assetTrustAware: true,
      riskEstimation: true,
      approvalAware: true,
      rbacAware: true,
      minSafetyConfidence: 0.8,
    },
    performance: {
      avgLatencyMs: 1000,
      p95LatencyMs: 2000,
      costPerKInput: 0.001,
      costPerKOutput: 0.005,
      maxTokens: 100000,
      qualityScore: 0.85,
    },
    certifiedAt: new Date(),
    available: true,
  };

  const mockModel2: ModelCapability = {
    ...mockModel1,
    modelId: "model-2",
    displayName: "Model 2",
    performance: {
      ...mockModel1.performance,
      avgLatencyMs: 500,
      qualityScore: 0.75,
    },
  };

  const mockModel3: ModelCapability = {
    ...mockModel1,
    modelId: "model-3",
    displayName: "Model 3",
    performance: {
      ...mockModel1.performance,
      avgLatencyMs: 2000,
      qualityScore: 0.95,
      costPerKInput: 0.01,
      costPerKOutput: 0.05,
    },
  };

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  describe("register and unregister", () => {
    it("should register a model", () => {
      registry.register(mockModel1);
      const model = registry.getModel("model-1");
      expect(model).toBeDefined();
      expect(model?.modelId).toBe("model-1");
    });

    it("should unregister a model", () => {
      registry.register(mockModel1);
      const removed = registry.unregister("model-1");
      expect(removed).toBe(true);
      expect(registry.getModel("model-1")).toBeUndefined();
    });

    it("should return false when unregistering non-existent model", () => {
      const removed = registry.unregister("non-existent");
      expect(removed).toBe(false);
    });
  });

  describe("getCompatibleModels", () => {
    beforeEach(() => {
      registry.register(mockModel1);
      registry.register(mockModel2);
      registry.register({
        ...mockModel3,
        available: false, // Unavailable model
      });
    });

    it("should return only compatible models", () => {
      const compatible = registry.getCompatibleModels({
        minQualityScore: 0.8,
      });

      expect(compatible).toHaveLength(1);
      expect(compatible[0].modelId).toBe("model-1");
    });

    it("should filter out unavailable models", () => {
      const compatible = registry.getCompatibleModels({
        minQualityScore: 0.9,
      });

      expect(compatible).toHaveLength(0);
    });
  });

  describe("selectModel", () => {
    beforeEach(() => {
      registry.register(mockModel1);
      registry.register(mockModel2);
      registry.register(mockModel3);
    });

    it("should select preferred model if it meets requirements", () => {
      const result = registry.selectModel(
        { minQualityScore: 0.7 },
        SelectionStrategy.QUALITY_FIRST,
        "model-2"
      );

      expect(result).toBeDefined();
      expect(result?.model.modelId).toBe("model-2");
      expect(result?.isFallback).toBe(false);
    });

    it("should select best quality model with QUALITY_FIRST strategy", () => {
      const result = registry.selectModel(
        { minQualityScore: 0.7 },
        SelectionStrategy.QUALITY_FIRST
      );

      expect(result).toBeDefined();
      expect(result?.model.modelId).toBe("model-3");
      expect(result?.model.performance.qualityScore).toBe(0.95);
    });

    it("should select lowest latency model with LATENCY_FIRST strategy", () => {
      const result = registry.selectModel(
        { minQualityScore: 0.7 },
        SelectionStrategy.LATENCY_FIRST
      );

      expect(result).toBeDefined();
      expect(result?.model.modelId).toBe("model-2");
      expect(result?.model.performance.avgLatencyMs).toBe(500);
    });

    it("should select lowest cost model with COST_FIRST strategy", () => {
      const result = registry.selectModel(
        { minQualityScore: 0.7 },
        SelectionStrategy.COST_FIRST
      );

      expect(result).toBeDefined();
      expect(result?.model.modelId).toBe("model-1");
    });

    it("should return null when no models meet requirements", () => {
      const result = registry.selectModel({
        minQualityScore: 0.99,
      });

      expect(result).toBeNull();
    });

    it("should fall back when preferred model doesn't meet requirements", () => {
      const result = registry.selectModel(
        { minQualityScore: 0.9 },
        SelectionStrategy.QUALITY_FIRST,
        "model-2" // Quality 0.75, doesn't meet 0.9 requirement
      );

      expect(result).toBeDefined();
      expect(result?.model.modelId).toBe("model-3");
      expect(result?.isFallback).toBe(true);
    });
  });

  describe("fallback chains", () => {
    beforeEach(() => {
      registry.register(mockModel1);
      registry.register(mockModel2);
      registry.register(mockModel3);
    });

    it("should register a fallback chain", () => {
      registry.registerFallbackChain("test-chain", {
        primary: "model-1",
        fallbacks: ["model-2", "model-3"],
        strategy: SelectionStrategy.QUALITY_FIRST,
      });

      const chain = registry.getFallbackChain("test-chain");
      expect(chain).toBeDefined();
      expect(chain?.primary).toBe("model-1");
    });

    it("should throw when registering chain with non-existent models", () => {
      expect(() => {
        registry.registerFallbackChain("invalid-chain", {
          primary: "non-existent",
          fallbacks: ["model-2"],
          strategy: SelectionStrategy.QUALITY_FIRST,
        });
      }).toThrow();
    });

    it("should select primary model from chain when available", () => {
      registry.registerFallbackChain("test-chain", {
        primary: "model-1",
        fallbacks: ["model-2", "model-3"],
        strategy: SelectionStrategy.QUALITY_FIRST,
      });

      const result = registry.selectWithFallbackChain("test-chain", {
        minQualityScore: 0.7,
      });

      expect(result).toBeDefined();
      expect(result?.model.modelId).toBe("model-1");
      expect(result?.isFallback).toBe(false);
    });

    it("should fall back when primary doesn't meet requirements", () => {
      registry.registerFallbackChain("test-chain", {
        primary: "model-2",
        fallbacks: ["model-1", "model-3"],
        strategy: SelectionStrategy.QUALITY_FIRST,
      });

      const result = registry.selectWithFallbackChain("test-chain", {
        minQualityScore: 0.8,
      });

      expect(result).toBeDefined();
      expect(result?.model.modelId).toBe("model-3");
      expect(result?.isFallback).toBe(true);
    });

    it("should return null when no models in chain meet requirements", () => {
      registry.registerFallbackChain("test-chain", {
        primary: "model-1",
        fallbacks: ["model-2"],
        strategy: SelectionStrategy.QUALITY_FIRST,
      });

      const result = registry.selectWithFallbackChain("test-chain", {
        minQualityScore: 0.99,
      });

      expect(result).toBeNull();
    });
  });

  describe("updateAvailability", () => {
    it("should update model availability", () => {
      registry.register(mockModel1);
      registry.updateAvailability("model-1", false);

      const model = registry.getModel("model-1");
      expect(model?.available).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      registry.register(mockModel1);
      registry.register(mockModel2);
      registry.register({
        ...mockModel3,
        available: false,
      });

      const stats = registry.getStats();
      expect(stats.totalModels).toBe(3);
      expect(stats.availableModels).toBe(2);
      expect(stats.certifiedModels).toBe(3);
    });
  });
});
