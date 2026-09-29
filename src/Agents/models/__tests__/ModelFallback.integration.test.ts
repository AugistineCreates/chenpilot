/**
 * Integration tests for Model Fallback System
 * 
 * Tests the complete flow from model selection through validation
 */

import { ModelRegistry, SelectionStrategy } from "../ModelRegistry";
import { ModelFallbackOrchestrator, LLMCallContext } from "../ModelFallbackOrchestrator";
import {
  ModelCapability,
  PlanVersion,
  OutputFormat,
} from "../ModelCapability";
import Anthropic from "@anthropic-ai/sdk";

// Mock Anthropic client
jest.mock("@anthropic-ai/sdk");

describe("Model Fallback Integration", () => {
  let registry: ModelRegistry;
  let mockClient: jest.Mocked<Anthropic>;

  const mockModel1: ModelCapability = {
    modelId: "model-primary",
    displayName: "Primary Model",
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
    modelId: "model-fallback",
    displayName: "Fallback Model",
    performance: {
      ...mockModel1.performance,
      qualityScore: 0.95,
    },
  };

  beforeEach(() => {
    registry = new ModelRegistry();
    registry.register(mockModel1);
    registry.register(mockModel2);
    registry.registerFallbackChain("default", {
      primary: "model-primary",
      fallbacks: ["model-fallback"],
      strategy: SelectionStrategy.QUALITY_FIRST,
    });

    mockClient = new Anthropic({ apiKey: "test" }) as jest.Mocked<Anthropic>;
  });

  describe("successful primary model execution", () => {
    it("should use primary model when available and valid", async () => {
      const orchestrator = new ModelFallbackOrchestrator(mockClient);

      mockClient.messages.create = jest.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ workflow: [] }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const context: LLMCallContext = {
        callId: "test-1",
        agentId: "agent-1",
        requirements: {
          minPlanVersion: PlanVersion.V1_WORKFLOW,
        },
        preferredModelId: "model-primary",
        fallbackChainName: "default",
      };

      const result = await orchestrator.executeCall(context, "Test prompt", {
        asJson: true,
      });

      expect(result.modelId).toBe("model-primary");
      expect(result.usedFallback).toBe(false);
      expect(result.validation.valid).toBe(true);
      expect(result.decisionLog[0].type).toBe("primary_selected");
    });
  });

  describe("fallback on validation failure", () => {
    it("should fall back when primary model output fails validation", async () => {
      const orchestrator = new ModelFallbackOrchestrator(mockClient, {
        maxRetries: 2,
        baseDelayMs: 100,
        exponentialBackoff: false,
        tryDifferentModels: true,
      });

      // Primary model returns invalid output
      // Fallback model returns valid output
      mockClient.messages.create = jest.fn()
        .mockResolvedValueOnce({
          content: [{ type: "text", text: JSON.stringify({ invalid: "output" }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        })
        .mockResolvedValueOnce({
          content: [{ type: "text", text: JSON.stringify({ workflow: [] }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });

      const context: LLMCallContext = {
        callId: "test-2",
        agentId: "agent-1",
        requirements: {
          minPlanVersion: PlanVersion.V1_WORKFLOW,
        },
        fallbackChainName: "default",
      };

      const result = await orchestrator.executeCall(context, "Test prompt", {
        asJson: true,
      });

      expect(result.modelId).toBe("model-fallback");
      expect(result.usedFallback).toBe(true);
      expect(result.decisionLog).toContainEqual(
        expect.objectContaining({ type: "validation_failed" })
      );
      expect(result.decisionLog).toContainEqual(
        expect.objectContaining({ type: "fallback_triggered" })
      );
    });
  });

  describe("fallback on API error", () => {
    it("should fall back when primary model throws error", async () => {
      const orchestrator = new ModelFallbackOrchestrator(mockClient, {
        maxRetries: 2,
        baseDelayMs: 100,
        exponentialBackoff: false,
        tryDifferentModels: true,
      });

      mockClient.messages.create = jest.fn()
        .mockRejectedValueOnce(new Error("Rate limit exceeded"))
        .mockResolvedValueOnce({
          content: [{ type: "text", text: JSON.stringify({ workflow: [] }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });

      const context: LLMCallContext = {
        callId: "test-3",
        agentId: "agent-1",
        fallbackChainName: "default",
      };

      const result = await orchestrator.executeCall(context, "Test prompt", {
        asJson: true,
      });

      expect(result.modelId).toBe("model-fallback");
      expect(result.usedFallback).toBe(true);
      expect(result.decisionLog).toContainEqual(
        expect.objectContaining({ type: "api_error" })
      );
    });
  });

  describe("fallback exhaustion", () => {
    it("should throw when all models fail", async () => {
      const orchestrator = new ModelFallbackOrchestrator(mockClient, {
        maxRetries: 1,
        baseDelayMs: 100,
        exponentialBackoff: false,
        tryDifferentModels: true,
      });

      mockClient.messages.create = jest.fn().mockRejectedValue(
        new Error("All models failed")
      );

      const context: LLMCallContext = {
        callId: "test-4",
        agentId: "agent-1",
        fallbackChainName: "default",
      };

      await expect(
        orchestrator.executeCall(context, "Test prompt", { asJson: true })
      ).rejects.toThrow();
    });
  });

  describe("metrics tracking", () => {
    it("should track successful calls", async () => {
      const orchestrator = new ModelFallbackOrchestrator(mockClient);
      orchestrator.resetMetrics();

      mockClient.messages.create = jest.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ workflow: [] }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const context: LLMCallContext = {
        callId: "test-5",
        agentId: "agent-1",
        fallbackChainName: "default",
      };

      await orchestrator.executeCall(context, "Test prompt", { asJson: true });

      const metrics = orchestrator.getMetrics();
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.successfulCalls).toBe(1);
      expect(metrics.fallbackCount).toBe(0);
    });

    it("should track fallback usage", async () => {
      const orchestrator = new ModelFallbackOrchestrator(mockClient, {
        maxRetries: 2,
        baseDelayMs: 100,
        exponentialBackoff: false,
        tryDifferentModels: true,
      });
      orchestrator.resetMetrics();

      mockClient.messages.create = jest.fn()
        .mockRejectedValueOnce(new Error("Primary failed"))
        .mockResolvedValueOnce({
          content: [{ type: "text", text: JSON.stringify({ workflow: [] }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });

      const context: LLMCallContext = {
        callId: "test-6",
        agentId: "agent-1",
        fallbackChainName: "default",
      };

      await orchestrator.executeCall(context, "Test prompt", { asJson: true });

      const metrics = orchestrator.getMetrics();
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.successfulCalls).toBe(1);
      expect(metrics.fallbackCount).toBe(1);
      expect(metrics.fallbackRate).toBe(1.0);
    });

    it("should track validation failures", async () => {
      const orchestrator = new ModelFallbackOrchestrator(mockClient, {
        maxRetries: 0, // Don't retry
        baseDelayMs: 100,
        exponentialBackoff: false,
        tryDifferentModels: false,
      });
      orchestrator.resetMetrics();

      mockClient.messages.create = jest.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ invalid: "output" }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const context: LLMCallContext = {
        callId: "test-7",
        agentId: "agent-1",
        preferredModelId: "model-primary",
        requirements: {
          minPlanVersion: PlanVersion.V1_WORKFLOW,
        },
      };

      await orchestrator.executeCall(context, "Test prompt", { asJson: true });

      const metrics = orchestrator.getMetrics();
      expect(metrics.validationFailures).toBeGreaterThan(0);
    });
  });

  describe("decision logging", () => {
    it("should log all fallback decisions", async () => {
      const orchestrator = new ModelFallbackOrchestrator(mockClient, {
        maxRetries: 2,
        baseDelayMs: 100,
        exponentialBackoff: false,
        tryDifferentModels: true,
      });

      mockClient.messages.create = jest.fn()
        .mockRejectedValueOnce(new Error("Error 1"))
        .mockResolvedValueOnce({
          content: [{ type: "text", text: JSON.stringify({ workflow: [] }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });

      const context: LLMCallContext = {
        callId: "test-8",
        agentId: "agent-1",
        fallbackChainName: "default",
      };

      const result = await orchestrator.executeCall(context, "Test prompt", {
        asJson: true,
      });

      expect(result.decisionLog.length).toBeGreaterThan(2);
      expect(result.decisionLog[0].type).toBe("primary_selected");
      expect(result.decisionLog).toContainEqual(
        expect.objectContaining({ type: "api_error", success: false })
      );
      expect(result.decisionLog).toContainEqual(
        expect.objectContaining({ type: "fallback_triggered", success: true })
      );

      // All decisions should have timestamps
      result.decisionLog.forEach(decision => {
        expect(decision.timestamp).toBeInstanceOf(Date);
        expect(decision.modelId).toBeTruthy();
        expect(decision.reason).toBeTruthy();
      });
    });
  });

  describe("capability-based selection", () => {
    it("should skip models that don't meet capability requirements", async () => {
      // Register a model with lower quality
      const lowQualityModel: ModelCapability = {
        ...mockModel1,
        modelId: "model-low-quality",
        performance: {
          ...mockModel1.performance,
          qualityScore: 0.5,
        },
      };
      registry.register(lowQualityModel);

      const orchestrator = new ModelFallbackOrchestrator(mockClient);

      mockClient.messages.create = jest.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ workflow: [] }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const context: LLMCallContext = {
        callId: "test-9",
        agentId: "agent-1",
        requirements: {
          minQualityScore: 0.8, // Requires quality > 0.8
        },
        preferredModelId: "model-low-quality", // Preferred doesn't meet requirement
      };

      const result = await orchestrator.executeCall(context, "Test prompt", {
        asJson: true,
      });

      // Should not use low-quality model, should fall back to better model
      expect(result.modelId).not.toBe("model-low-quality");
      expect(result.usedFallback).toBe(true);
    });
  });
});
