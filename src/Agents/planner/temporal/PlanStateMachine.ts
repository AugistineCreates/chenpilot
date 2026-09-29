/**
 * Temporal Plan State Machine
 * 
 * Implements a deterministic state machine for validating temporal safety properties
 * of execution plans. Ensures:
 * - No cycles in dependencies
 * - Proper ordering of steps (approval before transfer, quote before execution)
 * - Reachability of all steps from plan entry
 * - Temporal invariants are satisfied
 * 
 * Issue #632: Verify generated plans against temporal safety properties before execution
 */

import { ExecutionPlan, PlanStep } from '../AgentPlanner';
import logger from '../../../config/logger';

/**
 * Represents the state of a single step in the plan
 */
export enum StepState {
  PENDING = 'pending',
  READY = 'ready',      // All dependencies satisfied
  ACTIVE = 'active',    // Currently executing
  COMPLETED = 'completed',
  FAILED = 'failed',
  BLOCKED = 'blocked',  // Cycle or unmet dependency
}

/**
 * Temporal invariant definition
 * Machine-readable safety properties that must be verified before execution
 */
export interface TemporalInvariant {
  id: string;
  name: string;
  description: string;
  
  /**
   * Source step that must complete before target
   * Can be action name (e.g., 'approve') or stepNumber
   */
  beforeStepPattern: string | number;
  
  /**
   * Target step that depends on source
   * Can be action name (e.g., 'transfer') or stepNumber
   */
  afterStepPattern: string | number;
  
  /**
   * Optional: allowable steps between before and after
   * If not specified, must be immediately sequential
   */
  allowIntermediateSteps?: boolean;
  
  /**
   * Critical invariants fail the plan; warnings allow continuation
   */
  severity: 'critical' | 'warning';
  
  /**
   * When violated, provides context for counterexample generation
   */
  violationMessage: string;
}

/**
 * Step state tracking during plan traversal
 */
interface StepStateInfo {
  stepNumber: number;
  action: string;
  state: StepState;
  dependenciesMet: boolean;
  incomingEdges: number[];
  outgoingEdges: number[];
  dependencies: number[];
  cycleDetected: boolean;
  reachable: boolean;
}

/**
 * Counterexample for a failed invariant or cycle
 */
export interface CounterExample {
  type: 'cycle' | 'unreachable' | 'invariant_violation' | 'deadlock';
  description: string;
  affectedSteps: number[];
  violatedInvariant?: TemporalInvariant;
  steps?: Array<{
    stepNumber: number;
    action: string;
    reason: string;
  }>;
}

/**
 * Verification result with detailed diagnostics
 */
export interface TemporalVerificationResult {
  valid: boolean;
  plan: ExecutionPlan;
  stepStates: Map<number, StepStateInfo>;
  invariantsChecked: TemporalInvariant[];
  violatedInvariants: Array<{
    invariant: TemporalInvariant;
    counterExample: CounterExample;
  }>;
  cycles: CounterExample[];
  unreachableSteps: CounterExample[];
  executionOrder?: number[];  // Valid topological order if valid
  diagnostics: {
    totalSteps: number;
    dependenciesCount: number;
    criticalViolations: number;
    warnings: number;
    estimatedExecutionTime: number;
  };
}

/**
 * Standard temporal invariants for DeFi operations
 */
const STANDARD_INVARIANTS: TemporalInvariant[] = [
  {
    id: 'approval-before-transfer',
    name: 'Approval Must Precede Transfer',
    description: 'Token approval must occur before any transfer or swap using that token',
    beforeStepPattern: 'approve',
    afterStepPattern: 'transfer',
    severity: 'critical',
    violationMessage: 'Transfer step found without preceding approval step',
  },
  {
    id: 'approval-before-swap',
    name: 'Approval Must Precede Swap',
    description: 'Token approval must occur before swap or trade operations',
    beforeStepPattern: 'approve',
    afterStepPattern: 'swap',
    severity: 'critical',
    violationMessage: 'Swap step found without preceding approval step',
  },
  {
    id: 'quote-validity',
    name: 'Quote Must Precede Execution',
    description: 'Price quote must be obtained and remain valid throughout execution',
    beforeStepPattern: 'getQuote',
    afterStepPattern: 'executeSwap',
    allowIntermediateSteps: false,
    severity: 'critical',
    violationMessage: 'Quote execution gap exceeds validity window',
  },
  {
    id: 'balance-check-before-transfer',
    name: 'Balance Check Before Transfer',
    description: 'Verify sufficient balance exists before attempting transfer',
    beforeStepPattern: 'checkBalance',
    afterStepPattern: 'transfer',
    severity: 'warning',
    violationMessage: 'Transfer executed without prior balance verification',
  },
];

export class PlanStateMachine {
  private plan: ExecutionPlan;
  private stepStates: Map<number, StepStateInfo>;
  private invariants: TemporalInvariant[];
  private visited: Set<number>;
  private recursionStack: Set<number>;

  constructor(
    plan: ExecutionPlan,
    customInvariants: TemporalInvariant[] = []
  ) {
    this.plan = plan;
    this.invariants = [...STANDARD_INVARIANTS, ...customInvariants];
    this.stepStates = new Map();
    this.visited = new Set();
    this.recursionStack = new Set();
    
    this.initializeStepStates();
  }

  /**
   * Initialize state tracking for all steps
   */
  private initializeStepStates(): void {
    for (const step of this.plan.steps) {
      const incomingEdges: number[] = [];
      const outgoingEdges: number[] = [];

      // Build dependency graph
      const dependencies = step.dependencies || [];
      for (const dep of dependencies) {
        if (dep !== step.stepNumber) {
          incomingEdges.push(dep);
        }
      }

      // Find steps that depend on this one
      for (const otherStep of this.plan.steps) {
        const otherDeps = otherStep.dependencies || [];
        if (otherDeps.includes(step.stepNumber)) {
          outgoingEdges.push(otherStep.stepNumber);
        }
      }

      this.stepStates.set(step.stepNumber, {
        stepNumber: step.stepNumber,
        action: step.action,
        state: StepState.PENDING,
        dependenciesMet: dependencies.length === 0,
        incomingEdges,
        outgoingEdges,
        dependencies,
        cycleDetected: false,
        reachable: false,
      });
    }
  }

  /**
   * Perform complete temporal verification of the plan
   */
  async verify(): Promise<TemporalVerificationResult> {
    const violations: Array<{ invariant: TemporalInvariant; counterExample: CounterExample }> = [];
    const cycles: CounterExample[] = [];
    const unreachableSteps: CounterExample[] = [];

    // 1. Check for cycles
    for (const step of this.plan.steps) {
      if (!this.detectCycles(step.stepNumber)) {
        const cycle = this.findCycleCounterExample(step.stepNumber);
        if (cycle) cycles.push(cycle);
      }
    }

    // 2. Check reachability
    this.markReachableSteps();
    for (const [stepNum, state] of this.stepStates) {
      if (!state.reachable && this.plan.steps[stepNum - 1]) {
        unreachableSteps.push({
          type: 'unreachable',
          description: `Step ${stepNum} (${state.action}) is unreachable from the plan entry`,
          affectedSteps: [stepNum],
          steps: [{
            stepNumber: stepNum,
            action: state.action,
            reason: 'No path from start to this step',
          }],
        });
      }
    }

    // 3. Check temporal invariants
    for (const invariant of this.invariants) {
      const violation = this.checkInvariant(invariant);
      if (violation) {
        violations.push({
          invariant,
          counterExample: violation,
        });
      }
    }

    // 4. Compute execution order if valid
    let executionOrder: number[] | undefined;
    const hasCriticalIssues = cycles.length > 0 ||
                              unreachableSteps.length > 0 ||
                              violations.some(v => v.invariant.severity === 'critical');

    if (!hasCriticalIssues) {
      executionOrder = this.computeTopologicalOrder();
    }

    const criticalViolations = violations.filter(v => v.invariant.severity === 'critical').length;
    const warnings = violations.filter(v => v.invariant.severity === 'warning').length;

    const result: TemporalVerificationResult = {
      valid: !hasCriticalIssues,
      plan: this.plan,
      stepStates: this.stepStates,
      invariantsChecked: this.invariants,
      violatedInvariants: violations,
      cycles,
      unreachableSteps,
      executionOrder,
      diagnostics: {
        totalSteps: this.plan.steps.length,
        dependenciesCount: Array.from(this.stepStates.values()).reduce(
          (sum, s) => sum + s.dependencies.length, 0
        ),
        criticalViolations,
        warnings,
        estimatedExecutionTime: this.plan.estimatedDuration,
      },
    };

    if (!result.valid) {
      logger.warn('Temporal verification failed for plan', {
        planId: this.plan.planId,
        cycles: cycles.length,
        unreachable: unreachableSteps.length,
        violations: violations.length,
        critical: criticalViolations,
      });
    }

    return result;
  }

  /**
   * Detect cycles using DFS
   */
  private detectCycles(stepNumber: number): boolean {
    const state = this.stepStates.get(stepNumber);
    if (!state) return true;

    // Already processed in this traversal
    if (this.visited.has(stepNumber)) {
      // If we're in recursion stack, we found a cycle
      if (this.recursionStack.has(stepNumber)) {
        state.cycleDetected = true;
        return false;
      }
      return true;
    }

    this.visited.add(stepNumber);
    this.recursionStack.add(stepNumber);

    // Check all outgoing edges (steps that depend on this one)
    for (const nextStep of state.outgoingEdges) {
      if (!this.detectCycles(nextStep)) {
        return false;
      }
    }

    this.recursionStack.delete(stepNumber);
    return true;
  }

  /**
   * Find a concrete example of a cycle for debugging
   */
  private findCycleCounterExample(stepNumber: number): CounterExample | null {
    const visited = new Set<number>();
    const path: number[] = [];
    
    const dfs = (current: number): boolean => {
      if (path.includes(current)) {
        // Found cycle
        const cycleStart = path.indexOf(current);
        const cycle = path.slice(cycleStart);
        cycle.push(current);
        return true;
      }

      if (visited.has(current)) return false;

      path.push(current);
      visited.add(current);

      const state = this.stepStates.get(current);
      if (state) {
        for (const next of state.outgoingEdges) {
          if (dfs(next)) {
            return true;
          }
        }
      }

      path.pop();
      return false;
    };

    if (dfs(stepNumber)) {
      const cycleSteps = path.map(num => {
        const state = this.stepStates.get(num)!;
        return {
          stepNumber: num,
          action: state.action,
          reason: 'Part of circular dependency chain',
        };
      });

      return {
        type: 'cycle',
        description: `Circular dependency detected: ${path.map(n => `Step${n}`).join(' -> ')} -> Step${path[0]}`,
        affectedSteps: path,
        steps: cycleSteps,
      };
    }

    return null;
  }

  /**
   * Mark steps reachable from the entry point
   */
  private markReachableSteps(): void {
    const visited = new Set<number>();
    const queue: number[] = [];

    // Start from steps with no dependencies
    for (const [num, state] of this.stepStates) {
      if (state.dependencies.length === 0) {
        queue.push(num);
        state.reachable = true;
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const state = this.stepStates.get(current)!;
      for (const next of state.outgoingEdges) {
        const nextState = this.stepStates.get(next)!;
        nextState.reachable = true;
        if (!visited.has(next)) {
          queue.push(next);
        }
      }
    }
  }

  /**
   * Check a temporal invariant against the plan
   */
  private checkInvariant(invariant: TemporalInvariant): CounterExample | null {
    const beforeSteps = this.findMatchingSteps(invariant.beforeStepPattern);
    const afterSteps = this.findMatchingSteps(invariant.afterStepPattern);

    // If no after steps exist, invariant is trivially satisfied
    if (afterSteps.length === 0) return null;

    // If no before steps exist but after steps do, invariant is violated
    if (beforeSteps.length === 0) {
      const affected = afterSteps.map(num => ({
        stepNumber: num,
        action: this.stepStates.get(num)!.action,
        reason: `${invariant.violationMessage}: required preceding step (${invariant.beforeStepPattern}) not found`,
      }));

      return {
        type: 'invariant_violation',
        description: invariant.violationMessage,
        affectedSteps: afterSteps,
        violatedInvariant: invariant,
        steps: affected,
      };
    }

    // Check ordering: all before steps should come before all after steps
    const maxBeforeStep = Math.max(...beforeSteps);
    const minAfterStep = Math.min(...afterSteps);

    // Check if before comes strictly before after
    for (const afterNum of afterSteps) {
      const canReachFromBefore = this.canReach(beforeSteps, afterNum);
      if (!canReachFromBefore) {
        const affected = afterSteps.filter(n => !this.canReach(beforeSteps, n));
        const details = affected.map(num => ({
          stepNumber: num,
          action: this.stepStates.get(num)!.action,
          reason: `Not reachable from ${invariant.beforeStepPattern} step`,
        }));

        return {
          type: 'invariant_violation',
          description: invariant.violationMessage,
          affectedSteps: affected,
          violatedInvariant: invariant,
          steps: details,
        };
      }
    }

    return null;
  }

  /**
   * Find all steps matching a pattern (either action name or step number)
   */
  private findMatchingSteps(pattern: string | number): number[] {
    const matches: number[] = [];

    if (typeof pattern === 'number') {
      if (this.stepStates.has(pattern)) {
        matches.push(pattern);
      }
    } else {
      // Pattern is action name
      for (const [num, state] of this.stepStates) {
        if (state.action.toLowerCase().includes(pattern.toLowerCase())) {
          matches.push(num);
        }
      }
    }

    return matches;
  }

  /**
   * Check if any step in sourceSteps can reach targetStep
   */
  private canReach(sourceSteps: number[], targetStep: number): boolean {
    const visited = new Set<number>();
    
    const dfs = (current: number): boolean => {
      if (current === targetStep) return true;
      if (visited.has(current)) return false;
      visited.add(current);

      const state = this.stepStates.get(current);
      if (!state) return false;

      for (const next of state.outgoingEdges) {
        if (dfs(next)) return true;
      }

      return false;
    };

    for (const source of sourceSteps) {
      visited.clear();
      if (dfs(source)) return true;
    }

    return false;
  }

  /**
   * Compute valid topological order for execution
   */
  private computeTopologicalOrder(): number[] {
    const order: number[] = [];
    const visited = new Set<number>();
    const visiting = new Set<number>();

    const visit = (stepNum: number): boolean => {
      if (visited.has(stepNum)) return true;
      if (visiting.has(stepNum)) return false; // Cycle detected

      visiting.add(stepNum);

      const state = this.stepStates.get(stepNum);
      if (!state) return false;

      // Visit dependencies first
      for (const dep of state.dependencies) {
        if (!visit(dep)) return false;
      }

      visiting.delete(stepNum);
      visited.add(stepNum);
      order.push(stepNum);
      return true;
    };

    for (const [stepNum] of this.stepStates) {
      if (!visited.has(stepNum)) {
        if (!visit(stepNum)) return []; // Cycle detected
      }
    }

    return order;
  }

  /**
   * Get summary of invariants for documentation
   */
  static getStandardInvariants(): TemporalInvariant[] {
    return STANDARD_INVARIANTS;
  }

  /**
   * Get default state machine instance
   */
  static create(plan: ExecutionPlan, customInvariants?: TemporalInvariant[]): PlanStateMachine {
    return new PlanStateMachine(plan, customInvariants);
  }
}

export { StepState, StepStateInfo, TemporalInvariant };
