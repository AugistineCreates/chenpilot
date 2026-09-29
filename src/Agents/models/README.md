# Model Fallback & Semantic Equivalence Verification

This module implements semantic equivalence verification for LLM model fallback, ensuring that availability fallback does not silently change safety behavior.

## Overview

The model fallback system provides:

- **Capability Certification**: Models are certified for specific tool schemas, plan versions, and safety policies
- **Runtime Validation**: LLM outputs are validated against expected schemas and quality standards
- **Automatic Fallback**: When a model fails or produces invalid output, the system automatically falls back to alternative models
- **Decision Tracking**: All fallback decisions are logged with reasons for audit and debugging
- **Differential Evaluation**: Cross-model testing to detect semantic differences and safety behavior variations

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentLLM.callLLM()                      │
│                    (Entry Point)                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              ModelFallbackOrchestrator                      │
│  • Model selection                                          │
│  • Retry logic                                              │
│  • Decision tracking                                        │
└────────────┬──────────────────────┬─────────────────────────┘
             │                      │
             ▼                      ▼
┌─────────────────────┐   ┌─────────────────────────────────┐
│   ModelRegistry     │   │     OutputValidator             │
│  • Model selection  │   │  • Schema validation            │
│  • Capability check │   │  • Semantic drift detection     │
│  • Fallback chains  │   │  • Quality scoring              │
└─────────────────────┘   └─────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│                   ModelCapability                           │
│  • Tool schema versions                                     │
│  • Plan versions                                            │
│  • Safety compatibility                                     │
│  • Performance characteristics                              │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. ModelCapability

Defines what capabilities each model supports:

```typescript
interface ModelCapability {
  modelId: string;
  certifiedToolSchemas: ToolSchemaVersion[];
  supportedPlanVersions: PlanVersion[];
  supportedOutputFormats: OutputFormat[];
  safetyCompatibility: SafetyPolicyCompatibility;
  performance: ModelPerformance;
  certifiedAt: Date;
  available: boolean;
}
```

**Key Features:**
- Tool schema versioning with hash-based change detection
- Plan structure version support (V1, V2, V3)
- Safety policy requirements (asset trust, risk estimation, RBAC)
- Performance metrics (latency, cost, quality score)
- Certification expiry tracking

### 2. ModelRegistry

Central registry for managing certified models:

```typescript
const registry = new ModelRegistry();

// Register models
registry.register(claudeHaikuCapability);
registry.register(claudeSonnetCapability);

// Register fallback chain
registry.registerFallbackChain("default", {
  primary: "claude-3-5-haiku-20241022",
  fallbacks: ["claude-3-5-sonnet-20241022"],
  strategy: SelectionStrategy.QUALITY_FIRST,
});

// Select best model for requirements
const result = registry.selectModel({
  minPlanVersion: PlanVersion.V2_RISK_AWARE,
  minQualityScore: 0.8,
  requiredTools: ["swap_tool"],
});
```

**Selection Strategies:**
- `QUALITY_FIRST`: Select highest quality model
- `LATENCY_FIRST`: Select lowest latency model
- `COST_FIRST`: Select most cost-effective model
- `BALANCED`: Balance quality, latency, and cost

### 3. OutputValidator

Validates LLM responses at runtime:

```typescript
const validator = new OutputValidator();

const result = validator.validate(
  llmOutput,
  OutputFormat.JSON,
  PlanVersion.V1_WORKFLOW,
  { userId, userInput }
);

// result.valid: boolean
// result.qualityScore: number (0-1)
// result.errors: ValidationError[]
// result.warnings: ValidationWarning[]
// result.semanticIssues: SemanticIssue[]
```

**Validation Checks:**
- Format validation (JSON structure)
- Plan version compliance
- Tool existence and schema matching
- Parameter type and range validation
- Semantic consistency with user input
- Suspicious value detection

### 4. ModelFallbackOrchestrator

Orchestrates model execution with automatic fallback:

```typescript
const orchestrator = new ModelFallbackOrchestrator(client, {
  maxRetries: 2,
  baseDelayMs: 1000,
  exponentialBackoff: true,
  tryDifferentModels: true,
});

const result = await orchestrator.executeCall(
  {
    callId: "unique-id",
    agentId: "agent-1",
    userId: "user-123",
    requirements: {
      minPlanVersion: PlanVersion.V2_RISK_AWARE,
      minQualityScore: 0.8,
    },
    fallbackChainName: "default",
  },
  prompt,
  { asJson: true }
);

// result.modelId: string (which model was used)
// result.usedFallback: boolean
// result.validation: ValidationResult
// result.decisionLog: FallbackDecision[]
```

**Fallback Triggers:**
- API errors (rate limits, timeouts, unavailability)
- Validation failures (invalid output, low quality score)
- Capability mismatches (model doesn't support required features)

### 5. DifferentialEvaluator

Cross-model testing for semantic equivalence:

```typescript
const evaluator = new DifferentialEvaluator();

// Load standard high-risk test suite
evaluator.loadStandardTests();

// Run evaluation across multiple models
const report = await evaluator.evaluate(
  ["model-1", "model-2", "model-3"],
  callModel
);

// report.summary: { totalTests, passedTests, equivalentPairs, criticalDifferences }
// report.unsafeModels: string[] (models that failed critical tests)
// report.comparisons: ComparisonResult[] (pairwise model comparisons)
```

**Test Categories:**
- `high_risk`: Large amounts, untrusted assets
- `safety_policy`: Zero/negative amounts, forbidden operations
- `tool_execution`: Correct tool selection
- `plan_generation`: Multi-step workflow correctness
- `edge_case`: Ambiguous requests, unknown tools

## Configuration

### Environment Variables

Add to `.env`:

```bash
# Primary model for LLM operations
MODEL_PRIMARY=claude-3-5-haiku-20241022

# Fallback models (comma-separated, in priority order)
MODEL_FALLBACKS=claude-3-5-sonnet-20241022,claude-3-opus-20240229

# Model selection strategy: quality_first, latency_first, cost_first, balanced
MODEL_SELECTION_STRATEGY=quality_first

# Enable semantic equivalence verification
MODEL_VERIFY_EQUIVALENCE=true

# Maximum retry attempts across models
MODEL_MAX_RETRIES=2

# Enable differential evaluation on startup
MODEL_DIFFERENTIAL_EVAL_ON_STARTUP=false

# Minimum quality score for outputs (0-1)
MODEL_MIN_QUALITY_SCORE=0.7
```

### Initialization

Initialize the model registry on startup:

```typescript
import { initializeModelRegistry } from "./Agents/models/modelInitialization";

// Initialize registry with certified models
initializeModelRegistry();

// Optionally run differential evaluation
await runStartupDifferentialEvaluation(async (modelId, prompt) => {
  // Your model calling logic
});
```

## Usage

### Basic Usage

The fallback system is automatically integrated into `AgentLLM.callLLM()`:

```typescript
import { agentLLM } from "./Agents/agent";

const response = await agentLLM.callLLM(
  "agent-id",
  "system-prompt",
  "user-input",
  true, // asJson
  30000, // timeout
  "trace-id",
  {
    userId: "user-123",
    requirements: {
      minQualityScore: 0.8,
      highRisk: true,
    },
  }
);
```

### Custom Requirements

Specify capability requirements for specific operations:

```typescript
const response = await agentLLM.callLLM(
  "agent-id",
  prompt,
  userInput,
  true,
  undefined,
  undefined,
  {
    requirements: {
      minPlanVersion: PlanVersion.V2_RISK_AWARE,
      requiredTools: ["swap_tool", "balance_query"],
      safetyRequirements: {
        assetTrustAware: true,
        riskEstimation: true,
      },
      minQualityScore: 0.9,
      highRisk: true,
      maxLatencyMs: 2000,
    },
  }
);
```

### Monitoring Metrics

Track fallback usage and performance:

```typescript
const metrics = agentLLM.getMetrics();

console.log({
  totalCalls: metrics.totalCalls,
  successfulCalls: metrics.successfulCalls,
  fallbackCount: metrics.fallbackCount,
  fallbackRate: metrics.fallbackRate,
  validationFailures: metrics.validationFailures,
});
```

### Manual Model Selection

Select models programmatically:

```typescript
import { modelRegistry, SelectionStrategy } from "./Agents/models/ModelRegistry";

const selection = modelRegistry.selectModel(
  {
    minQualityScore: 0.85,
    requiredTools: ["swap_tool"],
  },
  SelectionStrategy.QUALITY_FIRST
);

if (selection) {
  console.log(`Selected: ${selection.model.displayName}`);
  console.log(`Is fallback: ${selection.isFallback}`);
}
```

## Acceptance Criteria Verification

### ✅ Each model is certified for explicit plan and tool schema versions

- Models are registered with `certifiedToolSchemas` including version and hash
- `generateToolSchemaHash()` creates deterministic hashes from tool metadata
- Registry can sync schemas: `modelRegistry.syncToolSchemas()`

### ✅ Unsupported capabilities do not fall back silently

- `meetsRequirements()` checks all capability dimensions
- Selection returns `null` when no compatible models exist
- Decision log records why each model was rejected
- Logs include warnings for certification mismatches

### ✅ Cross-model differential evaluations cover high-risk intents

- `DifferentialEvaluator` includes standard high-risk test suite
- Tests cover: asset trust, zero/negative amounts, tool hallucination
- Pairwise comparisons detect safety behavior divergence
- Critical differences are flagged with severity levels

### ✅ Runtime records which fallback decision was taken and why

- Every call produces a `decisionLog: FallbackDecision[]`
- Decision types: `primary_selected`, `fallback_triggered`, `validation_failed`, etc.
- Each decision includes timestamp, model, success status, and reason
- Metrics track fallback rate and validation failures

## Testing

Run the test suite:

```bash
# Unit tests
npm test -- src/Agents/models/__tests__/ModelCapability.test.ts
npm test -- src/Agents/models/__tests__/ModelRegistry.test.ts
npm test -- src/Agents/models/__tests__/OutputValidator.test.ts
npm test -- src/Agents/models/__tests__/DifferentialEvaluator.test.ts

# Integration tests
npm test -- src/Agents/models/__tests__/ModelFallback.integration.test.ts
```

## Best Practices

1. **Always specify requirements for high-risk operations**
   ```typescript
   requirements: {
     highRisk: true,
     minQualityScore: 0.9,
     safetyRequirements: { riskEstimation: true }
   }
   ```

2. **Monitor fallback rates in production**
   - High fallback rates may indicate primary model issues
   - Use metrics to trigger alerts

3. **Re-certify models when tool schemas change**
   ```typescript
   const needsRecert = modelRegistry.syncToolSchemas();
   // Schedule recertification for needsRecert models
   ```

4. **Run differential evaluation before deploying new models**
   - Ensure semantic equivalence with existing models
   - Check for safety behavior regression

5. **Review decision logs for unexpected fallbacks**
   - Investigate validation failures
   - Tune quality score thresholds if needed

## Troubleshooting

### High Fallback Rate

**Symptom:** `fallbackRate > 0.2`

**Possible Causes:**
- Primary model frequently unavailable (check API status)
- Primary model quality degraded (run differential evaluation)
- Requirements too strict (review `minQualityScore`)

**Solutions:**
- Adjust primary model in configuration
- Lower quality threshold for non-critical operations
- Add more fallback models to chain

### Validation Failures

**Symptom:** `validationFailures` increasing

**Possible Causes:**
- Model producing malformed output
- Tool schemas changed without model recertification
- Quality threshold too high

**Solutions:**
- Check model certification status
- Run `syncToolSchemas()` and recertify models
- Review validation error patterns in logs

### No Compatible Models

**Symptom:** Selection returns `null`

**Possible Causes:**
- All models marked unavailable
- Capability requirements too restrictive
- Models not certified for required tools

**Solutions:**
- Check model availability in registry
- Relax non-critical requirements
- Register additional models or certify existing ones

## Future Enhancements

- **Streaming support**: Add `STREAMING_JSON` output validation
- **Model performance tracking**: Automatic quality score updates based on production metrics
- **A/B testing**: Compare model performance on live traffic
- **Custom conformance tests**: Allow teams to define domain-specific test suites
- **Certification automation**: Auto-generate conformance tests from tool metadata

## Related Files

- `src/Agents/agent.ts` - AgentLLM integration
- `src/config/config.ts` - Configuration loading
- `src/Agents/registry/ToolRegistry.ts` - Tool registration
- `src/Agents/policy/PolicyEnforcer.ts` - Policy enforcement
- `.env.example` - Environment variable templates
