# Telegram Typed Command System Architecture

## Overview

Refactor the Telegram adapter away from any-heavy command handlers into a typed command/workflow system with clear state transitions, reusable command contracts, and safer integration with backend execution flows.

## Architecture Goals

1. **Typed Commands**: Strongly typed command definitions with clear input/output contracts
2. **State Machine**: Clear state transitions for multi-step workflows
3. **Reusable Contracts**: Command contracts that can be reused across platforms
4. **Safer Integration**: Better integration boundaries with backend services
5. **Error Handling**: Comprehensive error handling and recovery
6. **Testability**: Easy to test commands and workflows in isolation

## Module Structure

```
packages/bot/src/commands/
├── types.ts                    # Core type definitions
├── contracts/                 # Command contracts
│   ├── CommandContract.ts     # Base command interface
│   ├── CommandContext.ts      # Command execution context
│   ├── CommandResult.ts       # Command result types
│   └── CommandError.ts        # Error types
├── registry.ts                 # Command registry (existing)
├── handlers/                   # Command handlers (existing)
│   ├── start.ts
│   ├── help.ts
│   ├── portfolio.ts
│   └── ...
├── workflows/                  # Workflow state machine
│   ├── WorkflowEngine.ts      # Workflow orchestration
│   ├── WorkflowState.ts       # State definitions
│   ├── WorkflowTransition.ts  # Transition logic
│   └── workflows/
│       ├── multisig.ts        # Multisig workflow
│       └── swap.ts            # Swap workflow
└── middleware/                # Command middleware
    ├── auth.ts                # Authentication middleware
    ├── rateLimit.ts           # Rate limiting middleware
    ├── validation.ts          # Input validation
    └── errorHandling.ts       # Error handling
```

## Core Type Definitions

### Command Contract

```typescript
interface CommandContract<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;
  handler: (context: CommandContext<TInput>) => Promise<CommandResult<TOutput>>;
  middleware?: CommandMiddleware[];
  permissions?: Permission[];
  rateLimit?: RateLimitConfig;
}
```

### Command Context

```typescript
interface CommandContext<TInput> {
  userId: string;
  chatId: string;
  platform: 'telegram' | 'discord';
  input: TInput;
  metadata: {
    timestamp: number;
    messageId: string;
    replyToMessageId?: string;
  };
  services: {
    backend: BackendClient;
    assetIntelligence: AssetIntelligence;
    workflowEngine: WorkflowEngine;
  };
}
```

### Command Result

```typescript
type CommandResult<TOutput> = 
  | { success: true; data: TOutput; next?: string }
  | { success: false; error: CommandError; retry?: boolean };
```

### Command Error

```typescript
interface CommandError {
  code: ErrorCode;
  message: string;
  details?: Record<string, any>;
  recoverable: boolean;
  userMessage?: string;
}

type ErrorCode =
  | 'INVALID_INPUT'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'BACKEND_ERROR'
  | 'NETWORK_ERROR'
  | 'PERMISSION_DENIED'
  | 'WORKFLOW_ERROR';
```

## Workflow State Machine

### Workflow Definition

```typescript
interface Workflow<TState> {
  id: string;
  name: string;
  initialState: string;
  states: Record<string, WorkflowState<TState>>;
  transitions: Record<string, WorkflowTransition<TState>>;
  onCompletion: (state: TState) => Promise<void>;
  onError: (error: CommandError, state: TState) => Promise<void>;
}
```

### Workflow State

```typescript
interface WorkflowState<TState> {
  name: string;
  inputSchema?: z.ZodSchema<any>;
  outputSchema?: z.ZodSchema<any>;
  handler: (state: TState, input: any) => Promise<WorkflowTransitionResult<TState>>;
  timeout?: number;
  retryPolicy?: RetryPolicy;
}
```

### Workflow Transition

```typescript
interface WorkflowTransition<TState> {
  from: string;
  to: string;
  condition?: (state: TState) => boolean;
  action?: (state: TState) => Promise<void>;
}
```

## Command Middleware

### Middleware Chain

```typescript
type CommandMiddleware<TInput> = (
  context: CommandContext<TInput>,
  next: () => Promise<CommandResult<any>>
) => Promise<CommandResult<any>>;

// Example middleware
const authMiddleware: CommandMiddleware<any> = async (context, next) => {
  if (!isAuthenticated(context.userId)) {
    return {
      success: false,
      error: {
        code: 'AUTHENTICATION_FAILED',
        message: 'User not authenticated',
        recoverable: false,
      },
    };
  }
  return next();
};
```

### Available Middleware

1. **Authentication**: Verify user identity
2. **Rate Limiting**: Enforce rate limits
3. **Input Validation**: Validate input against schema
4. **Permission Check**: Verify user permissions
5. **Error Handling**: Standardize error responses
6. **Logging**: Log command execution
7. **Metrics**: Track command performance

## Command Registry

### Typed Registry

```typescript
class TypedCommandRegistry {
  private commands: Map<string, CommandContract<any, any>>;

  register<TInput, TOutput>(contract: CommandContract<TInput, TOutput>): void;
  get<TInput, TOutput>(name: string): CommandContract<TInput, TOutput> | undefined;
  execute<TInput, TOutput>(
    name: string, 
    context: CommandContext<TInput>
  ): Promise<CommandResult<TOutput>>;
  list(): CommandContract<any, any>[];
}
```

## Integration with Backend

### Backend Client

```typescript
interface BackendClient {
  executeCommand<TInput, TOutput>(
    command: string,
    input: TInput,
    userId: string
  ): Promise<TOutput>;
  
  executeWorkflow<TState>(
    workflow: string,
    state: TState,
    step: string
  ): Promise<WorkflowTransitionResult<TState>>;
}
```

### Safer Integration

1. **Type Safety**: All backend calls are typed
2. **Error Handling**: Standardized error handling
3. **Retry Logic**: Automatic retry with exponential backoff
4. **Timeout Protection**: Timeout on all backend calls
5. **Circuit Breaker**: Circuit breaker for failing services
6. **Request Validation**: Validate requests before sending

## Example: Multisig Workflow

### Workflow Definition

```typescript
const multisigWorkflow: Workflow<MultisigState> = {
  id: 'multisig_setup',
  name: 'Multisig Wallet Setup',
  initialState: 'init',
  states: {
    init: {
      name: 'Initialize',
      handler: async (state, input) => {
        return {
          nextState: 'collect_signers',
          output: { message: 'How many signers do you need?' },
        };
      },
    },
    collect_signers: {
      name: 'Collect Signers',
      inputSchema: z.object({ count: z.number() }),
      handler: async (state, input) => {
        state.signerCount = input.count;
        return {
          nextState: 'collect_threshold',
          output: { message: `Enter ${input.count} signer addresses` },
        };
      },
    },
    collect_threshold: {
      name: 'Collect Threshold',
      inputSchema: z.object({ threshold: z.number() }),
      handler: async (state, input) => {
        state.threshold = input.threshold;
        return {
          nextState: 'complete',
          output: { message: 'Multisig wallet created!' },
        };
      },
    },
    complete: {
      name: 'Complete',
      handler: async (state, input) => {
        return {
          nextState: null,
          output: { message: 'Workflow complete' },
        };
      },
    },
  },
  transitions: {
    init_to_collect: { from: 'init', to: 'collect_signers' },
    collect_to_threshold: { from: 'collect_signers', to: 'collect_threshold' },
    threshold_to_complete: { from: 'collect_threshold', to: 'complete' },
  },
  onCompletion: async (state) => {
    await backend.createMultisigWallet(state);
  },
  onError: async (error, state) => {
    await notifyError(error, state);
  },
};
```

## Migration Strategy

### Phase 1: Create Type System
- Define core types
- Create command contract interfaces
- Implement typed command registry

### Phase 2: Migrate Simple Commands
- Migrate simple commands (ping, help, start)
- Add type schemas
- Test with existing handlers

### Phase 3: Migrate Complex Commands
- Migrate complex commands (portfolio, swap)
- Add middleware
- Test error handling

### Phase 4: Implement Workflow Engine
- Implement workflow state machine
- Migrate multisig workflow
- Migrate swap workflow

### Phase 5: Update Adapter
- Update Telegram adapter to use typed system
- Update command dispatch
- Remove old handler code

### Phase 6: Testing & Cleanup
- Comprehensive testing
- Remove deprecated code
- Update documentation

## Benefits

1. **Type Safety**: Compile-time type checking
2. **Reusability**: Commands can be reused across platforms
3. **Testability**: Easy to test in isolation
4. **Maintainability**: Clear structure and separation of concerns
5. **Error Handling**: Standardized error handling
6. **Extensibility**: Easy to add new commands and workflows
7. **Documentation**: Self-documenting through types
