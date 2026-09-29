/**
 * Model Fallback System - Public API
 * 
 * Central exports for the model fallback and semantic verification system
 */

// Core types
export {
  ModelCapability,
  CapabilityRequirement,
  PlanVersion,
  OutputFormat,
  ToolSchemaVersion,
  SafetyPolicyCompatibility,
  ModelPerformance,
  ConformanceTestResult,
  CertificationStatus,
  meetsRequirements,
  getCertificationStatus,
  generateToolSchemaHash,
} from "./ModelCapability";

// Registry
export {
  ModelRegistry,
  SelectionStrategy,
  FallbackChain,
  ModelSelectionResult,
  modelRegistry,
} from "./ModelRegistry";

// Validation
export {
  OutputValidator,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  SemanticIssue,
  WorkflowPlanV1,
  WorkflowPlanV2,
  outputValidator,
} from "./OutputValidator";

// Orchestrator
export {
  ModelFallbackOrchestrator,
  LLMCallContext,
  LLMCallResult,
  FallbackDecision,
  RetryStrategy,
} from "./ModelFallbackOrchestrator";

// Differential Evaluation
export {
  DifferentialEvaluator,
  DifferentialTestCase,
  ModelTestResult,
  ComparisonResult,
  Difference,
  DifferentialReport,
  differentialEvaluator,
} from "./DifferentialEvaluator";

// Initialization
export {
  initializeModelRegistry,
  runStartupDifferentialEvaluation,
  syncModelToolSchemas,
  getModelRegistryStats,
} from "./modelInitialization";
