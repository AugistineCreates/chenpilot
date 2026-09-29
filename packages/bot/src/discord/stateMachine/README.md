# Discord Interaction State Machine Framework

Typed state machine framework for modeling Discord slash commands, follow-ups, thread creation, and long-running workflows.

## Overview

This framework provides a type-safe, declarative way to model complex Discord bot interactions as state machines. Instead of using inline branching logic, you define states, transitions, and handlers that clearly express the flow of your bot interactions.

## Architecture

### Core Components

1. **Core Types** (`core.ts`)
   - `State`: Base interface for all state machine states
   - `StateMachine`: Complete state machine definition
   - `StateMachineInstance`: Active runtime instance
   - `StateContext`: Context provided to state handlers
   - `DiscordResponse`: Discord response configuration

2. **Engine** (`engine.ts`)
   - `StateMachineEngine`: Runtime engine for executing state machines
   - Instance lifecycle management
   - Transition execution with guards
   - Timeout handling
   - Retry policies

3. **Pre-built Machines** (`machines/`)
   - `slashCommand.ts`: Slash command interaction flow
   - `threadCreation.ts`: Thread creation workflow
   - `longRunningWorkflow.ts`: Long-running workflow with checkpoints

## State Types

```typescript
enum StateType {
  INITIAL = 'initial',
  AWAITING_INPUT = 'awaiting_input',
  PROCESSING = 'processing',
  AWAITING_CONFIRMATION = 'awaiting_confirmation',
  COMPLETED = 'completed',
  ERROR = 'error',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout',
}
```

## Basic Usage

### 1. Define Your State

```typescript
interface MyWorkflowState extends State {
  readonly userId: string;
  readonly step: number;
  readonly data?: unknown;
}
```

### 2. Create a State Machine

```typescript
import { createSlashCommandMachine } from './machines/slashCommand.js';

const machine = createSlashCommandMachine('mycommand');
```

### 3. Register with Engine

```typescript
import { StateMachineEngine } from './engine.js';

const engine = new StateMachineEngine();
engine.register(machine);
```

### 4. Start an Instance

```typescript
const context: StateContext = {
  userId: 'user123',
  channelId: 'channel456',
  interactionId: 'interaction789',
  timestamp: Date.now(),
  metadata: {},
};

const instance = await engine.start('slash:mycommand', context);
```

### 5. Execute with Input

```typescript
const input: SlashCommandInput = {
  commandName: 'mycommand',
  options: { arg1: 'value1' },
};

const result = await engine.execute(instance.id, input);
```

## Slash Command Machine

The slash command machine provides a standard flow for Discord slash commands:

**States:**
- `initial` → `validating` → `processing` → `responding` → `completed`
- Error handling with `error` → `error_completed`

**Features:**
- Input validation
- Command execution with 30s timeout
- Automatic response formatting
- Error handling with user-friendly messages

```typescript
import { createSlashCommandMachine } from './machines/slashCommand.js';

const machine = createSlashCommandMachine('trustline');
```

## Thread Creation Machine

The thread creation machine handles Discord thread creation workflows:

**States:**
- `initial` → `validating` → `awaiting_confirmation` → `creating` → `post_creation` → `completed`
- Cancellation and timeout handling

**Features:**
- Thread name validation
- Auto-archive duration validation
- User confirmation UI
- Post-creation setup (messages, invites)
- 5-minute confirmation timeout

```typescript
import { createThreadCreationMachine } from './machines/threadCreation.js';

const machine = createThreadCreationMachine();
```

## Long-Running Workflow Machine

The long-running workflow machine handles complex, multi-step workflows:

**States:**
- `initial` → `initializing` → `running` → `completing` → `completed`
- Pause/resume functionality
- Cancellation handling
- Error recovery with retry
- Checkpoint-based persistence

**Features:**
- Step-by-step execution
- Progress tracking
- Checkpoint creation for resume
- Pause/resume support
- Error recovery with user input
- 24-hour pause timeout
- Automatic cleanup

```typescript
import { createLongRunningWorkflowMachine } from './machines/longRunningWorkflow.js';

const machine = createLongRunningWorkflowMachine('multisig', [
  'initiate',
  'collect_signatures',
  'submit_transaction',
  'confirm',
]);
```

## Custom State Machine

### Define State Interface

```typescript
interface CustomState extends State {
  readonly customField: string;
  readonly stepData: Record<string, unknown>;
}
```

### Define State Machine

```typescript
const customMachine: StateMachine<CustomState, CustomInput, CustomOutput> = {
  id: 'custom-workflow',
  name: 'Custom Workflow',
  initialState: 'initial',
  states: {
    initial: {
      id: 'initial',
      name: 'Initial',
      type: StateType.INITIAL,
      handler: async (state, input, context) => {
        return {
          nextState: 'processing',
          state: { customField: 'value' },
        };
      },
      transitions: [
        { from: 'initial', to: 'processing' },
      ],
    },
    processing: {
      id: 'processing',
      name: 'Processing',
      type: StateType.PROCESSING,
      timeout: 30000,
      handler: async (state, input, context) => {
        // Your processing logic
        return {
          nextState: 'completed',
          output: { success: true },
        };
      },
      transitions: [
        { from: 'processing', to: 'completed' },
      ],
    },
    completed: {
      id: 'completed',
      name: 'Completed',
      type: StateType.COMPLETED,
      handler: async (state, input, context) => {
        return {
          nextState: null,
          output: { success: true },
        };
      },
      transitions: [],
    },
  },
  onTransition: async (from, to, state) => {
    console.log(`Transition: ${from} -> ${to}`);
  },
  onError: async (error, state) => {
    console.error('Error:', error);
  },
  onCompletion: async (state, output) => {
    console.log('Completed:', output);
  },
};
```

## Transitions and Guards

### Basic Transition

```typescript
transitions: [
  { from: 'state1', to: 'state2' },
]
```

### Conditional Transition

```typescript
transitions: [
  {
    from: 'state1',
    to: 'state2',
    condition: (state) => state.field === 'value',
  },
]
```

### Guard Function

```typescript
transitions: [
  {
    from: 'state1',
    to: 'state2',
    guard: async (state) => {
      // Async validation
      return await validateState(state);
    },
  },
]
```

### Transition Action

```typescript
transitions: [
  {
    from: 'state1',
    to: 'state2',
    action: async (state) => {
      // Perform action during transition
      await cleanupResources(state);
    },
  },
]
```

## Discord Responses

### Reply

```typescript
const response: DiscordResponse = {
  type: 'reply',
  content: 'Hello!',
  ephemeral: true,
};
```

### Edit

```typescript
const response: DiscordResponse = {
  type: 'edit',
  content: 'Updated message',
};
```

### Follow-up

```typescript
const response: DiscordResponse = {
  type: 'followup',
  content: 'Additional information',
};
```

### With Components

```typescript
const response: DiscordResponse = {
  type: 'reply',
  content: 'Choose an option:',
  components: [
    [
      {
        type: 'button',
        custom_id: 'option1',
        label: 'Option 1',
        style: 1,
      },
      {
        type: 'button',
        custom_id: 'option2',
        label: 'Option 2',
        style: 2,
      },
    ],
  ],
};
```

### With Embeds

```typescript
const response: DiscordResponse = {
  type: 'reply',
  embeds: [
    {
      title: 'Title',
      description: 'Description',
      color: 0x00ff00,
      fields: [
        {
          name: 'Field 1',
          value: 'Value 1',
          inline: true,
        },
      ],
    },
  ],
};
```

## Timeout Handling

States can have timeouts to prevent hanging workflows:

```typescript
processing: {
  id: 'processing',
  name: 'Processing',
  type: StateType.PROCESSING,
  timeout: 30000, // 30 seconds
  handler: async (state, input, context) => {
    // Handler logic
  },
  transitions: [...],
}
```

When a timeout occurs, the engine attempts to transition to a state with type `TIMEOUT`. Create one to handle timeouts gracefully:

```typescript
timeout: {
  id: 'timeout',
  name: 'Timeout',
  type: StateType.TIMEOUT,
  handler: async (state, input, context) => {
    return {
      response: {
        type: 'edit',
        content: 'Operation timed out',
      },
    };
  },
  transitions: [],
}
```

## Retry Policies

Add retry logic to state handlers:

```typescript
processing: {
  id: 'processing',
  name: 'Processing',
  type: StateType.PROCESSING,
  retryPolicy: {
    maxAttempts: 3,
    backoffMs: 1000,
    exponentialBackoff: true,
  },
  handler: async (state, input, context) => {
    // Will retry up to 3 times with exponential backoff
  },
  transitions: [...],
}
```

## Error Handling

### State-Level Error

```typescript
handler: async (state, input, context) => {
  return {
    error: {
      code: StateMachineErrorCode.VALIDATION_ERROR,
      message: 'Invalid input',
      recoverable: false,
    },
  };
}
```

### Global Error Handler

```typescript
const machine: StateMachine<...> = {
  // ... other properties
  onError: async (error, state) => {
    console.error('Workflow error:', error);
    // Send error notification, log to monitoring, etc.
  },
};
```

### Error State

```typescript
error: {
  id: 'error',
  name: 'Error',
  type: StateType.ERROR,
  handler: async (state, input, context) => {
    return {
      nextState: null,
      response: {
        type: 'reply',
        content: 'An error occurred',
        ephemeral: true,
      },
    };
  },
  transitions: [],
}
```

## Instance Management

### Get Instance

```typescript
const instance = engine.getInstance(instanceId);
```

### Get User Instances

```typescript
const userInstances = engine.getUserInstances(userId);
```

### Get Machine Instances

```typescript
const machineInstances = engine.getMachineInstances(machineId);
```

### Cancel Instance

```typescript
await engine.cancel(instanceId);
```

### Engine Statistics

```typescript
const stats = engine.getStats();
// {
//   registeredMachines: 5,
//   activeInstances: 12,
//   instancesByMachine: { 'slash:command': 3, 'thread-creation': 2, ... }
// }
```

## Integration with Discord Adapter

### Register State Machines

```typescript
// In your Discord adapter initialization
import { StateMachineEngine } from './stateMachine/engine.js';
import { createSlashCommandMachine } from './stateMachine/machines/slashCommand.js';

const stateMachineEngine = new StateMachineEngine();

// Register machines
stateMachineEngine.register(createSlashCommandMachine('trustline'));
stateMachineEngine.register(createSlashCommandMachine('validate'));
stateMachineEngine.register(createThreadCreationMachine());
```

### Handle Interactions

```typescript
// In your interaction handler
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const machineId = `slash:${interaction.commandName}`;
    const context: StateContext = {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      interactionId: interaction.id,
      timestamp: Date.now(),
      metadata: {},
    };

    const instance = await stateMachineEngine.start(machineId, context);
    const input: SlashCommandInput = {
      commandName: interaction.commandName,
      options: interaction.options.data,
    };

    const result = await stateMachineEngine.execute(instance.id, input);

    if (result.response) {
      await sendDiscordResponse(interaction, result.response);
    }
  }
});
```

## Best Practices

1. **Keep States Focused**: Each state should have a single responsibility
2. **Use Type Guards**: Leverage TypeScript's type system for state-specific logic
3. **Handle Timeouts**: Always define timeout states for long-running operations
4. **Log Transitions**: Use `onTransition` for debugging and monitoring
5. **Clean Up Resources**: Use transition actions or `onCompletion` for cleanup
6. **Validate Input Early**: Use the initial state for input validation
7. **Provide User Feedback**: Always send Discord responses for state changes
8. **Handle Errors Gracefully**: Define error states with user-friendly messages

## Migration from Inline Logic

### Before (Inline Branching)

```typescript
async function handleTrustline(interaction) {
  const asset = interaction.options.getString('asset');
  const issuer = interaction.options.getString('issuer');

  if (!asset || !issuer) {
    await interaction.reply('Missing required fields');
    return;
  }

  try {
    await interaction.reply('Processing...');
    const result = await createTrustline(asset, issuer);
    await interaction.editReply(`Trustline created: ${result}`);
  } catch (error) {
    await interaction.editReply('Error creating trustline');
  }
}
```

### After (State Machine)

```typescript
const machine = createSlashCommandMachine('trustline');

// The state machine handles:
// - Input validation in 'initial' state
// - Processing in 'processing' state with timeout
// - Error handling in 'error' state
// - Response formatting in 'responding' state
// - Completion in 'completed' state
```

## Testing

### Unit Test State Handler

```typescript
import { StateType } from './core.js';

describe('My State Machine', () => {
  it('should transition from initial to processing', async () => {
    const state: MyState = { id: '1', name: 'initial', type: StateType.INITIAL };
    const input = { data: 'test' };
    const context: StateContext = { /* ... */ };

    const result = await machine.states.initial.handler(state, input, context);

    expect(result.nextState).toBe('processing');
  });
});
```

### Integration Test with Engine

```typescript
describe('State Machine Engine', () => {
  it('should execute complete workflow', async () => {
    const engine = new StateMachineEngine();
    engine.register(machine);

    const instance = await engine.start('machine-id', context);
    const result = await engine.execute(instance.id, input);

    expect(result.completed).toBe(true);
    expect(result.output).toBeDefined();
  });
});
```

## Performance Considerations

1. **Instance Cleanup**: Always cancel instances when they're no longer needed
2. **Timeouts**: Use appropriate timeouts for each state
3. **Retry Policies**: Configure retry policies for external API calls
4. **Memory Usage**: Monitor active instances with `engine.getStats()`
5. **Persistence**: For long-running workflows, implement checkpoint persistence

## Troubleshooting

### Instance Not Found

```
Error: Instance instance-id not found
```

**Solution**: Ensure the instance was started and hasn't been cancelled or timed out.

### Transition Guard Failed

```
Error: Transition guard failed
```

**Solution**: Check your guard function logic and ensure it returns `true` for valid transitions.

### State Handler Timeout

```
Error: State handler timed out
```

**Solution**: Increase the state timeout or optimize the handler logic.

### Type Errors

```
Type 'string' is not assignable to type 'number'
```

**Solution**: Ensure your state interface matches the actual data types used in handlers.

## Future Enhancements

- [ ] Visual state machine editor
- [ ] State machine debugging tools
- [ ] Distributed state machine execution
- [ ] State machine serialization/deserialization
- [ ] State machine versioning and migration
- [ ] Performance monitoring and analytics
- [ ] State machine testing utilities
