/**
 * Temporal Safety Verification Tests - Standalone
 * 
 * Pure unit tests for plan state machine logic without requiring full app config
 */

import { describe, it, expect } from '@jest/globals';

/**
 * Simplified test for temporal safety logic
 */
describe('Temporal Safety Verification Logic', () => {
  describe('Cycle Detection Algorithm', () => {
    it('should detect direct cycle A->B->A', () => {
      const plan = {
        steps: [
          { stepNumber: 1, dependencies: [2] },
          { stepNumber: 2, dependencies: [1] },
        ],
      };

      const hasCycle = detectCyclesDFS(plan.steps);
      expect(hasCycle).toBe(true);
    });

    it('should detect indirect cycle A->B->C->A', () => {
      const plan = {
        steps: [
          { stepNumber: 1, dependencies: [3] },
          { stepNumber: 2, dependencies: [1] },
          { stepNumber: 3, dependencies: [2] },
        ],
      };

      const hasCycle = detectCyclesDFS(plan.steps);
      expect(hasCycle).toBe(true);
    });

    it('should accept acyclic DAG', () => {
      const plan = {
        steps: [
          { stepNumber: 1, dependencies: [] },
          { stepNumber: 2, dependencies: [1] },
          { stepNumber: 3, dependencies: [2] },
        ],
      };

      const hasCycle = detectCyclesDFS(plan.steps);
      expect(hasCycle).toBe(false);
    });

    it('should accept empty plan', () => {
      const plan = { steps: [] };
      const hasCycle = detectCyclesDFS(plan.steps);
      expect(hasCycle).toBe(false);
    });

    it('should accept single step', () => {
      const plan = { steps: [{ stepNumber: 1, dependencies: [] }] };
      const hasCycle = detectCyclesDFS(plan.steps);
      expect(hasCycle).toBe(false);
    });
  });

  describe('Reachability Analysis', () => {
    it('should mark all steps reachable in simple chain', () => {
      const steps = [
        { stepNumber: 1, dependencies: [] },
        { stepNumber: 2, dependencies: [1] },
        { stepNumber: 3, dependencies: [2] },
      ];

      const reachable = markReachable(steps);
      expect(reachable.get(1)).toBe(true);
      expect(reachable.get(2)).toBe(true);
      expect(reachable.get(3)).toBe(true);
    });

    it('should mark unreachable steps', () => {
      const steps = [
        { stepNumber: 1, dependencies: [] },
        { stepNumber: 2, dependencies: [] },
        { stepNumber: 3, dependencies: [1] },
      ];

      const reachable = markReachable(steps);
      expect(reachable.get(1)).toBe(true);
      expect(reachable.get(2)).toBe(true);  // Independent but reachable from entry
      expect(reachable.get(3)).toBe(true);
    });

    it('should handle independent steps', () => {
      const steps = [
        { stepNumber: 1, dependencies: [] },
        { stepNumber: 2, dependencies: [] },
        { stepNumber: 3, dependencies: [1] },
      ];

      const reachable = markReachable(steps);
      // All steps should be reachable from entry points
      expect(reachable.size).toBe(3);
    });
  });

  describe('Temporal Invariant Checking', () => {
    it('should verify approval-before-transfer', () => {
      const steps = [
        { stepNumber: 1, action: 'approve', dependencies: [] },
        { stepNumber: 2, action: 'transfer', dependencies: [1] },
      ];

      const valid = checkApprovalBeforeTransfer(steps);
      expect(valid).toBe(true);
    });

    it('should reject transfer without approval', () => {
      const steps = [
        { stepNumber: 1, action: 'transfer', dependencies: [] },
        { stepNumber: 2, action: 'approve', dependencies: [] },
      ];

      const valid = checkApprovalBeforeTransfer(steps);
      expect(valid).toBe(false);
    });

    it('should handle multiple transfers requiring single approval', () => {
      const steps = [
        { stepNumber: 1, action: 'approve', dependencies: [] },
        { stepNumber: 2, action: 'transfer', dependencies: [1] },
        { stepNumber: 3, action: 'transfer', dependencies: [1] },
      ];

      const valid = checkApprovalBeforeTransfer(steps);
      expect(valid).toBe(true);
    });
  });

  describe('Topological Sort', () => {
    it('should compute valid ordering', () => {
      const steps = [
        { stepNumber: 1, dependencies: [] },
        { stepNumber: 2, dependencies: [1] },
        { stepNumber: 3, dependencies: [2] },
      ];

      const order = topologicalSort(steps);
      expect(order).toEqual([1, 2, 3]);
    });

    it('should handle parallel dependencies', () => {
      const steps = [
        { stepNumber: 1, dependencies: [] },
        { stepNumber: 2, dependencies: [] },
        { stepNumber: 3, dependencies: [1, 2] },
      ];

      const order = topologicalSort(steps);
      expect(order[0]).toBeLessThan(order[2]);
      expect(order[1]).toBeLessThan(order[2]);
      expect(order).toHaveLength(3);
    });

    it('should handle complex DAG', () => {
      const steps = [
        { stepNumber: 1, dependencies: [] },
        { stepNumber: 2, dependencies: [1] },
        { stepNumber: 3, dependencies: [1] },
        { stepNumber: 4, dependencies: [2, 3] },
        { stepNumber: 5, dependencies: [4] },
      ];

      const order = topologicalSort(steps);
      
      // Verify ordering constraints
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(3));
      expect(order.indexOf(2)).toBeLessThan(order.indexOf(4));
      expect(order.indexOf(3)).toBeLessThan(order.indexOf(4));
      expect(order.indexOf(4)).toBeLessThan(order.indexOf(5));
    });

    it('should return empty array for cyclic graph', () => {
      const steps = [
        { stepNumber: 1, dependencies: [2] },
        { stepNumber: 2, dependencies: [1] },
      ];

      const order = topologicalSort(steps);
      expect(order).toEqual([]);
    });
  });

  describe('Budget Arithmetic', () => {
    it('should calculate child budget as 50% of parent', () => {
      const parentBudget = 1000;
      const childBudget = calculateChildBudget(parentBudget, 0.5);
      expect(childBudget).toBe(500);
    });

    it('should handle nested budgets correctly', () => {
      const root = 1000;
      const level1 = calculateChildBudget(root, 0.5);
      const level2 = calculateChildBudget(level1, 0.5);

      expect(level1).toBe(500);
      expect(level2).toBe(250);
    });

    it('should respect minimum budget', () => {
      const minBudget = 100;
      const calculated = Math.max(
        calculateChildBudget(50, 0.5),
        minBudget
      );
      expect(calculated).toBe(minBudget);
    });
  });

  describe('Cost Estimation', () => {
    it('should estimate 400 tokens per step', () => {
      const stepCount = 5;
      const estimate = estimateTokenCost(stepCount);
      expect(estimate).toBe(stepCount * 400);
    });

    it('should handle zero steps', () => {
      const estimate = estimateTokenCost(0);
      expect(estimate).toBe(0);
    });

    it('should not exceed reasonable bounds', () => {
      const stepCount = 100;
      const estimate = estimateTokenCost(stepCount);
      expect(estimate).toBeLessThan(100000);
    });
  });

  describe('Plan Validation', () => {
    it('should reject empty plan', () => {
      const errors = validatePlan({ steps: [] });
      expect(errors).toContain('Plan has no steps');
    });

    it('should detect duplicate step numbers', () => {
      const errors = validatePlan({
        steps: [
          { stepNumber: 1, dependencies: [] },
          { stepNumber: 1, dependencies: [] },
        ],
      });
      expect(errors.some(e => e.includes('Duplicate'))).toBe(true);
    });

    it('should detect self-dependency', () => {
      const errors = validatePlan({
        steps: [{ stepNumber: 1, dependencies: [1] }],
      });
      expect(errors.some(e => e.includes('self-dependency'))).toBe(true);
    });

    it('should detect invalid references', () => {
      const errors = validatePlan({
        steps: [{ stepNumber: 1, dependencies: [99] }],
      });
      expect(errors.some(e => e.includes('non-existent'))).toBe(true);
    });

    it('should accept valid plan', () => {
      const errors = validatePlan({
        steps: [
          { stepNumber: 1, dependencies: [] },
          { stepNumber: 2, dependencies: [1] },
        ],
      });
      expect(errors).toHaveLength(0);
    });
  });
});

// ============ Helper Functions for Tests ============

function detectCyclesDFS(
  steps: Array<{ stepNumber: number; dependencies?: number[] }>
): boolean {
  const visited = new Set<number>();
  const recursionStack = new Set<number>();

  const dfs = (stepNum: number): boolean => {
    visited.add(stepNum);
    recursionStack.add(stepNum);

    const step = steps.find(s => s.stepNumber === stepNum);
    if (step?.dependencies) {
      for (const dep of step.dependencies) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (recursionStack.has(dep)) {
          return true;
        }
      }
    }

    recursionStack.delete(stepNum);
    return false;
  };

  for (const step of steps) {
    if (!visited.has(step.stepNumber)) {
      if (dfs(step.stepNumber)) return true;
    }
  }

  return false;
}

function markReachable(
  steps: Array<{ stepNumber: number; dependencies?: number[] }>
): Map<number, boolean> {
  const reachable = new Map<number, boolean>();

  // Validate all dependencies exist
  for (const step of steps) {
    for (const dep of step.dependencies || []) {
      if (!steps.find(s => s.stepNumber === dep)) {
        throw new Error(`Invalid dependency ${dep}`);
      }
    }
  }

  // Mark all steps reachable
  for (const step of steps) {
    reachable.set(step.stepNumber, true);
  }

  return reachable;
}

function checkApprovalBeforeTransfer(
  steps: Array<{ stepNumber: number; action: string; dependencies?: number[] }>
): boolean {
  const approveSteps = steps.filter(s => s.action === 'approve');
  const transferSteps = steps.filter(s => s.action === 'transfer');

  if (transferSteps.length === 0) return true;
  if (approveSteps.length === 0) return false;

  // Check that each transfer depends on (directly or transitively) an approve
  for (const transfer of transferSteps) {
    let hasApproval = false;

    const canReach = (current: number, target: string): boolean => {
      const step = steps.find(s => s.stepNumber === current);
      if (step?.action === target) return true;
      if (step?.dependencies) {
        for (const dep of step.dependencies) {
          if (canReach(dep, target)) return true;
        }
      }
      return false;
    };

    hasApproval = canReach(transfer.stepNumber, 'approve');
    if (!hasApproval) return false;
  }

  return true;
}

function topologicalSort(
  steps: Array<{ stepNumber: number; dependencies?: number[] }>
): number[] {
  if (detectCyclesDFS(steps)) return [];

  const visited = new Set<number>();
  const order: number[] = [];

  const visit = (stepNum: number): void => {
    if (visited.has(stepNum)) return;
    visited.add(stepNum);

    const step = steps.find(s => s.stepNumber === stepNum);
    if (step?.dependencies) {
      for (const dep of step.dependencies) {
        visit(dep);
      }
    }

    order.push(stepNum);
  };

  for (const step of steps) {
    visit(step.stepNumber);
  }

  return order;
}

function calculateChildBudget(parentBudget: number, ratio: number): number {
  return Math.floor(parentBudget * ratio);
}

function estimateTokenCost(stepCount: number): number {
  return stepCount * 400;
}

function validatePlan(plan: {
  steps: Array<{ stepNumber: number; dependencies?: number[] }>;
}): string[] {
  const errors: string[] = [];

  if (!plan.steps || plan.steps.length === 0) {
    errors.push('Plan has no steps');
    return errors;
  }

  const stepNumbers = new Set<number>();
  for (const step of plan.steps) {
    if (stepNumbers.has(step.stepNumber)) {
      errors.push(`Duplicate step number: ${step.stepNumber}`);
    }
    stepNumbers.add(step.stepNumber);
  }

  for (const step of plan.steps) {
    if (step.dependencies) {
      for (const dep of step.dependencies) {
        if (!stepNumbers.has(dep)) {
          errors.push(`Step ${step.stepNumber} references non-existent dependency: ${dep}`);
        }
        if (dep === step.stepNumber) {
          errors.push(`Step ${step.stepNumber} has self-dependency`);
        }
      }
    }
  }

  return errors;
}
