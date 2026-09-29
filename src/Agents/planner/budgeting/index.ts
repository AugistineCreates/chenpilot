/**
 * Budget System - Index
 */

export {
  BudgetTracker,
  Budget,
  BudgetAllocation,
  CostMetrics,
  BudgetExhaustion,
} from './BudgetTracker';

// Create default instance
import { BudgetTracker } from './BudgetTracker';

export const defaultBudgetTracker = BudgetTracker.create();
