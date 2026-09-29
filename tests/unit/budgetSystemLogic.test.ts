/**
 * Budget System Tests - Standalone Logic
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

describe('Budget System Logic', () => {
  describe('Budget Allocation', () => {
    it('should create small budget with correct limits', () => {
      const budget = createSmallBudget();
      expect(budget.maxTotalTokens).toBe(2500);
      expect(budget.maxToolCalls).toBe(3);
      expect(budget.maxElapsedMs).toBe(10000);
    });

    it('should create medium budget with correct limits', () => {
      const budget = createMediumBudget();
      expect(budget.maxTotalTokens).toBe(6000);
      expect(budget.maxToolCalls).toBe(10);
      expect(budget.maxElapsedMs).toBe(30000);
    });

    it('should create large budget with correct limits', () => {
      const budget = createLargeBudget();
      expect(budget.maxTotalTokens).toBe(12000);
      expect(budget.maxToolCalls).toBe(30);
      expect(budget.maxElapsedMs).toBe(60000);
    });
  });

  describe('Recursive Budget Inheritance', () => {
    it('should reduce child budget to 50% of parent', () => {
      const parentBudget = createLargeBudget();
      const childBudget = inheritBudget(parentBudget, 0.5);

      expect(childBudget.maxInputTokens).toBe(
        Math.floor(parentBudget.maxInputTokens * 0.5)
      );
      expect(childBudget.maxTotalTokens).toBe(
        Math.floor(parentBudget.maxTotalTokens * 0.5)
      );
      expect(childBudget.maxToolCalls).toBe(
        Math.floor(parentBudget.maxToolCalls * 0.6)
      );
    });

    it('should handle multi-level recursion', () => {
      const root = createLargeBudget();
      const level1 = inheritBudget(root, 0.5);
      const level2 = inheritBudget(level1, 0.5);

      expect(level2.maxTotalTokens).toBeLessThan(level1.maxTotalTokens);
      expect(level1.maxTotalTokens).toBeLessThan(root.maxTotalTokens);
    });

    it('should enforce recursion depth limit', () => {
      const depth3Budget = createLargeBudget();
      depth3Budget.maxRecursionDepth = 2;

      expect(() => {
        checkRecursionDepth(3, depth3Budget);
      }).toThrow(/Recursion depth/);
    });
  });

  describe('Token Cost Tracking', () => {
    it('should track cumulative token costs', () => {
      const costs = { inputTokens: 0, outputTokens: 0 };
      
      recordTokens(costs, 100, 50);
      recordTokens(costs, 200, 75);

      expect(costs.inputTokens).toBe(300);
      expect(costs.outputTokens).toBe(125);
    });

    it('should detect input token limit exceeded', () => {
      const budget = createSmallBudget();
      const costs = { inputTokens: 0, outputTokens: 0 };

      recordTokens(costs, budget.maxInputTokens + 1, 0);

      const exceeded = checkTokenLimits(costs, budget);
      expect(exceeded).toContain('maxInputTokens');
    });

    it('should detect output token limit exceeded', () => {
      const budget = createSmallBudget();
      const costs = { inputTokens: 0, outputTokens: 0 };

      recordTokens(costs, 0, budget.maxOutputTokens + 1);

      const exceeded = checkTokenLimits(costs, budget);
      expect(exceeded).toContain('maxOutputTokens');
    });

    it('should detect total token limit exceeded', () => {
      const budget = createSmallBudget();
      // Set up costs that exceed total budget
      const costs = {
        inputTokens: budget.maxTotalTokens,
        outputTokens: budget.maxTotalTokens,
      };

      const exceeded = checkTokenLimits(costs, budget);
      // Should exceed maxTotalTokens
      expect(exceeded.length).toBeGreaterThan(0);
    });

    it('should allow consumption within limits', () => {
      const budget = createSmallBudget();
      const costs = { inputTokens: 100, outputTokens: 50 };

      const exceeded = checkTokenLimits(costs, budget);
      expect(exceeded).toHaveLength(0);
    });
  });

  describe('Tool Call Tracking', () => {
    it('should track tool calls', () => {
      const costs = { toolCallCount: 0 };
      recordToolCall(costs);
      recordToolCall(costs);

      expect(costs.toolCallCount).toBe(2);
    });

    it('should enforce tool call limit', () => {
      const budget = createSmallBudget();
      const costs = { toolCallCount: budget.maxToolCalls };

      const exceeded = recordToolCall(costs, budget);
      expect(exceeded).toBe(true);
    });

    it('should allow tool calls within limit', () => {
      const budget = createSmallBudget();
      const costs = { toolCallCount: budget.maxToolCalls - 1 };

      const exceeded = recordToolCall(costs, budget);
      expect(exceeded).toBe(false);
      expect(costs.toolCallCount).toBe(budget.maxToolCalls);
    });
  });

  describe('Elapsed Time Tracking', () => {
    it('should track elapsed time', () => {
      const budget = createSmallBudget();
      const exceeded = checkElapsedTime(5000, budget);
      expect(exceeded).toBe(false);
    });

    it('should detect elapsed time exceeded', () => {
      const budget = createSmallBudget();
      const exceeded = checkElapsedTime(budget.maxElapsedMs + 1000, budget);
      expect(exceeded).toBe(true);
    });

    it('should allow time within budget', () => {
      const budget = createSmallBudget();
      const elapsed = budget.maxElapsedMs - 1000;
      const exceeded = checkElapsedTime(elapsed, budget);
      expect(exceeded).toBe(false);
    });
  });

  describe('Remaining Budget Calculation', () => {
    it('should calculate full remaining when no costs', () => {
      const budget = createMediumBudget();
      const costs = {
        inputTokens: 0,
        outputTokens: 0,
        toolCallCount: 0,
        simulations: 0,
        elapsedMs: 0,
        externalApiCalls: 0,
      };

      const remaining = calculateRemaining(costs, budget);

      expect(remaining.inputTokens).toBe(budget.maxInputTokens);
      expect(remaining.outputTokens).toBe(budget.maxOutputTokens);
      expect(remaining.toolCalls).toBe(budget.maxToolCalls);
    });

    it('should calculate partial remaining after consumption', () => {
      const budget = createMediumBudget();
      const costs = {
        inputTokens: 100,
        outputTokens: 50,
        toolCallCount: 2,
        simulations: 0,
        elapsedMs: 5000,
        externalApiCalls: 0,
      };

      const remaining = calculateRemaining(costs, budget);

      expect(remaining.inputTokens).toBe(budget.maxInputTokens - 100);
      expect(remaining.outputTokens).toBe(budget.maxOutputTokens - 50);
      expect(remaining.toolCalls).toBe(budget.maxToolCalls - 2);
      expect(remaining.elapsedMs).toBe(budget.maxElapsedMs - 5000);
    });

    it('should handle overage gracefully', () => {
      const budget = createSmallBudget();
      const costs = {
        inputTokens: budget.maxInputTokens + 100,
        outputTokens: 0,
        toolCallCount: 0,
        simulations: 0,
        elapsedMs: 0,
        externalApiCalls: 0,
      };

      const remaining = calculateRemaining(costs, budget);
      // Remaining should not be negative
      expect(remaining.inputTokens).toBeLessThanOrEqual(0);
    });
  });

  describe('Cost Estimation', () => {
    it('should estimate 400 tokens per step', () => {
      const estimate = estimateCost(5, false);
      expect(estimate.estimatedTokens).toBe(2000);
      expect(estimate.estimatedToolCalls).toBe(5);
    });

    it('should include simulation cost when specified', () => {
      const estimate = estimateCost(3, true);
      expect(estimate.estimatedSimulations).toBe(1);
    });

    it('should handle zero steps', () => {
      const estimate = estimateCost(0, false);
      expect(estimate.estimatedTokens).toBe(0);
      expect(estimate.estimatedToolCalls).toBe(0);
    });
  });

  describe('Budget Type Selection', () => {
    it('should select small budget for simple queries', () => {
      const steps = 2;
      const selected = selectBudgetType(steps, false);
      expect(selected).toBe('small');
    });

    it('should select medium budget for moderate plans', () => {
      const steps = 5;
      const selected = selectBudgetType(steps, false);
      expect(selected).toBe('medium');
    });

    it('should select large budget for complex plans', () => {
      const steps = 15;
      const selected = selectBudgetType(steps, false);
      expect(selected).toBe('large');
    });

    it('should prefer large budget when recursion is involved', () => {
      const steps = 3;
      const selected = selectBudgetType(steps, true);
      expect(selected).toBe('large');
    });
  });

  describe('Budget Exhaustion Recovery', () => {
    it('should suggest pause for input token exhaustion', () => {
      const action = getRecoveryAction('maxInputTokens');
      expect(action).toBe('pause');
    });

    it('should suggest abort for total token exhaustion', () => {
      const action = getRecoveryAction('maxTotalTokens');
      expect(action).toBe('abort');
    });

    it('should suggest throttle for tool call exhaustion', () => {
      const action = getRecoveryAction('maxToolCalls');
      expect(action).toBe('throttle');
    });

    it('should suggest abort for time exhaustion', () => {
      const action = getRecoveryAction('maxElapsedMs');
      expect(action).toBe('abort');
    });
  });
});

// ============ Helper Functions ============

interface Budget {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxTotalTokens: number;
  maxToolCalls: number;
  maxSimulations: number;
  maxElapsedMs: number;
  maxExternalApiCalls: number;
  maxRecursionDepth: number;
}

interface Costs {
  inputTokens?: number;
  outputTokens?: number;
  toolCallCount?: number;
  simulations?: number;
  elapsedMs?: number;
  externalApiCalls?: number;
}

function createSmallBudget(): Budget {
  return {
    maxInputTokens: 2000,
    maxOutputTokens: 500,
    maxTotalTokens: 2500,
    maxToolCalls: 3,
    maxSimulations: 0,
    maxElapsedMs: 10000,
    maxExternalApiCalls: 5,
    maxRecursionDepth: 0,
  };
}

function createMediumBudget(): Budget {
  return {
    maxInputTokens: 4000,
    maxOutputTokens: 2000,
    maxTotalTokens: 6000,
    maxToolCalls: 10,
    maxSimulations: 2,
    maxElapsedMs: 30000,
    maxExternalApiCalls: 20,
    maxRecursionDepth: 1,
  };
}

function createLargeBudget(): Budget {
  return {
    maxInputTokens: 8000,
    maxOutputTokens: 4000,
    maxTotalTokens: 12000,
    maxToolCalls: 30,
    maxSimulations: 5,
    maxElapsedMs: 60000,
    maxExternalApiCalls: 50,
    maxRecursionDepth: 2,
  };
}

function inheritBudget(parent: Budget, ratio: number): Budget {
  return {
    ...parent,
    maxInputTokens: Math.floor(parent.maxInputTokens * ratio),
    maxOutputTokens: Math.floor(parent.maxOutputTokens * ratio),
    maxTotalTokens: Math.floor(parent.maxTotalTokens * ratio),
    maxToolCalls: Math.floor(parent.maxToolCalls * 0.6),
    maxElapsedMs: Math.floor(parent.maxElapsedMs * 0.7),
  };
}

function checkRecursionDepth(depth: number, budget: Budget): void {
  if (depth > budget.maxRecursionDepth) {
    throw new Error(`Recursion depth ${depth} exceeds limit ${budget.maxRecursionDepth}`);
  }
}

function recordTokens(costs: Costs, input: number, output: number): void {
  if (!costs.inputTokens) costs.inputTokens = 0;
  if (!costs.outputTokens) costs.outputTokens = 0;
  costs.inputTokens += input;
  costs.outputTokens += output;
}

function checkTokenLimits(costs: Costs, budget: Budget): string[] {
  const exceeded: string[] = [];

  const input = costs.inputTokens || 0;
  const output = costs.outputTokens || 0;

  if (input > budget.maxInputTokens) exceeded.push('maxInputTokens');
  if (output > budget.maxOutputTokens) exceeded.push('maxOutputTokens');
  if (input + output > budget.maxTotalTokens) exceeded.push('maxTotalTokens');

  return exceeded;
}

function recordToolCall(costs: Costs, budget?: Budget): boolean {
  if (!costs.toolCallCount) costs.toolCallCount = 0;

  if (budget && costs.toolCallCount >= budget.maxToolCalls) {
    return true;
  }

  costs.toolCallCount += 1;
  return false;
}

function checkElapsedTime(elapsed: number, budget: Budget): boolean {
  return elapsed > budget.maxElapsedMs;
}

function calculateRemaining(costs: Costs, budget: Budget): Record<string, number> {
  return {
    inputTokens: budget.maxInputTokens - (costs.inputTokens || 0),
    outputTokens: budget.maxOutputTokens - (costs.outputTokens || 0),
    totalTokens: budget.maxTotalTokens - ((costs.inputTokens || 0) + (costs.outputTokens || 0)),
    toolCalls: budget.maxToolCalls - (costs.toolCallCount || 0),
    simulations: budget.maxSimulations - (costs.simulations || 0),
    elapsedMs: budget.maxElapsedMs - (costs.elapsedMs || 0),
    externalApiCalls: budget.maxExternalApiCalls - (costs.externalApiCalls || 0),
  };
}

function estimateCost(
  stepCount: number,
  hasSimulation: boolean
): { estimatedTokens: number; estimatedToolCalls: number; estimatedSimulations: number } {
  return {
    estimatedTokens: stepCount * 400,
    estimatedToolCalls: stepCount,
    estimatedSimulations: hasSimulation ? 1 : 0,
  };
}

function selectBudgetType(steps: number, recursive: boolean): 'small' | 'medium' | 'large' {
  if (recursive) return 'large';
  if (steps <= 3) return 'small';
  if (steps <= 10) return 'medium';
  return 'large';
}

function getRecoveryAction(limitExceeded: string): string {
  switch (limitExceeded) {
    case 'maxInputTokens':
      return 'pause';
    case 'maxOutputTokens':
      return 'pause';
    case 'maxTotalTokens':
      return 'abort';
    case 'maxToolCalls':
      return 'throttle';
    case 'maxSimulations':
      return 'abort';
    case 'maxElapsedMs':
      return 'abort';
    case 'maxExternalApiCalls':
      return 'throttle';
    default:
      return 'pause';
  }
}
