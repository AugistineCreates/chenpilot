/**
 * Temporal Safety Verification Engine
 * 
 * High-level API for validating execution plans against temporal safety properties.
 * Integrates the state machine with plan pre-processing, produces actionable error messages,
 * and enables plan repair suggestions.
 */

import { ExecutionPlan, PlanStep } from '../AgentPlanner';
import {
  PlanStateMachine,
  TemporalVerificationResult,
  TemporalInvariant,
  CounterExample,
  StepState,
} from './PlanStateMachine';
import logger from '../../../config/logger';

/**
 * Configuration for the verification engine
 */
export interface VerificationConfig {
  /**
   * Fail on any violation or only on critical violations
   */
  failOnWarning: boolean;
  
  /**
   * Enable repair suggestions for failed plans
   */
  enableRepairSuggestions: boolean;
  
  /**
   * Custom temporal invariants to check
   */
  customInvariants: TemporalInvariant[];
  
  /**
   * Maximum recursion depth for dependency analysis
   */
  maxAnalysisDepth: number;
}

/**
 * Repair suggestion for a failed plan
 */
export interface RepairSuggestion {
  type: 'reorder' | 'insert_step' | 'remove_step' | 'modify_dependency';
  description: string;
  affectedSteps: number[];
  suggestedAction: string;
  estimatedImpact: 'low' | 'medium' | 'high';
}

/**
 * Comprehensive verification result with repair suggestions
 */
export interface VerificationReport {
  success: boolean;
  plan: ExecutionPlan;
  verification: TemporalVerificationResult;
  summary: string;
  repairs: RepairSuggestion[];
  executionSafe: boolean;
  recommendations: string[];
}

export class TemporalSafetyEngine {
  private config: VerificationConfig;
  private verificationCache: Map<string, VerificationReport>;

  constructor(config: Partial<VerificationConfig> = {}) {
    this.config = {
      failOnWarning: config.failOnWarning ?? false,
      enableRepairSuggestions: config.enableRepairSuggestions ?? true,
      customInvariants: config.customInvariants ?? [],
      maxAnalysisDepth: config.maxAnalysisDepth ?? 100,
    };
    this.verificationCache = new Map();
  }

  /**
   * Verify a plan and produce a comprehensive report
   */
  async verify(plan: ExecutionPlan): Promise<VerificationReport> {
    // Check cache
    const cached = this.verificationCache.get(plan.planId);
    if (cached) {
      return cached;
    }

    try {
      // Pre-process plan to detect obvious issues
      const preCheckIssues = this.preCheckPlan(plan);
      if (preCheckIssues.length > 0) {
        const report = this.createFailureReport(plan, preCheckIssues);
        this.verificationCache.set(plan.planId, report);
        return report;
      }

      // Run state machine verification
      const stateMachine = PlanStateMachine.create(
        plan,
        this.config.customInvariants
      );
      const verification = await stateMachine.verify();

      // Determine if plan is executable
      const executionSafe = verification.valid &&
        (!this.config.failOnWarning || verification.diagnostics.warnings === 0);

      // Generate repair suggestions if needed
      const repairs = executionSafe
        ? []
        : this.config.enableRepairSuggestions
          ? this.generateRepairSuggestions(plan, verification)
          : [];

      // Generate recommendations
      const recommendations = this.generateRecommendations(verification, repairs);

      const report: VerificationReport = {
        success: executionSafe,
        plan,
        verification,
        summary: this.generateSummary(verification, executionSafe),
        repairs,
        executionSafe,
        recommendations,
      };

      this.verificationCache.set(plan.planId, report);
      
      if (!executionSafe) {
        logger.warn('Temporal safety verification failed', {
          planId: plan.planId,
          issues: verification.cycles.length + verification.unreachableSteps.length + verification.violatedInvariants.length,
        });
      }

      return report;
    } catch (error) {
      logger.error('Verification engine error', {
        error,
        planId: plan.planId,
      });
      
      return {
        success: false,
        plan,
        verification: this.getEmptyVerification(plan),
        summary: `Verification engine error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        repairs: [],
        executionSafe: false,
        recommendations: ['Plan verification encountered an unexpected error. Please review plan manually.'],
      };
    }
  }

  /**
   * Pre-check plan for obvious structural issues
   */
  private preCheckPlan(plan: ExecutionPlan): string[] {
    const issues: string[] = [];

    if (!plan.steps || plan.steps.length === 0) {
      issues.push('Plan has no steps');
      return issues;
    }

    if (plan.totalSteps !== plan.steps.length) {
      issues.push(`Plan step count mismatch: expected ${plan.totalSteps}, got ${plan.steps.length}`);
    }

    // Check for duplicate step numbers
    const stepNumbers = new Set<number>();
    for (const step of plan.steps) {
      if (stepNumbers.has(step.stepNumber)) {
        issues.push(`Duplicate step number: ${step.stepNumber}`);
      }
      stepNumbers.add(step.stepNumber);
    }

    // Check for invalid dependencies
    for (const step of plan.steps) {
      if (step.dependencies) {
        for (const dep of step.dependencies) {
          if (!stepNumbers.has(dep)) {
            issues.push(`Step ${step.stepNumber} references non-existent dependency: ${dep}`);
          }
          if (dep === step.stepNumber) {
            issues.push(`Step ${step.stepNumber} has self-dependency`);
          }
        }
      }
    }

    // Check for obviously missing actions
    for (const step of plan.steps) {
      if (!step.action || step.action.trim().length === 0) {
        issues.push(`Step ${step.stepNumber} has empty action`);
      }
    }

    return issues;
  }

  /**
   * Create failure report for pre-check issues
   */
  private createFailureReport(plan: ExecutionPlan, issues: string[]): VerificationReport {
    return {
      success: false,
      plan,
      verification: this.getEmptyVerification(plan),
      summary: `Pre-check failed with ${issues.length} issue(s): ${issues[0]}`,
      repairs: [],
      executionSafe: false,
      recommendations: issues.map(issue => `Fix: ${issue}`),
    };
  }

  /**
   * Generate repair suggestions for a failed plan
   */
  private generateRepairSuggestions(
    plan: ExecutionPlan,
    verification: TemporalVerificationResult
  ): RepairSuggestion[] {
    const suggestions: RepairSuggestion[] = [];

    // Suggest reordering for cycles
    for (const cycle of verification.cycles) {
      suggestions.push({
        type: 'reorder',
        description: `Break circular dependency: ${cycle.description}`,
        affectedSteps: cycle.affectedSteps,
        suggestedAction: `Review dependencies for steps ${cycle.affectedSteps.join(', ')} and remove or modify one to break the cycle`,
        estimatedImpact: 'high',
      });
    }

    // Suggest adding dependencies for invariant violations
    for (const violation of verification.violatedInvariants) {
      const inv = violation.invariant;
      
      suggestions.push({
        type: 'modify_dependency',
        description: `Enforce ${inv.name}: ${inv.violationMessage}`,
        affectedSteps: violation.counterExample.affectedSteps,
        suggestedAction: `Add explicit dependency from ${inv.beforeStepPattern} to ${inv.afterStepPattern}`,
        estimatedImpact: inv.severity === 'critical' ? 'high' : 'medium',
      });
    }

    // Suggest removing unreachable steps
    for (const unreachable of verification.unreachableSteps) {
      suggestions.push({
        type: 'remove_step',
        description: `Remove unreachable step: ${unreachable.description}`,
        affectedSteps: unreachable.affectedSteps,
        suggestedAction: `Step ${unreachable.affectedSteps[0]} cannot be reached from plan entry. Review or remove it.`,
        estimatedImpact: 'medium',
      });
    }

    return suggestions;
  }

  /**
   * Generate actionable recommendations based on verification results
   */
  private generateRecommendations(
    verification: TemporalVerificationResult,
    repairs: RepairSuggestion[]
  ): string[] {
    const recommendations: string[] = [];

    if (verification.cycles.length > 0) {
      recommendations.push(
        `⚠️ Circular dependencies detected (${verification.cycles.length}). Plan cannot be executed in any order. Apply repair suggestions.`
      );
    }

    if (verification.unreachableSteps.length > 0) {
      recommendations.push(
        `⚠️ ${verification.unreachableSteps.length} step(s) are unreachable from plan entry. These will never execute.`
      );
    }

    const critical = verification.violatedInvariants.filter(v => v.invariant.severity === 'critical');
    if (critical.length > 0) {
      recommendations.push(
        `🔴 ${critical.length} critical safety invariant(s) violated. Plan must be repaired before execution.`
      );
      
      for (const violation of critical) {
        recommendations.push(
          `   - ${violation.invariant.name}: ${violation.invariant.violationMessage}`
        );
      }
    }

    const warnings = verification.violatedInvariants.filter(v => v.invariant.severity === 'warning');
    if (warnings.length > 0) {
      recommendations.push(
        `⚠️ ${warnings.length} warning(s): ${warnings.map(w => w.invariant.name).join(', ')}`
      );
    }

    if (repairs.length > 0) {
      recommendations.push(
        `\n💡 Suggested repairs:\n${repairs.map((r, i) => `  ${i + 1}. ${r.suggestedAction}`).join('\n')}`
      );
    }

    if (verification.valid) {
      recommendations.push(
        `✅ Plan passes all temporal safety checks and is ready for execution.`
      );
    }

    return recommendations;
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(verification: TemporalVerificationResult, safe: boolean): string {
    const parts: string[] = [];

    parts.push(
      safe
        ? `✅ Plan is temporally safe`
        : `❌ Plan has temporal safety issues`
    );

    parts.push(
      `(${verification.diagnostics.totalSteps} steps, ` +
      `${verification.diagnostics.dependenciesCount} dependencies)`
    );

    if (verification.cycles.length > 0) {
      parts.push(`; ${verification.cycles.length} cycle(s) detected`);
    }

    if (verification.unreachableSteps.length > 0) {
      parts.push(`; ${verification.unreachableSteps.length} unreachable step(s)`);
    }

    if (verification.violatedInvariants.length > 0) {
      const critical = verification.violatedInvariants.filter(v => v.invariant.severity === 'critical').length;
      parts.push(`; ${critical} critical + ${verification.violatedInvariants.length - critical} warning invariant violation(s)`);
    }

    return parts.join('');
  }

  /**
   * Empty verification for error cases
   */
  private getEmptyVerification(plan: ExecutionPlan): TemporalVerificationResult {
    return {
      valid: false,
      plan,
      stepStates: new Map(),
      invariantsChecked: [],
      violatedInvariants: [],
      cycles: [],
      unreachableSteps: [],
      diagnostics: {
        totalSteps: plan.steps.length,
        dependenciesCount: 0,
        criticalViolations: 0,
        warnings: 0,
        estimatedExecutionTime: 0,
      },
    };
  }

  /**
   * Clear verification cache
   */
  clearCache(): void {
    this.verificationCache.clear();
  }

  /**
   * Format verification report for logging
   */
  static formatReport(report: VerificationReport): string {
    const lines: string[] = [];
    lines.push(report.summary);
    lines.push('');
    lines.push(...report.recommendations);
    
    if (report.repairs.length > 0) {
      lines.push('');
      lines.push('Suggested Repairs:');
      for (const repair of report.repairs) {
        lines.push(`  - ${repair.description}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get default engine instance
   */
  static create(config?: Partial<VerificationConfig>): TemporalSafetyEngine {
    return new TemporalSafetyEngine(config);
  }
}

export { TemporalSafetyEngine };
