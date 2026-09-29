/**
 * Tests for ModelCapability
 */

import {
  ModelCapability,
  CapabilityRequirement,
  meetsRequirements,
  getCertificationStatus,
  CertificationStatus,
  PlanVersion,
  OutputFormat,
  generateToolSchemaHash,
} from "../ModelCapability";
import { ToolMetadata } from "../../registry/ToolMetadata";

describe("ModelCapability", () => {
  const mockCapability: ModelCapability = {
    modelId: "test-model-1",
    displayName: "Test Model",
    provider: "test-provider",
    certifiedToolSchemas: [
      {
        toolName: "swap_tool",
        version: "1.0",
        schemaHash: "abc123",
      },
      {
        toolName: "balance_query",
        version: "1.0",
        schemaHash: "def456",
      },
    ],
    supportedPlanVersions: [PlanVersion.V1_WORKFLOW, PlanVersion.V2_RISK_AWARE],
    supportedOutputFormats: [OutputFormat.JSON, OutputFormat.TEXT],
    safetyCompatibility: {
      assetTrustAware: true,
      riskEstimation: true,
      approvalAware: true,
      rbacAware: true,
      minSafetyConfidence: 0.85,
    },
    performance: {
      avgLatencyMs: 1000,
      p95LatencyMs: 2000,
      costPerKInput: 0.001,
      costPerKOutput: 0.005,
      maxTokens: 100000,
      qualityScore: 0.9,
    },
    certifiedAt: new Date(),
    available: true,
  };

  describe("meetsRequirements", () => {
    it("should return true when all requirements are met", () => {
      const requirements: CapabilityRequirement = {
        minPlanVersion: PlanVersion.V1_WORKFLOW,
        requiredOutputFormat: OutputFormat.JSON,
        requiredTools: ["swap_tool"],
        minQualityScore: 0.8,
      };

      const result = meetsRequirements(mockCapability, requirements);
      expect(result.meets).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it("should fail when model is not available", () => {
      const unavailableCapability = { ...mockCapability, available: false };
      const requirements: CapabilityRequirement = {};

      const result = meetsRequirements(unavailableCapability, requirements);
      expect(result.meets).toBe(false);
      expect(result.reasons[0]).toContain("not currently available");
    });

    it("should fail when certification is expired", () => {
      const expiredCapability = {
        ...mockCapability,
        certificationExpiry: new Date(Date.now() - 1000),
      };
      const requirements: CapabilityRequirement = {};

      const result = meetsRequirements(expiredCapability, requirements);
      expect(result.meets).toBe(false);
      expect(result.reasons[0]).toContain("certification expired");
    });

    it("should fail when plan version is not supported", () => {
      const requirements: CapabilityRequirement = {
        minPlanVersion: PlanVersion.V3_PHASED,
      };

      const result = meetsRequirements(mockCapability, requirements);
      expect(result.meets).toBe(false);
      expect(result.reasons[0]).toContain("plan version");
    });

    it("should fail when output format is not supported", () => {
      const requirements: CapabilityRequirement = {
        requiredOutputFormat: OutputFormat.STREAMING_JSON,
      };

      const result = meetsRequirements(mockCapability, requirements);
      expect(result.meets).toBe(false);
      expect(result.reasons[0]).toContain("output format");
    });

    it("should fail when required tool is not certified", () => {
      const requirements: CapabilityRequirement = {
        requiredTools: ["unknown_tool"],
      };

      const result = meetsRequirements(mockCapability, requirements);
      expect(result.meets).toBe(false);
      expect(result.reasons[0]).toContain("not certified for tools");
    });

    it("should fail when quality score is below minimum", () => {
      const requirements: CapabilityRequirement = {
        minQualityScore: 0.95,
      };

      const result = meetsRequirements(mockCapability, requirements);
      expect(result.meets).toBe(false);
      expect(result.reasons[0]).toContain("quality score");
    });

    it("should fail when safety requirements are not met", () => {
      const lowSafetyCapability = {
        ...mockCapability,
        safetyCompatibility: {
          ...mockCapability.safetyCompatibility,
          riskEstimation: false,
        },
      };
      const requirements: CapabilityRequirement = {
        safetyRequirements: {
          riskEstimation: true,
        },
      };

      const result = meetsRequirements(lowSafetyCapability, requirements);
      expect(result.meets).toBe(false);
      expect(result.reasons[0]).toContain("risk estimation");
    });

    it("should fail when latency exceeds maximum for high-risk operations", () => {
      const requirements: CapabilityRequirement = {
        highRisk: true,
        maxLatencyMs: 1500,
      };

      const result = meetsRequirements(mockCapability, requirements);
      expect(result.meets).toBe(false);
      expect(result.reasons[0]).toContain("P95 latency");
    });
  });

  describe("getCertificationStatus", () => {
    it("should return CERTIFIED for valid certification", () => {
      const status = getCertificationStatus(mockCapability);
      expect(status).toBe(CertificationStatus.CERTIFIED);
    });

    it("should return EXPIRED for expired certification", () => {
      const expiredCapability = {
        ...mockCapability,
        certificationExpiry: new Date(Date.now() - 1000),
      };
      const status = getCertificationStatus(expiredCapability);
      expect(status).toBe(CertificationStatus.EXPIRED);
    });

    it("should return UNCERTIFIED when certifiedAt is missing", () => {
      const uncertifiedCapability = {
        ...mockCapability,
        certifiedAt: undefined as any,
      };
      const status = getCertificationStatus(uncertifiedCapability);
      expect(status).toBe(CertificationStatus.UNCERTIFIED);
    });

    it("should return FAILED when conformance tests failed", () => {
      const failedCapability = {
        ...mockCapability,
        metadata: {
          conformanceTests: [
            {
              testId: "test1",
              category: "safety",
              passed: false,
              score: 0.5,
              details: "Failed safety test",
              testedAt: new Date(),
            },
          ],
        },
      };
      const status = getCertificationStatus(failedCapability);
      expect(status).toBe(CertificationStatus.FAILED);
    });
  });

  describe("generateToolSchemaHash", () => {
    it("should generate consistent hash for same metadata", () => {
      const metadata: ToolMetadata = {
        name: "test_tool",
        description: "Test tool",
        version: "1.0",
        category: "test",
        riskLevel: "low",
        capabilities: ["test"],
        parameters: {
          param1: {
            type: "string",
            description: "Test param",
            required: true,
          },
        },
        examples: [],
      };

      const hash1 = generateToolSchemaHash(metadata);
      const hash2 = generateToolSchemaHash(metadata);

      expect(hash1).toBe(hash2);
      expect(hash1).toBeTruthy();
    });

    it("should generate different hash for different metadata", () => {
      const metadata1: ToolMetadata = {
        name: "test_tool",
        description: "Test tool",
        version: "1.0",
        category: "test",
        riskLevel: "low",
        capabilities: ["test"],
        parameters: {},
        examples: [],
      };

      const metadata2: ToolMetadata = {
        ...metadata1,
        version: "2.0",
      };

      const hash1 = generateToolSchemaHash(metadata1);
      const hash2 = generateToolSchemaHash(metadata2);

      expect(hash1).not.toBe(hash2);
    });
  });
});
