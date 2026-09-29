/**
 * Discord Interaction State Machine Framework
 * Typed state machine for modeling Discord slash commands, follow-ups, and workflows
 */

// ============================================================================
// Core State Machine Types
// ============================================================================

/**
 * Base interface for all state machine states
 */
export interface State {
  readonly id: string;
  readonly name: string;
  readonly type: StateType;
}

/**
 * State types for different interaction patterns
 */
export enum StateType {
  INITIAL = 'initial',
  AWAITING_INPUT = 'awaiting_input',
  PROCESSING = 'processing',
  AWAITING_CONFIRMATION = 'awaiting_confirmation',
  COMPLETED = 'completed',
  ERROR = 'error',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout',
}

/**
 * Transition between states
 */
export interface Transition<TState extends State = State> {
  readonly from: string;
  readonly to: string;
  readonly condition?: (state: TState) => boolean;
  readonly action?: (state: TState) => Promise<void> | void;
  readonly guard?: (state: TState) => boolean | Promise<boolean>;
}

/**
 * State definition with handler and metadata
 */
export interface StateDefinition<TState extends State = State, TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly name: string;
  readonly type: StateType;
  readonly handler: StateHandler<TState, TInput, TOutput>;
  readonly timeout?: number;
  readonly retryPolicy?: RetryPolicy;
  readonly transitions: Transition<TState>[];
}

/**
 * State handler function
 */
export type StateHandler<TState extends State, TInput, TOutput> = (
  state: TState,
  input: TInput,
  context: StateContext
) => Promise<StateHandlerResult<TState, TOutput>>;

/**
 * Result from state handler execution
 */
export interface StateHandlerResult<TState extends State, TOutput> {
  readonly nextState?: string | null;
  readonly output?: TOutput;
  readonly state?: Partial<TState>;
  readonly response?: DiscordResponse;
  readonly error?: StateMachineError;
}

/**
 * Context provided to state handlers
 */
export interface StateContext {
  readonly userId: string;
  readonly guildId?: string;
  readonly channelId: string;
  readonly interactionId: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: number;
}

/**
 * Discord response configuration
 */
export interface DiscordResponse {
  readonly type: 'reply' | 'edit' | 'followup' | 'defer' | 'modal';
  readonly content?: string;
  readonly embeds?: DiscordEmbed[];
  readonly components?: DiscordComponent[] | DiscordComponent[][];
  readonly ephemeral?: boolean;
  readonly files?: DiscordFile[];
}

/**
 * Discord embed
 */
export interface DiscordEmbed {
  readonly title?: string;
  readonly description?: string;
  readonly color?: number;
  readonly fields?: DiscordEmbedField[];
  readonly footer?: DiscordEmbedFooter;
  readonly timestamp?: string;
}

/**
 * Discord embed field
 */
export interface DiscordEmbedField {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

/**
 * Discord embed footer
 */
export interface DiscordEmbedFooter {
  readonly text: string;
  readonly icon_url?: string;
}

/**
 * Discord component (buttons, select menus, etc.)
 */
export interface DiscordComponent {
  readonly type: 'action_row' | 'button' | 'select_menu' | 'text_input';
  readonly custom_id?: string;
  readonly style?: number;
  readonly label?: string;
  readonly options?: DiscordSelectOption[];
  readonly placeholder?: string;
  readonly min_values?: number;
  readonly max_values?: number;
}

/**
 * Discord select option
 */
export interface DiscordSelectOption {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
  readonly emoji?: DiscordEmoji;
  readonly default?: boolean;
}

/**
 * Discord emoji
 */
export interface DiscordEmoji {
  readonly id?: string;
  readonly name: string;
  readonly animated?: boolean;
}

/**
 * Discord file attachment
 */
export interface DiscordFile {
  readonly name: string;
  readonly data: Uint8Array;
  readonly description?: string;
}

/**
 * Retry policy for state execution
 */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly exponentialBackoff?: boolean;
}

/**
 * State machine error
 */
export interface StateMachineError {
  readonly code: StateMachineErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly userMessage?: string;
  readonly details?: Record<string, unknown>;
}

/**
 * State machine error codes
 */
export enum StateMachineErrorCode {
  INVALID_STATE = 'invalid_state',
  INVALID_TRANSITION = 'invalid_transition',
  GUARD_FAILED = 'guard_failed',
  TIMEOUT = 'timeout',
  HANDLER_ERROR = 'handler_error',
  VALIDATION_ERROR = 'validation_error',
  PERMISSION_DENIED = 'permission_denied',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
}

// ============================================================================
// State Machine Definition
// ============================================================================

/**
 * Complete state machine definition
 */
export interface StateMachine<TState extends State = State, TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly name: string;
  readonly initialState: string;
  readonly states: Record<string, StateDefinition<TState, TInput, TOutput>>;
  readonly globalTransitions?: Transition<TState>[];
  readonly onTransition?: (from: string, to: string, state: TState) => Promise<void> | void;
  readonly onError?: (error: StateMachineError, state: TState) => Promise<void> | void;
  readonly onCompletion?: (state: TState, output: TOutput) => Promise<void> | void;
  readonly onCancellation?: (state: TState) => Promise<void> | void;
}

// ============================================================================
// State Machine Instance
// ============================================================================

/**
 * Active state machine instance
 */
export interface StateMachineInstance<TState extends State = State> {
  readonly id: string;
  readonly machineId: string;
  currentState: string;
  state: TState;
  readonly context: StateContext;
  readonly createdAt: number;
  updatedAt: number;
  timeoutAt?: number;
  history: StateTransitionHistory[];
}

/**
 * History of state transitions
 */
export interface StateTransitionHistory {
  readonly from: string;
  readonly to: string;
  readonly timestamp: number;
  readonly duration?: number;
  readonly error?: StateMachineError;
}

// ============================================================================
// Input Types
// ============================================================================

/**
 * Slash command input
 */
export interface SlashCommandInput {
  readonly commandName: string;
  readonly options: Record<string, unknown>;
  readonly subcommand?: string;
  readonly subcommandGroup?: string;
}

/**
 * Button click input
 */
export interface ButtonInput {
  readonly customId: string;
  readonly message?: {
    readonly id: string;
    readonly content?: string;
    readonly embeds?: DiscordEmbed[];
  };
}

/**
 * Modal submission input
 */
export interface ModalInput {
  readonly customId: string;
  readonly components: ModalComponentData[];
}

/**
 * Modal component data
 */
export interface ModalComponentData {
  readonly customId: string;
  readonly type: 'text_input' | 'select_menu';
  readonly value?: string;
  readonly values?: string[];
}

/**
 * Select menu input
 */
export interface SelectInput {
  readonly customId: string;
  readonly values: string[];
}

/**
 * Thread creation input
 */
export interface ThreadInput {
  readonly name: string;
  readonly autoArchiveDuration?: number;
  readonly reason?: string;
  readonly message?: {
    readonly id: string;
    readonly content?: string;
  };
}

/**
 * Union type for all Discord interaction inputs
 */
export type DiscordInteractionInput =
  | SlashCommandInput
  | ButtonInput
  | ModalInput
  | SelectInput
  | ThreadInput;

// ============================================================================
// Output Types
// ============================================================================

/**
 * State machine execution result
 */
export interface StateMachineResult<TOutput = unknown> {
  readonly success: boolean;
  readonly output?: TOutput;
  readonly error?: StateMachineError;
  readonly response?: DiscordResponse;
  readonly completed: boolean;
  readonly cancelled: boolean;
}
