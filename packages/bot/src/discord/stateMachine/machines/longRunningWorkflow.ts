/**
 * Long-Running Workflow State Machine
 * Typed state machine for Discord long-running workflows with checkpoints and persistence
 */

import {
  State,
  StateMachine,
  StateType,
  StateContext,
  StateHandlerResult,
  DiscordResponse,
  StateMachineError,
  StateMachineErrorCode,
} from '../core.js';

/**
 * Long-running workflow state
 */
export interface LongRunningWorkflowState extends State {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly steps: string[];
  readonly currentStepIndex: number;
  readonly stepResults: Record<string, unknown>;
  readonly progress: number;
  readonly estimatedCompletion?: number;
  readonly checkpoints: Record<string, unknown>;
  readonly resumeData?: unknown;
  readonly cancellationRequested?: boolean;
  readonly pauseRequested?: boolean;
}

/**
 * Long-running workflow output
 */
export interface LongRunningWorkflowOutput {
  readonly success: boolean;
  readonly workflowId: string;
  readonly results: Record<string, unknown>;
  readonly message?: string;
  readonly cancelled?: boolean;
  readonly paused?: boolean;
}

/**
 * Create a long-running workflow state machine
 */
export function createLongRunningWorkflowMachine(
  workflowType: string,
  steps: string[]
): StateMachine<LongRunningWorkflowState, unknown, LongRunningWorkflowOutput> {
  return {
    id: `long-running:${workflowType}`,
    name: `${workflowType} Long-Running Workflow`,
    initialState: 'initial',
    states: {
      initial: {
        id: 'initial',
        name: 'Initial',
        type: StateType.INITIAL,
        handler: async (state, input, context) => {
          const workflowId = generateWorkflowId(workflowType, context.userId);

          return {
            nextState: 'initializing',
            state: {
              workflowId,
              workflowType,
              steps,
              currentStepIndex: 0,
              stepResults: {},
              progress: 0,
              checkpoints: {},
            },
          };
        },
        transitions: [
          {
            from: 'initial',
            to: 'initializing',
          },
        ],
      },
      initializing: {
        id: 'initializing',
        name: 'Initializing',
        type: StateType.PROCESSING,
        handler: async (state, input, context) => {
          // Check if workflow can be resumed
          const resumeData = await loadResumeData(state.workflowId, context);

          if (resumeData) {
            return {
              nextState: 'resuming',
              state: {
                resumeData,
              },
            };
          }

          return {
            nextState: 'running',
          };
        },
        transitions: [
          {
            from: 'initializing',
            to: 'running',
            condition: (state) => !state.resumeData,
          },
          {
            from: 'initializing',
            to: 'resuming',
            condition: (state) => !!state.resumeData,
          },
        ],
      },
      resuming: {
        id: 'resuming',
        name: 'Resuming',
        type: StateType.PROCESSING,
        handler: async (state, input, context) => {
          // Restore state from resume data
          const restoredState = restoreState(state.resumeData);

          const response: DiscordResponse = {
            type: 'reply',
            content: `🔄 Resuming workflow "${state.workflowType}" from step ${(restoredState.currentStepIndex ?? 0) + 1}/${state.steps.length}`,
            components: [
              [
                {
                  type: 'button',
                  custom_id: 'pause_workflow',
                  label: 'Pause',
                  style: 2,
                },
                {
                  type: 'button',
                  custom_id: 'cancel_workflow',
                  label: 'Cancel',
                  style: 4,
                },
              ],
            ],
          };

          return {
            nextState: 'running',
            state: restoredState,
            response,
          };
        },
        transitions: [
          {
            from: 'resuming',
            to: 'running',
          },
        ],
      },
      running: {
        id: 'running',
        name: 'Running',
        type: StateType.PROCESSING,
        timeout: 300000, // 5 minute timeout per step
        handler: async (state, input, context) => {
          // Check for cancellation
          if (state.cancellationRequested) {
            return {
              nextState: 'cancelling',
            };
          }

          // Check for pause
          if (state.pauseRequested) {
            return {
              nextState: 'pausing',
            };
          }

          // Execute current step
          const currentStep = state.steps[state.currentStepIndex];
          const result = await executeWorkflowStep(currentStep, state, context);

          // Store result
          const newStepResults = {
            ...state.stepResults,
            [currentStep]: result,
          };

          // Create checkpoint
          const checkpoint = await createCheckpoint(state, newStepResults);

          // Calculate progress
          const progress = ((state.currentStepIndex + 1) / state.steps.length) * 100;

          // Check if workflow is complete
          if (state.currentStepIndex >= state.steps.length - 1) {
            return {
              nextState: 'completing',
              state: {
                stepResults: newStepResults,
                progress: 100,
                checkpoints: {
                  ...state.checkpoints,
                  [currentStep]: checkpoint,
                },
              },
            };
          }

          // Move to next step
          return {
            nextState: 'running',
            state: {
              currentStepIndex: state.currentStepIndex + 1,
              stepResults: newStepResults,
              progress,
              checkpoints: {
                ...state.checkpoints,
                [currentStep]: checkpoint,
              },
            },
            response: createProgressResponse(state, progress, currentStep),
          };
        },
        transitions: [
          {
            from: 'running',
            to: 'running',
            condition: (state) =>
              state.currentStepIndex < state.steps.length - 1 &&
              !state.cancellationRequested &&
              !state.pauseRequested,
          },
          {
            from: 'running',
            to: 'completing',
            condition: (state) => state.currentStepIndex >= state.steps.length - 1,
          },
          {
            from: 'running',
            to: 'cancelling',
            condition: (state) => state.cancellationRequested === true,
          },
          {
            from: 'running',
            to: 'pausing',
            condition: (state) => state.pauseRequested === true,
          },
          {
            from: 'running',
            to: 'error',
          },
        ],
      },
      completing: {
        id: 'completing',
        name: 'Completing',
        type: StateType.PROCESSING,
        handler: async (state, input, context) => {
          // Finalize workflow
          await finalizeWorkflow(state, context);

          const response: DiscordResponse = {
            type: 'edit',
            content: `✅ Workflow "${state.workflowType}" completed successfully!`,
            embeds: [
              {
                title: 'Workflow Results',
                fields: Object.entries(state.stepResults).map(([step, result]) => ({
                  name: step,
                  value: JSON.stringify(result),
                  inline: false,
                })),
              },
            ],
          };

          return {
            nextState: 'completed',
            response,
            output: {
              success: true,
              workflowId: state.workflowId,
              results: state.stepResults,
            },
          };
        },
        transitions: [
          {
            from: 'completing',
            to: 'completed',
          },
          {
            from: 'completing',
            to: 'error',
          },
        ],
      },
      completed: {
        id: 'completed',
        name: 'Completed',
        type: StateType.COMPLETED,
        handler: async (state, input, context) => {
          // Clean up resume data
          await cleanupResumeData(state.workflowId, context);

          return {
            nextState: null,
            output: {
              success: true,
              workflowId: state.workflowId,
              results: state.stepResults,
            },
          };
        },
        transitions: [],
      },
      pausing: {
        id: 'pausing',
        name: 'Pausing',
        type: StateType.PROCESSING,
        handler: async (state, input, context) => {
          // Save checkpoint for resume
          await saveResumeData(state, context);

          const response: DiscordResponse = {
            type: 'edit',
            content: `⏸️ Workflow "${state.workflowType}" paused at step ${state.currentStepIndex + 1}/${state.steps.length}`,
            components: [
              [
                {
                  type: 'button',
                  custom_id: 'resume_workflow',
                  label: 'Resume',
                  style: 1,
                },
              ],
            ],
          };

          return {
            nextState: 'paused',
            response,
            output: {
              success: false,
              workflowId: state.workflowId,
              results: state.stepResults,
              paused: true,
              message: 'Workflow paused',
            },
          };
        },
        transitions: [
          {
            from: 'pausing',
            to: 'paused',
          },
        ],
      },
      paused: {
        id: 'paused',
        name: 'Paused',
        type: StateType.AWAITING_INPUT,
        timeout: 86400000, // 24 hour timeout
        handler: async (state, input, context) => {
          // Wait for resume input
          return {
            // Stay in paused state
          };
        },
        transitions: [
          {
            from: 'paused',
            to: 'running',
            guard: (state) => state.pauseRequested === false,
          },
          {
            from: 'paused',
            to: 'timeout',
          },
        ],
      },
      cancelling: {
        id: 'cancelling',
        name: 'Cancelling',
        type: StateType.PROCESSING,
        handler: async (state, input, context) => {
          // Cleanup resources
          await cleanupWorkflow(state, context);

          const response: DiscordResponse = {
            type: 'edit',
            content: `🚫 Workflow "${state.workflowType}" cancelled at step ${state.currentStepIndex + 1}/${state.steps.length}`,
          };

          return {
            nextState: 'cancelled',
            response,
            output: {
              success: false,
              workflowId: state.workflowId,
              results: state.stepResults,
              cancelled: true,
              message: 'Workflow cancelled',
            },
          };
        },
        transitions: [
          {
            from: 'cancelling',
            to: 'cancelled',
          },
        ],
      },
      cancelled: {
        id: 'cancelled',
        name: 'Cancelled',
        type: StateType.CANCELLED,
        handler: async (state, input, context) => {
          // Clean up resume data
          await cleanupResumeData(state.workflowId, context);

          return {
            nextState: null,
          };
        },
        transitions: [],
      },
      timeout: {
        id: 'timeout',
        name: 'Timeout',
        type: StateType.TIMEOUT,
        handler: async (state, input, context) => {
          const response: DiscordResponse = {
            type: 'edit',
            content: `⏱️ Workflow "${state.workflowType}" timed out. Progress saved - you can resume later.`,
          };

          return {
            nextState: null,
            response,
            output: {
              success: false,
              workflowId: state.workflowId,
              results: state.stepResults,
              message: 'Workflow timed out',
            },
          };
        },
        transitions: [],
      },
      error: {
        id: 'error',
        name: 'Error',
        type: StateType.ERROR,
        handler: async (state, input, context) => {
          const response: DiscordResponse = {
            type: 'edit',
            content: `❌ Workflow "${state.workflowType}" encountered an error. Progress saved - you can resume or cancel.`,
            components: [
              [
                {
                  type: 'button',
                  custom_id: 'retry_workflow',
                  label: 'Retry',
                  style: 1,
                },
                {
                  type: 'button',
                  custom_id: 'cancel_workflow',
                  label: 'Cancel',
                  style: 4,
                },
              ],
            ],
          };

          return {
            nextState: 'error_recovery',
            response,
          };
        },
        transitions: [
          {
            from: 'error',
            to: 'error_recovery',
          },
        ],
      },
      error_recovery: {
        id: 'error_recovery',
        name: 'Error Recovery',
        type: StateType.AWAITING_INPUT,
        timeout: 3600000, // 1 hour timeout
        handler: async (state, input, context) => {
          // Wait for user decision
          return {
            // Stay in error recovery state
          };
        },
        transitions: [
          {
            from: 'error_recovery',
            to: 'running',
            guard: (state) => state.cancellationRequested === false,
          },
          {
            from: 'error_recovery',
            to: 'cancelling',
            guard: (state) => state.cancellationRequested === true,
          },
          {
            from: 'error_recovery',
            to: 'timeout',
          },
        ],
      },
    },
    onTransition: async (from, to, state) => {
      logger.log(`[Long-Running Workflow] Transition: ${from} -> ${to}`);
      // Save checkpoint on every transition
      if (from !== 'initial') {
        await saveCheckpoint(state, state.stepResults);
      }
    },
    onError: async (error, state) => {
      logger.error(`[Long-Running Workflow] Error:`, error);
    },
    onCompletion: async (state, output) => {
      logger.log(`[Long-Running Workflow] Completed:`, output);
    },
    onCancellation: async (state) => {
      logger.log(`[Long-Running Workflow] Cancelled`);
    },
  };
}

// Simple logger
const logger = {
  log: (...args: unknown[]) => {
    // @ts-ignore - console should be available at runtime
    if (typeof console !== 'undefined') console.log(...args);
  },
  error: (...args: unknown[]) => {
    // @ts-ignore - console should be available at runtime
    if (typeof console !== 'undefined') console.error(...args);
  },
};

/**
 * Generate workflow ID
 */
function generateWorkflowId(workflowType: string, userId: string): string {
  return `${workflowType}:${userId}:${Date.now()}`;
}

/**
 * Load resume data (placeholder)
 */
async function loadResumeData(workflowId: string, context: StateContext): Promise<unknown | null> {
  // This would load from database or cache
  return null;
}

/**
 * Restore state from resume data
 */
function restoreState(resumeData: unknown): Partial<LongRunningWorkflowState> {
  // This would parse and restore state
  return resumeData as Partial<LongRunningWorkflowState>;
}

/**
 * Execute workflow step (placeholder)
 */
async function executeWorkflowStep(
  step: string,
  state: LongRunningWorkflowState,
  context: StateContext
): Promise<unknown> {
  // This would execute the actual step logic
  logger.log(`Executing step: ${step}`);
  await sleep(1000); // Simulate work
  return { step, completed: true, timestamp: Date.now() };
}

/**
 * Create checkpoint (placeholder)
 */
async function createCheckpoint(
  state: LongRunningWorkflowState,
  stepResults: Record<string, unknown>
): Promise<unknown> {
  // This would save checkpoint to database
  return { stepResults, timestamp: Date.now() };
}

/**
 * Save checkpoint (placeholder)
 */
async function saveCheckpoint(
  state: LongRunningWorkflowState,
  stepResults: Record<string, unknown>
): Promise<void> {
  // This would save to database
}

/**
 * Finalize workflow (placeholder)
 */
async function finalizeWorkflow(
  state: LongRunningWorkflowState,
  context: StateContext
): Promise<void> {
  // This would perform final cleanup and notifications
}

/**
 * Save resume data (placeholder)
 */
async function saveResumeData(
  state: LongRunningWorkflowState,
  context: StateContext
): Promise<void> {
  // This would save state for resume
}

/**
 * Cleanup resume data (placeholder)
 */
async function cleanupResumeData(workflowId: string, context: StateContext): Promise<void> {
  // This would clean up saved state
}

/**
 * Cleanup workflow (placeholder)
 */
async function cleanupWorkflow(
  state: LongRunningWorkflowState,
  context: StateContext
): Promise<void> {
  // This would cleanup resources
}

/**
 * Create progress response
 */
function createProgressResponse(
  state: LongRunningWorkflowState,
  progress: number,
  currentStep: string
): DiscordResponse {
  return {
    type: 'edit',
    content: `⏳ Workflow "${state.workflowType}" in progress... (${Math.round(progress)}%)`,
    embeds: [
      {
        title: 'Current Step',
        description: currentStep,
        fields: [
          {
            name: 'Progress',
            value: `${Math.round(progress)}%`,
            inline: true,
          },
          {
            name: 'Step',
            value: `${state.currentStepIndex + 1}/${state.steps.length}`,
            inline: true,
          },
        ],
      },
    ],
    components: [
      [
        {
          type: 'button',
          custom_id: 'pause_workflow',
          label: 'Pause',
          style: 2,
        },
        {
          type: 'button',
          custom_id: 'cancel_workflow',
          label: 'Cancel',
          style: 4,
        },
      ],
    ],
  };
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    // @ts-ignore - setTimeout should be available at runtime
    setTimeout(resolve, ms);
  });
}
