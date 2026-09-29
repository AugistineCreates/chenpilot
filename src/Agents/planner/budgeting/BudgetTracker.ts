/**
 * Economic Budget System for Plans
 * 
 * Tracks and enforces budgets for:
 * - Token costs (LLM input/output tokens, provider calls)
 * - Tool execution costs
 * - Time limits
 * - Recursive plan depth constraints
 * 
 * Issue #666: Enforce economic budgets on model and tool execution
 */

import logger from '../../../config/logger';

/**
 * Cost metrics for different operations
 */
export interface CostMetrics {
  /**
   * LLM input tokens consumed
   */
  inputTokens: number;
  
  /**
   * LLM output tokens generated
   */
  outputTokens: number;
  
  /**
   * Number of tool calls made
   */
  toolCallCount: number;
  
  /**
   * Number of simulation runs (if applicable)
   */
  simulationCount: number;
  
  /**
   * Total elapsed time in milliseconds
   */
  elapsedMs: number;
  
  /**
   * External API calls (e.g., Horizon, RPC)
   */
  externalApiCalls: number;
}

/**
 * Budget definition with hard and soft limits
 */
export interface Budget {
  /**
   * Maximum LLM input tokens (hard limit)
   */
  maxInputTokens: number;
  
  /**
   * Maximum LLM output tokens (hard limit)
   */
  maxOutputTokens: number;
  
  /**
   * Maximum total token cost (input + output)
   */
  maxTotalTokens: number;
  
  /**
   * Maximum tool calls allowed
   */
  maxToolCalls: number;
  
  /**
   * Maximum simulation runs
   */
  maxSimulations: number;
  
  /**
   * Maximum elapsed time in milliseconds
   */
  maxElapsedMs: number;
  
  /**
   * Maximum external API calls
   */
  maxExternalApiCalls: number;
  
  /**
   * Maximum recursion depth for nested plans
   */
  maxRecursionDepth: number;
}

/**
 * Budget allocation for a specific execution context
 */
export interface BudgetAllocation {
  /**
   * Unique allocation ID
   */
  id: string;
  
  /**
   * Parent allocation ID (if part of recursive planning)
   */
  parentId?: string;
  
  /**
   * Associated plan ID
   */
  planId: string;
  
  /**
   * User ID
   */
  userId: string;
  
  /**
   * Budget constraints
   */
  budget: Budget;
  
  /**
   * Costs so far
   */
  costs: CostMetrics;
  
  /**
   * When allocation was created
   */
  createdAt: Date;
  
  /**
   * When allocation expires
   */
  expiresAt: Date;
  
  /**
   * Recursion depth (0 = root plan)
   */
  recursionDepth: number;
}

/**
 * Exhaustion details when budget is exceeded
 */
export interface BudgetExhaustion {
  /**
   * Which limit was exceeded
   */
  limitExceeded: keyof Budget;
  
  /**
   * Current value that exceeded the limit
   */
  currentValue: number;
  
  /**
   * The limit that was exceeded
   */
  limit: number;
  
  /**
   * How much over the limit
   */
  overage: number;
  
  /**
   * Recovery action taken
   */
  recoveryAction: 'pause' | 'abort' | 'throttle' | 'partial_result';
}

/**
 * Budget tracking and enforcement service
 */
export class BudgetTracker {
  /**
   * Active budget allocations
   */
  private allocations: Map<string, BudgetAllocation> = new Map();
  
  /**
   * Token pricing (configurable)
   */
  private tokenPricing = {
    inputTokensPerMill: 0.5,    // Cost per 1000 input tokens (in cents)
    outputTokensPerMill: 1.5,   // Cost per 1000 output tokens (in cents)
    toolCallBaseCost: 0.01,     // Cost per tool call (in dollars)
    simulationCost: 0.05,       // Cost per simulation (in dollars)
    externalApiCallCost: 0.001, // Cost per external API call (in dollars)
  };

  /**
   * Standard budgets for different use cases
   */
  private static readonly STANDARD_BUDGETS = {
    /**
     * Small query: simple price checks, status queries
     */
    SMALL: {
      maxInputTokens: 2000,
      maxOutputTokens: 500,
      maxTotalTokens: 2500,
      maxToolCalls: 3,
      maxSimulations: 0,
      maxElapsedMs: 10000,
      maxExternalApiCalls: 5,
      maxRecursionDepth: 0,
    } as Budget,

    /**
     * Medium operation: single swap or multi-step operation
     */
    MEDIUM: {
      maxInputTokens: 4000,
      maxOutputTokens: 2000,
      maxTotalTokens: 6000,
      maxToolCalls: 10,
      maxSimulations: 2,
      maxElapsedMs: 30000,
      maxExternalApiCalls: 20,
      maxRecursionDepth: 1,
    } as Budget,

    /**
     * Large operation: complex multi-hop swaps, recursive planning
     */
    LARGE: {
      maxInputTokens: 8000,
      maxOutputTokens: 4000,
      maxTotalTokens: 12000,
      maxToolCalls: 30,
      maxSimulations: 5,
      maxElapsedMs: 60000,
      maxExternalApiCalls: 50,
      maxRecursionDepth: 2,
    } as Budget,
  };

  /**
   * Create a new budget allocation for a plan execution
   */
  createAllocation(
    planId: string,
    userId: string,
    budgetType: 'small' | 'medium' | 'large' | 'custom',
    customBudget?: Partial<Budget>,
    parentId?: string
  ): BudgetAllocation {
    const baseBudget = BudgetTracker.STANDARD_BUDGETS[budgetType.toUpperCase() as keyof typeof BudgetTracker.STANDARD_BUDGETS];
    
    if (!baseBudget) {
      throw new Error(`Unknown budget type: ${budgetType}`);
    }

    const budget: Budget = customBudget
      ? { ...baseBudget, ...customBudget }
      : baseBudget;

    // Get recursion depth from parent if exists
    let recursionDepth = 0;
    if (parentId) {
      const parent = this.allocations.get(parentId);
      if (!parent) {
        throw new Error(`Parent allocation not found: ${parentId}`);
      }
      recursionDepth = parent.recursionDepth + 1;

      // Check recursion depth limit
      if (recursionDepth > budget.maxRecursionDepth) {
        throw new Error(
          `Recursion depth ${recursionDepth} exceeds limit ${budget.maxRecursionDepth}`
        );
      }

      // Child plans get strictly smaller budgets
      budget.maxInputTokens = Math.floor(parent.budget.maxInputTokens * 0.5);
      budget.maxOutputTokens = Math.floor(parent.budget.maxOutputTokens * 0.5);
      budget.maxTotalTokens = Math.floor(parent.budget.maxTotalTokens * 0.5);
      budget.maxToolCalls = Math.floor(parent.budget.maxToolCalls * 0.6);
      budget.maxElapsedMs = Math.floor(parent.budget.maxElapsedMs * 0.7);
    }

    const id = this.generateAllocationId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + budget.maxElapsedMs + 5000); // 5s buffer

    const allocation: BudgetAllocation = {
      id,
      planId,
      userId,
      budget,
      costs: {
        inputTokens: 0,
        outputTokens: 0,
        toolCallCount: 0,
        simulationCount: 0,
        elapsedMs: 0,
        externalApiCalls: 0,
      },
      createdAt: now,
      expiresAt,
      recursionDepth,
      parentId,
    };

    this.allocations.set(id, allocation);

    logger.info('Budget allocation created', {
      allocationId: id,
      planId,
      userId,
      budgetType,
      recursionDepth,
      limits: {
        maxTokens: budget.maxTotalTokens,
        maxToolCalls: budget.maxToolCalls,
        maxElapsedMs: budget.maxElapsedMs,
      },
    });

    return allocation;
  }

  /**
   * Record LLM token consumption
   */
  recordTokens(
    allocationId: string,
    inputTokens: number,
    outputTokens: number
  ): { exceeded: false } | { exceeded: true; exhaustion: BudgetExhaustion } {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`Allocation not found: ${allocationId}`);
    }

    const { budget, costs } = allocation;

    // Check input token limit
    if (costs.inputTokens + inputTokens > budget.maxInputTokens) {
      return {
        exceeded: true,
        exhaustion: {
          limitExceeded: 'maxInputTokens',
          currentValue: costs.inputTokens + inputTokens,
          limit: budget.maxInputTokens,
          overage: costs.inputTokens + inputTokens - budget.maxInputTokens,
          recoveryAction: 'pause',
        },
      };
    }

    // Check output token limit
    if (costs.outputTokens + outputTokens > budget.maxOutputTokens) {
      return {
        exceeded: true,
        exhaustion: {
          limitExceeded: 'maxOutputTokens',
          currentValue: costs.outputTokens + outputTokens,
          limit: budget.maxOutputTokens,
          overage: costs.outputTokens + outputTokens - budget.maxOutputTokens,
          recoveryAction: 'pause',
        },
      };
    }

    // Check total token limit
    const totalTokens = costs.inputTokens + costs.outputTokens + inputTokens + outputTokens;
    if (totalTokens > budget.maxTotalTokens) {
      return {
        exceeded: true,
        exhaustion: {
          limitExceeded: 'maxTotalTokens',
          currentValue: totalTokens,
          limit: budget.maxTotalTokens,
          overage: totalTokens - budget.maxTotalTokens,
          recoveryAction: 'abort',
        },
      };
    }

    costs.inputTokens += inputTokens;
    costs.outputTokens += outputTokens;

    return { exceeded: false };
  }

  /**
   * Record tool execution cost
   */
  recordToolCall(allocationId: string): { exceeded: false } | { exceeded: true; exhaustion: BudgetExhaustion } {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`Allocation not found: ${allocationId}`);
    }

    const { budget, costs } = allocation;

    if (costs.toolCallCount + 1 > budget.maxToolCalls) {
      return {
        exceeded: true,
        exhaustion: {
          limitExceeded: 'maxToolCalls',
          currentValue: costs.toolCallCount + 1,
          limit: budget.maxToolCalls,
          overage: 1,
          recoveryAction: 'throttle',
        },
      };
    }

    costs.toolCallCount += 1;
    return { exceeded: false };
  }

  /**
   * Record simulation execution
   */
  recordSimulation(allocationId: string): { exceeded: false } | { exceeded: true; exhaustion: BudgetExhaustion } {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`Allocation not found: ${allocationId}`);
    }

    const { budget, costs } = allocation;

    if (costs.simulationCount + 1 > budget.maxSimulations) {
      return {
        exceeded: true,
        exhaustion: {
          limitExceeded: 'maxSimulations',
          currentValue: costs.simulationCount + 1,
          limit: budget.maxSimulations,
          overage: 1,
          recoveryAction: 'abort',
        },
      };
    }

    costs.simulationCount += 1;
    return { exceeded: false };
  }

  /**
   * Record external API call
   */
  recordExternalApiCall(allocationId: string): { exceeded: false } | { exceeded: true; exhaustion: BudgetExhaustion } {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`Allocation not found: ${allocationId}`);
    }

    const { budget, costs } = allocation;

    if (costs.externalApiCalls + 1 > budget.maxExternalApiCalls) {
      return {
        exceeded: true,
        exhaustion: {
          limitExceeded: 'maxExternalApiCalls',
          currentValue: costs.externalApiCalls + 1,
          limit: budget.maxExternalApiCalls,
          overage: 1,
          recoveryAction: 'throttle',
        },
      };
    }

    costs.externalApiCalls += 1;
    return { exceeded: false };
  }

  /**
   * Update elapsed time
   */
  updateElapsedTime(allocationId: string, elapsedMs: number): { exceeded: false } | { exceeded: true; exhaustion: BudgetExhaustion } {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`Allocation not found: ${allocationId}`);
    }

    const { budget, costs } = allocation;

    if (elapsedMs > budget.maxElapsedMs) {
      return {
        exceeded: true,
        exhaustion: {
          limitExceeded: 'maxElapsedMs',
          currentValue: elapsedMs,
          limit: budget.maxElapsedMs,
          overage: elapsedMs - budget.maxElapsedMs,
          recoveryAction: 'abort',
        },
      };
    }

    costs.elapsedMs = elapsedMs;
    return { exceeded: false };
  }

  /**
   * Get remaining budget for an allocation
   */
  getRemaining(allocationId: string): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    toolCalls: number;
    simulations: number;
    elapsedMs: number;
    externalApiCalls: number;
  } {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`Allocation not found: ${allocationId}`);
    }

    const { budget, costs } = allocation;

    return {
      inputTokens: budget.maxInputTokens - costs.inputTokens,
      outputTokens: budget.maxOutputTokens - costs.outputTokens,
      totalTokens: budget.maxTotalTokens - (costs.inputTokens + costs.outputTokens),
      toolCalls: budget.maxToolCalls - costs.toolCallCount,
      simulations: budget.maxSimulations - costs.simulationCount,
      elapsedMs: budget.maxElapsedMs - costs.elapsedMs,
      externalApiCalls: budget.maxExternalApiCalls - costs.externalApiCalls,
    };
  }

  /**
   * Get allocation details
   */
  getAllocation(allocationId: string): BudgetAllocation | undefined {
    return this.allocations.get(allocationId);
  }

  /**
   * Finalize allocation and clean up
   */
  finalizeAllocation(allocationId: string): void {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) {
      throw new Error(`Allocation not found: ${allocationId}`);
    }

    logger.info('Budget allocation finalized', {
      allocationId,
      planId: allocation.planId,
      costs: allocation.costs,
      utilization: {
        tokens: `${Math.round((allocation.costs.inputTokens + allocation.costs.outputTokens) / allocation.budget.maxTotalTokens * 100)}%`,
        toolCalls: `${Math.round(allocation.costs.toolCallCount / allocation.budget.maxToolCalls * 100)}%`,
        time: `${Math.round(allocation.costs.elapsedMs / allocation.budget.maxElapsedMs * 100)}%`,
      },
    });

    // Allocations expire naturally, but can be removed early if needed
    // this.allocations.delete(allocationId);
  }

  /**
   * Estimate cost before execution (for planning)
   */
  estimateCost(planSteps: number, hasSimulation: boolean = false): {
    estimatedTokens: number;
    estimatedToolCalls: number;
    estimatedSimulations: number;
  } {
    return {
      estimatedTokens: Math.ceil(planSteps * 400), // ~400 tokens per step
      estimatedToolCalls: planSteps,
      estimatedSimulations: hasSimulation ? 1 : 0,
    };
  }

  /**
   * Generate allocation ID
   */
  private generateAllocationId(): string {
    return `budget_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get standard budget
   */
  static getStandardBudget(type: 'small' | 'medium' | 'large'): Budget {
    return BudgetTracker.STANDARD_BUDGETS[type.toUpperCase() as keyof typeof BudgetTracker.STANDARD_BUDGETS];
  }

  /**
   * Create tracker instance
   */
  static create(): BudgetTracker {
    return new BudgetTracker();
  }
}

export {
  BudgetTracker,
  Budget,
  BudgetAllocation,
  CostMetrics,
  BudgetExhaustion,
};
