/**
 * Thread Creation State Machine
 * Typed state machine for Discord thread creation workflows
 */

import {
  State,
  StateMachine,
  StateType,
  StateContext,
  StateHandlerResult,
  DiscordResponse,
  ThreadInput,
  StateMachineError,
  StateMachineErrorCode,
} from '../core.js';

/**
 * Thread creation state
 */
export interface ThreadCreationState extends State {
  readonly threadName: string;
  readonly autoArchiveDuration?: number;
  readonly reason?: string;
  readonly parentChannelId: string;
  readonly parentMessageId?: string;
  readonly threadId?: string;
  readonly inviteUsers?: string[];
  readonly initialMessage?: string;
  readonly validationErrors?: string[];
  readonly creationResult?: {
    threadId: string;
    success: boolean;
  };
}

/**
 * Thread creation output
 */
export interface ThreadCreationOutput {
  readonly success: boolean;
  readonly threadId?: string;
  readonly threadName: string;
  readonly message?: string;
}

/**
 * Create a thread creation state machine
 */
export function createThreadCreationMachine(): StateMachine<
  ThreadCreationState,
  ThreadInput,
  ThreadCreationOutput
> {
  return {
    id: 'thread-creation',
    name: 'Thread Creation Workflow',
    initialState: 'initial',
    states: {
      initial: {
        id: 'initial',
        name: 'Initial',
        type: StateType.INITIAL,
        handler: async (state, input, context) => {
          // Validate input
          if (!input.name || input.name.trim().length === 0) {
            return {
              error: {
                code: StateMachineErrorCode.VALIDATION_ERROR,
                message: 'Thread name is required',
                recoverable: false,
              },
            };
          }

          if (input.name.length > 100) {
            return {
              error: {
                code: StateMachineErrorCode.VALIDATION_ERROR,
                message: 'Thread name must be 100 characters or less',
                recoverable: false,
              },
            };
          }

          return {
            nextState: 'validating',
            state: {
              threadName: input.name,
              autoArchiveDuration: input.autoArchiveDuration || 1440, // Default 24 hours
              reason: input.reason,
              parentChannelId: context.channelId,
              parentMessageId: input.message?.id,
            },
          };
        },
        transitions: [
          {
            from: 'initial',
            to: 'validating',
          },
          {
            from: 'initial',
            to: 'error',
            condition: (state) => (state.validationErrors?.length ?? 0) > 0,
          },
        ],
      },
      validating: {
        id: 'validating',
        name: 'Validating',
        type: StateType.PROCESSING,
        handler: async (state, input, context) => {
          // Additional validation logic
          const errors: string[] = [];

          // Validate auto archive duration
          if (state.autoArchiveDuration && ![60, 1440, 4320, 10080].includes(state.autoArchiveDuration)) {
            errors.push('Auto archive duration must be 60, 1440, 4320, or 10080 minutes');
          }

          if (errors.length > 0) {
            return {
              nextState: 'error',
              state: { validationErrors: errors },
            };
          }

          return {
            nextState: 'awaiting_confirmation',
          };
        },
        transitions: [
          {
            from: 'validating',
            to: 'awaiting_confirmation',
          },
          {
            from: 'validating',
            to: 'error',
            condition: (state) => (state.validationErrors?.length ?? 0) > 0,
          },
        ],
      },
      awaiting_confirmation: {
        id: 'awaiting_confirmation',
        name: 'Awaiting Confirmation',
        type: StateType.AWAITING_CONFIRMATION,
        timeout: 300000, // 5 minute timeout
        handler: async (state, input, context) => {
          // Show confirmation UI
          const response: DiscordResponse = {
            type: 'reply',
            content: `Create thread "${state.threadName}"?`,
            components: [
              {
                type: 'action_row',
                components: [
                  {
                    type: 'button',
                    custom_id: 'confirm_thread',
                    label: 'Confirm',
                    style: 1, // Primary
                  },
                  {
                    type: 'button',
                    custom_id: 'cancel_thread',
                    label: 'Cancel',
                    style: 2, // Secondary
                  },
                ],
              },
            ],
            ephemeral: false,
          };

          return {
            response,
          };
        },
        transitions: [
          {
            from: 'awaiting_confirmation',
            to: 'creating',
            guard: (state) => {
              // This would check if user confirmed via button click
              // For now, we'll auto-confirm for demonstration
              return true;
            },
          },
          {
            from: 'awaiting_confirmation',
            to: 'cancelled',
            guard: (state) => {
              // This would check if user cancelled
              return false;
            },
          },
          {
            from: 'awaiting_confirmation',
            to: 'timeout',
          },
        ],
      },
      creating: {
        id: 'creating',
        name: 'Creating Thread',
        type: StateType.PROCESSING,
        timeout: 15000, // 15 second timeout
        handler: async (state, input, context) => {
          // Create the thread
          const result = await createThread(state, context);

          return {
            nextState: 'post_creation',
            state: {
              creationResult: result,
              threadId: result.threadId,
            },
            output: {
              success: result.success,
              threadId: result.threadId,
              threadName: state.threadName,
            },
          };
        },
        transitions: [
          {
            from: 'creating',
            to: 'post_creation',
          },
          {
            from: 'creating',
            to: 'error',
            condition: (state) => !state.creationResult?.success,
          },
        ],
      },
      post_creation: {
        id: 'post_creation',
        name: 'Post Creation',
        type: StateType.PROCESSING,
        handler: async (state, input, context) => {
          // Send initial message if provided
          if (state.initialMessage && state.threadId) {
            await sendThreadMessage(state.threadId, state.initialMessage);
          }

          // Invite users if specified
          if (state.inviteUsers && state.threadId) {
            await inviteUsersToThread(state.threadId, state.inviteUsers);
          }

          const response: DiscordResponse = {
            type: 'followup',
            content: `✅ Thread "${state.threadName}" created successfully!`,
          };

          return {
            nextState: 'completed',
            response,
          };
        },
        transitions: [
          {
            from: 'post_creation',
            to: 'completed',
          },
        ],
      },
      completed: {
        id: 'completed',
        name: 'Completed',
        type: StateType.COMPLETED,
        handler: async (state, input, context) => {
          return {
            nextState: null,
            output: {
              success: true,
              threadId: state.threadId,
              threadName: state.threadName,
            },
          };
        },
        transitions: [],
      },
      cancelled: {
        id: 'cancelled',
        name: 'Cancelled',
        type: StateType.CANCELLED,
        handler: async (state, input, context) => {
          const response: DiscordResponse = {
            type: 'edit',
            content: 'Thread creation cancelled.',
          };

          return {
            nextState: null,
            response,
            output: {
              success: false,
              threadName: state.threadName,
              message: 'Cancelled by user',
            },
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
            content: 'Thread creation timed out. Please try again.',
          };

          return {
            nextState: null,
            response,
            output: {
              success: false,
              threadName: state.threadName,
              message: 'Timeout',
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
          const errorMessage = state.validationErrors?.join(', ') || 'An error occurred';
          const response: DiscordResponse = {
            type: 'reply',
            content: `❌ ${errorMessage}`,
            ephemeral: true,
          };

          return {
            nextState: 'error_completed',
            response,
            output: {
              success: false,
              threadName: state.threadName,
              message: errorMessage,
            },
          };
        },
        transitions: [
          {
            from: 'error',
            to: 'error_completed',
          },
        ],
      },
      error_completed: {
        id: 'error_completed',
        name: 'Error Completed',
        type: StateType.COMPLETED,
        handler: async (state, input, context) => {
          return {
            nextState: null,
          };
        },
        transitions: [],
      },
    },
    onTransition: async (from, to, state) => {
      logger.log(`[Thread Creation] Transition: ${from} -> ${to}`);
    },
    onError: async (error, state) => {
      logger.error(`[Thread Creation] Error:`, error);
    },
    onCompletion: async (state, output) => {
      logger.log(`[Thread Creation] Completed:`, output);
    },
    onCancellation: async (state) => {
      logger.log(`[Thread Creation] Cancelled`);
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
 * Create thread (placeholder)
 */
async function createThread(
  state: ThreadCreationState,
  context: StateContext
): Promise<{ threadId: string; success: boolean }> {
  // This would call Discord API to create the thread
  // For now, return a mock result
  return {
    threadId: `thread_${Date.now()}`,
    success: true,
  };
}

/**
 * Send thread message (placeholder)
 */
async function sendThreadMessage(threadId: string, message: string): Promise<void> {
  // This would call Discord API to send a message to the thread
  logger.log(`Sending message to thread ${threadId}: ${message}`);
}

/**
 * Invite users to thread (placeholder)
 */
async function inviteUsersToThread(threadId: string, userIds: string[]): Promise<void> {
  // This would call Discord API to invite users to the thread
  logger.log(`Inviting users to thread ${threadId}:`, userIds);
}
