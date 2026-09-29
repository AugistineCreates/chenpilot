/**
 * Runtime Output Validation
 * 
 * Validates LLM responses against expected schemas and detects semantic drift.
 * Ensures output quality and consistency across different models.
 */

import { PlanVersion, OutputFormat } from "./ModelCapability";
import { ToolMetadata, ParameterDefinition } from "../registry/ToolMetadata";
import { toolRegistry } from "../registry/ToolRegistry";
import logger from "../../config/logger";

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Overall quality score (0-1) */
  qualityScore: number;
  /** Validation errors */
  errors: ValidationError[];
  /** Validation warnings (non-blocking) */
  warnings: ValidationWarning[];
  /** Detected semantic issues */
  semanticIssues: SemanticIssue[];
}

/**
 * Validation error (blocking)
 */
export interface ValidationError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Path to the problematic field (e.g., "workflow[0].payload.amount") */
  path?: string;
  /** Severity level */
  severity: "critical" | "high" | "medium";
}

/**
 * Validation warning (non-blocking)
 */
export interface ValidationWarning {
  /** Warning code */
  code: string;
  /** Warning message */
  message: string;
  /** Path to the field */
  path?: string;
}

/**
 * Semantic issue (potential drift from expected behavior)
 */
export interface SemanticIssue {
  /** Issue type */
  type: "unexpected_tool" | "suspicious_value" | "missing_context" | "inconsistent_reasoning";
  /** Description */
  description: string;
  /** Confidence that this is actually an issue (0-1) */
  confidence: number;
  /** Path to the problematic field */
  path?: string;
}

/**
 * Workflow plan structure (V1)
 */
export interface WorkflowPlanV1 {
  workflow: Array<{
    action: string;
    payload: Record<string, unknown>;
  }>;
}

/**
 * Workflow plan structure (V2 with risk awareness)
 */
export interface WorkflowPlanV2 extends WorkflowPlanV1 {
  riskAssessment?: {
    overallRisk: "low" | "medium" | "high" | "critical";
    riskScore: number;
    considerations: string[];
  };
}

/**
 * Output validator
 */
export class OutputValidator {
  /**
   * Validate LLM output against expected format and schema
   */
  validate(
    output: unknown,
    expectedFormat: OutputFormat,
    expectedPlanVersion?: PlanVersion,
    context?: { userId?: string; userInput?: string }
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const semanticIssues: SemanticIssue[] = [];

    // Format validation
    if (expectedFormat === OutputFormat.JSON || expectedFormat === OutputFormat.TYPED_JSON) {
      if (typeof output !== "object" || output === null) {
        errors.push({
          code: "INVALID_FORMAT",
          message: `Expected JSON object, got ${typeof output}`,
          severity: "critical",
        });
        return {
          valid: false,
          qualityScore: 0,
          errors,
          warnings,
          semanticIssues,
        };
      }
    }

    // Plan version validation
    if (expectedPlanVersion) {
      const planValidation = this.validatePlanVersion(output, expectedPlanVersion);
      errors.push(...planValidation.errors);
      warnings.push(...planValidation.warnings);
    }

    // Workflow structure validation
    if (this.isWorkflowPlan(output)) {
      const workflowValidation = this.validateWorkflow(output.workflow, context);
      errors.push(...workflowValidation.errors);
      warnings.push(...workflowValidation.warnings);
      semanticIssues.push(...workflowValidation.semanticIssues);
    }

    // Compute quality score
    const qualityScore = this.computeQualityScore(output, errors, warnings, semanticIssues);

    return {
      valid: errors.filter(e => e.severity === "critical" || e.severity === "high").length === 0,
      qualityScore,
      errors,
      warnings,
      semanticIssues,
    };
  }

  /**
   * Validate plan version compliance
   */
  private validatePlanVersion(
    output: unknown,
    expectedVersion: PlanVersion
  ): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (typeof output !== "object" || output === null) {
      return { errors, warnings };
    }

    const plan = output as Record<string, unknown>;

    switch (expectedVersion) {
      case PlanVersion.V1_WORKFLOW:
        if (!plan.workflow || !Array.isArray(plan.workflow)) {
          errors.push({
            code: "MISSING_WORKFLOW",
            message: "Plan version 1.0 requires 'workflow' array",
            path: "workflow",
            severity: "critical",
          });
        }
        break;

      case PlanVersion.V2_RISK_AWARE:
        if (!plan.workflow || !Array.isArray(plan.workflow)) {
          errors.push({
            code: "MISSING_WORKFLOW",
            message: "Plan version 2.0 requires 'workflow' array",
            path: "workflow",
            severity: "critical",
          });
        }
        if (!plan.riskAssessment) {
          warnings.push({
            code: "MISSING_RISK_ASSESSMENT",
            message: "Plan version 2.0 should include 'riskAssessment'",
            path: "riskAssessment",
          });
        }
        break;

      case PlanVersion.V3_PHASED:
        // V3 validation would go here (not yet implemented)
        warnings.push({
          code: "UNSUPPORTED_VERSION",
          message: "Plan version 3.0 validation not yet implemented",
        });
        break;
    }

    return { errors, warnings };
  }

  /**
   * Validate workflow structure and tool calls
   */
  private validateWorkflow(
    workflow: Array<{ action: string; payload: Record<string, unknown> }>,
    context?: { userId?: string; userInput?: string }
  ): {
    errors: ValidationError[];
    warnings: ValidationWarning[];
    semanticIssues: SemanticIssue[];
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const semanticIssues: SemanticIssue[] = [];

    if (!Array.isArray(workflow)) {
      errors.push({
        code: "INVALID_WORKFLOW",
        message: "Workflow must be an array",
        path: "workflow",
        severity: "critical",
      });
      return { errors, warnings, semanticIssues };
    }

    if (workflow.length === 0) {
      warnings.push({
        code: "EMPTY_WORKFLOW",
        message: "Workflow contains no steps",
        path: "workflow",
      });
    }

    // Validate each step
    workflow.forEach((step, index) => {
      const stepPath = `workflow[${index}]`;

      // Check step structure
      if (!step.action || typeof step.action !== "string") {
        errors.push({
          code: "MISSING_ACTION",
          message: "Workflow step must have 'action' string",
          path: `${stepPath}.action`,
          severity: "critical",
        });
        return;
      }

      if (!step.payload || typeof step.payload !== "object") {
        errors.push({
          code: "MISSING_PAYLOAD",
          message: "Workflow step must have 'payload' object",
          path: `${stepPath}.payload`,
          severity: "critical",
        });
        return;
      }

      // Validate tool exists
      const tool = toolRegistry.getTool(step.action);
      if (!tool) {
        errors.push({
          code: "UNKNOWN_TOOL",
          message: `Tool '${step.action}' is not registered`,
          path: `${stepPath}.action`,
          severity: "high",
        });
        
        // Check if this might be a hallucinated tool
        semanticIssues.push({
          type: "unexpected_tool",
          description: `LLM referenced unknown tool '${step.action}'. Possible hallucination.`,
          confidence: 0.8,
          path: stepPath,
        });
        return;
      }

      // Validate payload against tool schema
      const payloadValidation = this.validatePayload(step.payload, tool.metadata, stepPath);
      errors.push(...payloadValidation.errors);
      warnings.push(...payloadValidation.warnings);
      semanticIssues.push(...payloadValidation.semanticIssues);
    });

    // Check for semantic consistency with user input
    if (context?.userInput) {
      const consistencyIssues = this.checkSemanticConsistency(workflow, context.userInput);
      semanticIssues.push(...consistencyIssues);
    }

    return { errors, warnings, semanticIssues };
  }

  /**
   * Validate payload against tool parameter schema
   */
  private validatePayload(
    payload: Record<string, unknown>,
    toolMetadata: ToolMetadata,
    basePath: string
  ): {
    errors: ValidationError[];
    warnings: ValidationWarning[];
    semanticIssues: SemanticIssue[];
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const semanticIssues: SemanticIssue[] = [];

    // Check required parameters
    for (const [paramName, paramDef] of Object.entries(toolMetadata.parameters)) {
      const value = payload[paramName];
      const paramPath = `${basePath}.payload.${paramName}`;

      if (paramDef.required && (value === undefined || value === null)) {
        errors.push({
          code: "MISSING_REQUIRED_PARAM",
          message: `Required parameter '${paramName}' is missing`,
          path: paramPath,
          severity: "high",
        });
        continue;
      }

      if (value === undefined || value === null) {
        continue; // Optional parameter not provided
      }

      // Type validation
      const typeValidation = this.validateParameterType(value, paramDef, paramPath);
      errors.push(...typeValidation.errors);
      warnings.push(...typeValidation.warnings);

      // Semantic validation
      const semanticValidation = this.validateParameterSemantics(
        paramName,
        value,
        paramDef,
        paramPath
      );
      semanticIssues.push(...semanticValidation);
    }

    // Check for unexpected parameters
    for (const paramName of Object.keys(payload)) {
      if (!toolMetadata.parameters[paramName]) {
        warnings.push({
          code: "UNEXPECTED_PARAM",
          message: `Unexpected parameter '${paramName}' not in tool schema`,
          path: `${basePath}.payload.${paramName}`,
        });
      }
    }

    return { errors, warnings, semanticIssues };
  }

  /**
   * Validate parameter type
   */
  private validateParameterType(
    value: unknown,
    paramDef: ParameterDefinition,
    path: string
  ): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const actualType = Array.isArray(value) ? "array" : typeof value;

    if (paramDef.type !== actualType) {
      // Allow number-to-string coercion for common cases
      if (paramDef.type === "string" && typeof value === "number") {
        warnings.push({
          code: "TYPE_COERCION",
          message: `Parameter expects string but got number (coercible)`,
          path,
        });
      } else {
        errors.push({
          code: "TYPE_MISMATCH",
          message: `Parameter expects ${paramDef.type} but got ${actualType}`,
          path,
          severity: "high",
        });
      }
    }

    // Enum validation
    if (paramDef.enum && typeof value === "string") {
      if (!paramDef.enum.includes(value)) {
        errors.push({
          code: "INVALID_ENUM",
          message: `Value '${value}' not in allowed enum: [${paramDef.enum.join(", ")}]`,
          path,
          severity: "high",
        });
      }
    }

    // Range validation for numbers
    if (typeof value === "number") {
      if (paramDef.min !== undefined && value < paramDef.min) {
        errors.push({
          code: "VALUE_TOO_SMALL",
          message: `Value ${value} is below minimum ${paramDef.min}`,
          path,
          severity: "medium",
        });
      }
      if (paramDef.max !== undefined && value > paramDef.max) {
        errors.push({
          code: "VALUE_TOO_LARGE",
          message: `Value ${value} exceeds maximum ${paramDef.max}`,
          path,
          severity: "medium",
        });
      }
    }

    // Pattern validation for strings
    if (typeof value === "string" && paramDef.pattern) {
      const regex = new RegExp(paramDef.pattern);
      if (!regex.test(value)) {
        errors.push({
          code: "PATTERN_MISMATCH",
          message: `Value does not match pattern: ${paramDef.pattern}`,
          path,
          severity: "medium",
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * Validate parameter semantics (detect suspicious values)
   */
  private validateParameterSemantics(
    paramName: string,
    value: unknown,
    paramDef: ParameterDefinition,
    path: string
  ): SemanticIssue[] {
    const issues: SemanticIssue[] = [];

    // Check for suspiciously large amounts
    if (paramName.toLowerCase().includes("amount") && typeof value === "number") {
      if (value > 1000000) {
        issues.push({
          type: "suspicious_value",
          description: `Very large amount: ${value}. Possible misunderstanding or error.`,
          confidence: 0.6,
          path,
        });
      }
    }

    // Check for zero or negative amounts where positive expected
    if (
      (paramName.toLowerCase().includes("amount") || paramName.toLowerCase().includes("quantity")) &&
      typeof value === "number"
    ) {
      if (value <= 0) {
        issues.push({
          type: "suspicious_value",
          description: `Non-positive ${paramName}: ${value}. Likely incorrect.`,
          confidence: 0.9,
          path,
        });
      }
    }

    // Check for empty strings in important fields
    if (typeof value === "string" && value.trim() === "") {
      if (paramDef.required) {
        issues.push({
          type: "suspicious_value",
          description: `Empty string for required parameter '${paramName}'`,
          confidence: 0.95,
          path,
        });
      }
    }

    return issues;
  }

  /**
   * Check semantic consistency between workflow and user input
   */
  private checkSemanticConsistency(
    workflow: Array<{ action: string; payload: Record<string, unknown> }>,
    userInput: string
  ): SemanticIssue[] {
    const issues: SemanticIssue[] = [];
    const inputLower = userInput.toLowerCase();

    // Check if user mentioned specific tools but workflow uses different ones
    const mentionedTools = ["swap", "transfer", "send", "stake", "unstake", "borrow", "lend"];
    const usedActions = workflow.map(s => s.action.toLowerCase());

    for (const toolHint of mentionedTools) {
      if (inputLower.includes(toolHint)) {
        const matchingAction = usedActions.find(a => a.includes(toolHint));
        if (!matchingAction) {
          issues.push({
            type: "inconsistent_reasoning",
            description: `User mentioned '${toolHint}' but workflow doesn't include related action`,
            confidence: 0.5,
          });
        }
      }
    }

    // Check if user mentioned specific assets
    const assetPattern = /\b(XLM|USDC|BTC|ETH|STRK)\b/gi;
    const mentionedAssets = Array.from(new Set(
      (userInput.match(assetPattern) || []).map(a => a.toUpperCase())
    ));

    if (mentionedAssets.length > 0) {
      const workflowStr = JSON.stringify(workflow).toUpperCase();
      for (const asset of mentionedAssets) {
        if (!workflowStr.includes(asset)) {
          issues.push({
            type: "missing_context",
            description: `User mentioned asset '${asset}' but it doesn't appear in workflow`,
            confidence: 0.7,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Compute overall quality score
   */
  private computeQualityScore(
    output: unknown,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    semanticIssues: SemanticIssue[]
  ): number {
    let score = 1.0;

    // Penalize errors
    for (const error of errors) {
      switch (error.severity) {
        case "critical":
          score -= 0.5;
          break;
        case "high":
          score -= 0.3;
          break;
        case "medium":
          score -= 0.1;
          break;
      }
    }

    // Penalize warnings (less severe)
    score -= warnings.length * 0.05;

    // Penalize semantic issues based on confidence
    for (const issue of semanticIssues) {
      score -= issue.confidence * 0.15;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Type guard for workflow plans
   */
  private isWorkflowPlan(output: unknown): output is WorkflowPlanV1 {
    return (
      typeof output === "object" &&
      output !== null &&
      "workflow" in output &&
      Array.isArray((output as WorkflowPlanV1).workflow)
    );
  }
}

// Singleton instance
export const outputValidator = new OutputValidator();
