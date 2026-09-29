/**
 * Slash Command State Machine
 * Typed state machine for Discord slash command interactions
 */

import {
  State,
  StateMachine,
  StateType,
  StateDefinition,
  StateContext,
  StateHandlerResult,
  DiscordResponse,
  SlashCommandInput,
  StateMachineError,
  StateMachineErrorCode,
} from '../core.js';

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
 * Slash command state
 */
export interface SlashCommandState extends State {
  readonly commandName: string;
  readonly options: Record<string, unknown>;
  readonly subcommand?: string;
  readonly subcommandGroup?: string;
  readonly validationErrors?: string[];
  readonly processingResult?: unknown;
  readonly responseSent?: boolean;
}

/**
 * Slash command output
 */
export interface SlashCommandOutput {
  readonly success: boolean;
  readonly message?: string;
  readonly data?: unknown;
  readonly followUp?: boolean;
}

/**
 * Create a slash command state machine
 */
export function createSlashCommandMachine(commandName: string): StateMachine<
  SlashCommandState,
  SlashCommandInput,
  SlashCommandOutput
> {
  return {
    id: `slash:${commandName}`,
    name: `${commandName} Command`,
    initialState: 'initial',
    states: {
      initial: {
        id: 'initial',
        name: 'Initial',
        type: StateType.INITIAL,
        handler: async (state, input, context) => {
          // Validate input
          if (input.commandName !== commandName) {
            return {
              error: {
                code: StateMachineErrorCode.VALIDATION_ERROR,
                message: `Expected command ${commandName}, got ${input.commandName}`,
                recoverable: false,
              },
            };
          }

          return {
            nextState: 'validating',
            state: {
              commandName: input.commandName,
              options: input.options,
              subcommand: input.subcommand,
              subcommandGroup: input.subcommandGroup,
            },
          };
        },
        transitions: [
          {
            from: 'initial',
            to: 'validating',
          },
        ],
      },
      validating: {
        id: 'validating',
        name: 'Validating',
        type: StateType.PROCESSING,
        handler: async (state, input, context) => {
          // Custom validation logic would go here
          // For now, just pass through
          return {
            nextState: 'processing',
          };
        },
        transitions: [
          {
            from: 'validating',
            to: 'processing',
          },
          {
            from: 'validating',
            to: 'error',
            condition: (state) => (state.validationErrors?.length ?? 0) > 0,
          },
        ],
      },
      processing: {
        id: 'processing',
        name: 'Processing',
        type: StateType.PROCESSING,
        timeout: 30000, // 30 second timeout
        handler: async (state, input, context) => {
          // Execute command logic
          // This would be replaced with actual command execution
          const result = await executeSlashCommand(state, context);

          return {
            nextState: 'responding',
            state: {
              processingResult: result,
            },
            output: result,
          };
        },
        transitions: [
          {
            from: 'processing',
            to: 'responding',
          },
          {
            from: 'processing',
            to: 'error',
            condition: (state) => !state.processingResult,
          },
        ],
      },
      responding: {
        id: 'responding',
        name: 'Responding',
        type: StateType.PROCESSING,
        handler: async (state, input, context) => {
          // Send response to Discord
          const response = formatDiscordResponse(state);

          return {
            nextState: 'completed',
            response,
            state: {
              responseSent: true,
            },
          };
        },
        transitions: [
          {
            from: 'responding',
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
            nextState: null, // Signal completion to engine
            output: state.processingResult as SlashCommandOutput,
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
      logger.log(`[Slash Command] Transition: ${from} -> ${to}`);
    },
    onError: async (error, state) => {
      logger.error(`[Slash Command] Error:`, error);
    },
    onCompletion: async (state, output) => {
      logger.log(`[Slash Command] Completed:`, output);
    },
  };
}

/**
 * Execute slash command (placeholder)
 */
async function executeSlashCommand(
  state: SlashCommandState,
  context: StateContext
): Promise<SlashCommandOutput> {
  // This would be replaced with actual command execution logic
  // For now, return a success response
  return {
    success: true,
    message: `Executed ${state.commandName}`,
    data: state.options,
  };
}

/**
 * Format Discord response
 */
function formatDiscordResponse(state: SlashCommandState): DiscordResponse {
  const result = state.processingResult as SlashCommandOutput;

  if (!result.success) {
    return {
      type: 'reply',
      content: `❌ ${result.message || 'Command failed'}`,
      ephemeral: true,
    };
  }

  return {
    type: 'reply',
    content: result.message || 'Command completed successfully',
    ephemeral: false,
  };
}
