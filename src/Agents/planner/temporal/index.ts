/**
 * Temporal Safety System - Index
 */

export {
  PlanStateMachine,
  StepState,
  TemporalInvariant,
  TemporalVerificationResult,
  CounterExample,
  StepStateInfo,
} from './PlanStateMachine';

export {
  TemporalSafetyEngine,
  VerificationConfig,
  VerificationReport,
  RepairSuggestion,
} from './TemporalSafetyEngine';

// Create default instances
import { TemporalSafetyEngine } from './TemporalSafetyEngine';

export const defaultTemporalEngine = TemporalSafetyEngine.create({
  failOnWarning: false,
  enableRepairSuggestions: true,
  customInvariants: [],
  maxAnalysisDepth: 100,
});
