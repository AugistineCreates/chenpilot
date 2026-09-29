/**
 * Model Capability and Certification System
 * 
 * Defines what capabilities each LLM model supports, ensuring semantic equivalence
 * before allowing fallback. Models must be explicitly certified for:
 * - Tool schema versions they can correctly interpret
 * - Plan structure versions they can generate
 * - Structured output formats they support
 * - Safety policy compatibility
 */

import { ToolMetadata } from "../registry/ToolMetadata";

/**
 * Semantic versioning for tool schemas
 * Models must be certified for specific schema versions
 */
export interface ToolSchemaVersion {
  /** Tool name */
  toolName: string;
  /** Semantic version (e.g., "1.0.0") */
  version: string;
  /** Schema hash for exact matching */
  schemaHash: string;
}

/**
 * Plan structure versions that models can generate
 */
export enum PlanVersion {
  /** Original workflow format: { workflow: [{ action, payload }] } */
  V1_WORKFLOW = "1.0",
  /** Enhanced with risk metadata: { workflow: [...], riskAssessment: {...} } */
  V2_RISK_AWARE = "2.0",
  /** Multi-phase plans with dependencies */
  V3_PHASED = "3.0",
}

/**
 * Structured output formats a model can reliably produce
 */
export enum OutputFormat {
  /** Basic JSON object */
  JSON = "json",
  /** JSON with strict schema validation */
  TYPED_JSON = "typed_json",
  /** Streaming JSON with partial parsing support */
  STREAMING_JSON = "streaming_json",
  /** Plain text (for non-structured responses) */
  TEXT = "text",
}

/**
 * Safety policy requirements
 */
export interface SafetyPolicyCompatibility {
  /** Can model respect asset whitelists? */
  assetTrustAware: boolean;
  /** Can model estimate risk tiers correctly? */
  riskEstimation: boolean;
  /** Does model understand approval requirements? */
  approvalAware: boolean;
  /** Can model follow role-based permissions? */
  rbacAware: boolean;
  /** Minimum confidence score for safety-critical operations (0-1) */
  minSafetyConfidence: number;
}

/**
 * Performance characteristics of a model
 */
export interface ModelPerformance {
  /** Average latency in milliseconds */
  avgLatencyMs: number;
  /** P95 latency in milliseconds */
  p95LatencyMs: number;
  /** Cost per 1K input tokens (USD) */
  costPerKInput: number;
  /** Cost per 1K output tokens (USD) */
  costPerKOutput: number;
  /** Maximum tokens supported */
  maxTokens: number;
  /** Average quality score from evaluations (0-1) */
  qualityScore: number;
}

/**
 * Complete capability definition for an LLM model
 */
export interface ModelCapability {
  /** Model identifier (e.g., "claude-3-5-haiku-20241022") */
  modelId: string;
  /** Human-readable name */
  displayName: string;
  /** Provider (anthropic, openai, etc.) */
  provider: string;
  
  /** Tool schemas this model is certified for */
  certifiedToolSchemas: ToolSchemaVersion[];
  /** Plan versions this model can generate */
  supportedPlanVersions: PlanVersion[];
  /** Output formats this model supports */
  supportedOutputFormats: OutputFormat[];
  /** Safety policy compatibility */
  safetyCompatibility: SafetyPolicyCompatibility;
  /** Performance characteristics */
  performance: ModelPerformance;
  
  /** When this model was certified */
  certifiedAt: Date;
  /** Expiration of certification (models need re-certification) */
  certificationExpiry?: Date;
  /** Whether this model is currently available */
  available: boolean;
  
  /** Additional metadata */
  metadata?: {
    /** Conformance test results */
    conformanceTests?: ConformanceTestResult[];
    /** Known limitations */
    limitations?: string[];
    /** Recommended use cases */
    recommendedFor?: string[];
  };
}

/**
 * Results from capability conformance tests
 */
export interface ConformanceTestResult {
  /** Test identifier */
  testId: string;
  /** Test category (tool_execution, plan_generation, safety_policy, etc.) */
  category: string;
  /** Whether test passed */
  passed: boolean;
  /** Test score (0-1) */
  score: number;
  /** Details about the test */
  details: string;
  /** When test was run */
  testedAt: Date;
}

/**
 * Capability requirements for a specific operation
 */
export interface CapabilityRequirement {
  /** Minimum plan version needed */
  minPlanVersion?: PlanVersion;
  /** Required output format */
  requiredOutputFormat?: OutputFormat;
  /** Tools that must be supported */
  requiredTools?: string[];
  /** Safety policies that must be respected */
  safetyRequirements?: Partial<SafetyPolicyCompatibility>;
  /** Minimum quality score required */
  minQualityScore?: number;
  /** Maximum acceptable latency (ms) */
  maxLatencyMs?: number;
  /** Whether this is a high-risk operation */
  highRisk?: boolean;
}

/**
 * Check if a model meets capability requirements
 */
export function meetsRequirements(
  capability: ModelCapability,
  requirements: CapabilityRequirement
): { meets: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Check if model is available
  if (!capability.available) {
    reasons.push(`Model ${capability.modelId} is not currently available`);
    return { meets: false, reasons };
  }

  // Check if certification is expired
  if (capability.certificationExpiry && capability.certificationExpiry < new Date()) {
    reasons.push(`Model ${capability.modelId} certification expired on ${capability.certificationExpiry.toISOString()}`);
    return { meets: false, reasons };
  }

  // Check plan version support
  if (requirements.minPlanVersion) {
    const supportedVersions = capability.supportedPlanVersions.map(v => parseFloat(v));
    const minVersion = parseFloat(requirements.minPlanVersion);
    const maxSupported = Math.max(...supportedVersions);
    
    if (maxSupported < minVersion) {
      reasons.push(`Model requires plan version >= ${minVersion}, but only supports up to ${maxSupported}`);
    }
  }

  // Check output format support
  if (requirements.requiredOutputFormat) {
    if (!capability.supportedOutputFormats.includes(requirements.requiredOutputFormat)) {
      reasons.push(`Model does not support required output format: ${requirements.requiredOutputFormat}`);
    }
  }

  // Check tool support
  if (requirements.requiredTools && requirements.requiredTools.length > 0) {
    const certifiedTools = new Set(capability.certifiedToolSchemas.map(t => t.toolName));
    const missingTools = requirements.requiredTools.filter(t => !certifiedTools.has(t));
    
    if (missingTools.length > 0) {
      reasons.push(`Model is not certified for tools: ${missingTools.join(", ")}`);
    }
  }

  // Check safety requirements
  if (requirements.safetyRequirements) {
    const safety = capability.safetyCompatibility;
    const reqs = requirements.safetyRequirements;

    if (reqs.assetTrustAware && !safety.assetTrustAware) {
      reasons.push("Model does not support asset trust awareness");
    }
    if (reqs.riskEstimation && !safety.riskEstimation) {
      reasons.push("Model does not support risk estimation");
    }
    if (reqs.approvalAware && !safety.approvalAware) {
      reasons.push("Model does not support approval awareness");
    }
    if (reqs.rbacAware && !safety.rbacAware) {
      reasons.push("Model does not support RBAC awareness");
    }
    if (reqs.minSafetyConfidence !== undefined && safety.minSafetyConfidence < reqs.minSafetyConfidence) {
      reasons.push(`Model safety confidence ${safety.minSafetyConfidence} is below required ${reqs.minSafetyConfidence}`);
    }
  }

  // Check quality score
  if (requirements.minQualityScore !== undefined) {
    if (capability.performance.qualityScore < requirements.minQualityScore) {
      reasons.push(`Model quality score ${capability.performance.qualityScore} is below required ${requirements.minQualityScore}`);
    }
  }

  // Check latency for high-risk operations
  if (requirements.highRisk && requirements.maxLatencyMs !== undefined) {
    if (capability.performance.p95LatencyMs > requirements.maxLatencyMs) {
      reasons.push(`Model P95 latency ${capability.performance.p95LatencyMs}ms exceeds maximum ${requirements.maxLatencyMs}ms for high-risk operation`);
    }
  } else if (requirements.maxLatencyMs !== undefined) {
    if (capability.performance.avgLatencyMs > requirements.maxLatencyMs) {
      reasons.push(`Model average latency ${capability.performance.avgLatencyMs}ms exceeds maximum ${requirements.maxLatencyMs}ms`);
    }
  }

  return {
    meets: reasons.length === 0,
    reasons,
  };
}

/**
 * Generate a schema hash for tool metadata (for certification)
 */
export function generateToolSchemaHash(metadata: ToolMetadata): string {
  const relevantFields = {
    name: metadata.name,
    version: metadata.version,
    parameters: metadata.parameters,
    riskLevel: metadata.riskLevel,
    capabilities: metadata.capabilities,
  };
  
  // Simple hash implementation (in production, use crypto.subtle or similar)
  const json = JSON.stringify(relevantFields, Object.keys(relevantFields).sort());
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Certification status for a model
 */
export enum CertificationStatus {
  CERTIFIED = "certified",
  EXPIRED = "expired",
  PENDING = "pending",
  FAILED = "failed",
  UNCERTIFIED = "uncertified",
}

/**
 * Get the certification status of a model
 */
export function getCertificationStatus(capability: ModelCapability): CertificationStatus {
  if (!capability.certifiedAt) {
    return CertificationStatus.UNCERTIFIED;
  }

  if (capability.certificationExpiry && capability.certificationExpiry < new Date()) {
    return CertificationStatus.EXPIRED;
  }

  // Check if conformance tests are available and if any failed
  const tests = capability.metadata?.conformanceTests;
  if (tests && tests.length > 0) {
    const recentTests = tests.filter(t => {
      const ageMs = Date.now() - t.testedAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      return ageDays <= 30; // Tests from last 30 days
    });

    if (recentTests.length === 0) {
      return CertificationStatus.EXPIRED;
    }

    const failedTests = recentTests.filter(t => !t.passed);
    if (failedTests.length > 0) {
      return CertificationStatus.FAILED;
    }
  }

  return CertificationStatus.CERTIFIED;
}
