/**
 * State Machine Engine
 * Runtime engine for executing Discord interaction state machines
 */

import {
  State,
  StateMachine,
  StateMachineInstance,
  StateContext,
  StateHandlerResult,
  Transition,
  StateMachineError,
  StateMachineErrorCode,
  StateMachineResult,
  DiscordInteractionInput,
  StateTransitionHistory,
} from './core.js';

export class StateMachineEngine {
  private machines: Map<string, StateMachine<any, any, any>>;
  private instances: Map<string, StateMachineInstance<any>>;
  private timeouts: Map<string, number>;

  constructor() {
    this.machines = new Map();
    this.instances = new Map();
    this.timeouts = new Map();
  }

  /**
   * Register a state machine
   */
  register<TState extends State, TInput, TOutput>(
    machine: StateMachine<TState, TInput, TOutput>
  ): void {
    this.machines.set(machine.id, machine);
  }

  /**
   * Unregister a state machine
   */
  unregister(machineId: string): void {
    this.machines.delete(machineId);
    // Cancel all instances of this machine
    for (const [instanceId, instance] of this.instances.entries()) {
      if (instance.machineId === machineId) {
        this.cancel(instanceId);
      }
    }
  }

  /**
   * Start a new state machine instance
   */
  async start<TState extends State, TInput, TOutput>(
    machineId: string,
    context: StateContext,
    initialState?: Partial<TState>
  ): Promise<StateMachineInstance<TState>> {
    const machine = this.machines.get(machineId);
    if (!machine) {
      throw new Error(`State machine ${machineId} not found`);
    }

    const instanceId = this.generateInstanceId(machineId, context.userId);
    const stateDef = machine.states[machine.initialState];
    if (!stateDef) {
      throw new Error(`Initial state ${machine.initialState} not found`);
    }

    // Create initial state
    const state: TState = {
      id: instanceId,
      name: stateDef.name,
      type: stateDef.type,
      ...initialState,
    } as TState;

    const instance: StateMachineInstance<TState> = {
      id: instanceId,
      machineId,
      currentState: machine.initialState,
      state,
      context,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: [],
    };

    this.instances.set(instanceId, instance);

    // Set timeout if initial state has one
    if (stateDef.timeout) {
      this.setTimeout(instanceId, stateDef.timeout);
    }

    return instance;
  }

  /**
   * Execute a state transition with input
   */
  async execute<TState extends State, TInput, TOutput>(
    instanceId: string,
    input: TInput
  ): Promise<StateMachineResult<TOutput>> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return {
        success: false,
        error: {
          code: StateMachineErrorCode.INVALID_STATE,
          message: `Instance ${instanceId} not found`,
          recoverable: false,
        },
        completed: false,
        cancelled: false,
      };
    }

    const machine = this.machines.get(instance.machineId);
    if (!machine) {
      return {
        success: false,
        error: {
          code: StateMachineErrorCode.INVALID_STATE,
          message: `Machine ${instance.machineId} not found`,
          recoverable: false,
        },
        completed: false,
        cancelled: false,
      };
    }

    const stateDef = machine.states[instance.currentState];
    if (!stateDef) {
      return {
        success: false,
        error: {
          code: StateMachineErrorCode.INVALID_STATE,
          message: `State ${instance.currentState} not found`,
          recoverable: false,
        },
        completed: false,
        cancelled: false,
      };
    }

    const startTime = Date.now();

    try {
      // Execute state handler with retry policy
      const result = await this.executeWithRetry(
        stateDef,
        instance.state,
        input,
        instance.context
      );

      // Update instance state
      if (result.state) {
        instance.state = { ...instance.state, ...result.state };
      }
      instance.updatedAt = Date.now();

      // Handle transition
      if (result.nextState === null) {
        // Workflow completed
        await this.complete(instanceId, result.output as any);
        return {
          success: true,
          output: result.output as any,
          response: result.response,
          completed: true,
          cancelled: false,
        };
      } else if (result.nextState) {
        await this.transition(instanceId, result.nextState);
        return {
          success: true,
          output: result.output as any,
          response: result.response,
          completed: false,
          cancelled: false,
        };
      }

      // Stay in current state
      return {
        success: true,
        output: result.output as any,
        response: result.response,
        completed: false,
        cancelled: false,
      };
    } catch (error) {
      const stateMachineError: StateMachineError = {
        code: StateMachineErrorCode.HANDLER_ERROR,
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
        details: { error },
      };

      // Add to history
      instance.history.push({
        from: instance.currentState,
        to: instance.currentState,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
        error: stateMachineError,
      });

      // Call error handler
      if (machine.onError) {
        await machine.onError(stateMachineError, instance.state);
      }

      return {
        success: false,
        error: stateMachineError,
        completed: false,
        cancelled: false,
      };
    }
  }

  /**
   * Cancel a state machine instance
   */
  async cancel(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const machine = this.machines.get(instance.machineId);
    if (machine?.onCancellation) {
      await machine.onCancellation(instance.state);
    }

    this.cleanup(instanceId);
  }

  /**
   * Get a state machine instance
   */
  getInstance<TState extends State>(instanceId: string): StateMachineInstance<TState> | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * Get all instances for a user
   */
  getUserInstances<TState extends State>(userId: string): StateMachineInstance<TState>[] {
    return Array.from(this.instances.values()).filter(
      instance => instance.context.userId === userId
    );
  }

  /**
   * Get all instances for a specific machine
   */
  getMachineInstances<TState extends State>(machineId: string): StateMachineInstance<TState>[] {
    return Array.from(this.instances.values()).filter(
      instance => instance.machineId === machineId
    );
  }

  /**
   * Transition to a new state
   */
  private async transition(instanceId: string, nextState: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const machine = this.machines.get(instance.machineId);
    if (!machine) return;

    const currentStateDef = machine.states[instance.currentState];
    const nextStateDef = machine.states[nextState];

    if (!nextStateDef) {
      throw new Error(`Target state ${nextState} not found`);
    }

    // Find transition
    const transition = this.findTransition(instance.currentState, nextState, machine);

    // Check guard
    if (transition?.guard) {
      const guardResult = await transition.guard(instance.state);
      if (!guardResult) {
        throw new Error('Transition guard failed');
      }
    }

    // Execute transition action
    if (transition?.action) {
      await transition.action(instance.state);
    }

    // Call global transition handler
    if (machine.onTransition) {
      await machine.onTransition(instance.currentState, nextState, instance.state);
    }

    // Update state
    instance.state = {
      ...instance.state,
      id: instance.id,
      name: nextStateDef.name,
      type: nextStateDef.type,
    };

    const fromState = instance.currentState;
    instance.currentState = nextState;
    instance.updatedAt = Date.now();

    // Add to history
    instance.history.push({
      from: fromState,
      to: nextState,
      timestamp: Date.now(),
    });

    // Set timeout for new state
    if (nextStateDef.timeout) {
      this.setTimeout(instanceId, nextStateDef.timeout);
    }
  }

  /**
   * Complete a state machine instance
   */
  private async complete<TOutput>(instanceId: string, output?: TOutput): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const machine = this.machines.get(instance.machineId);
    if (!machine) return;

    if (machine.onCompletion) {
      await machine.onCompletion(instance.state, output);
    }

    this.cleanup(instanceId);
  }

  /**
   * Find transition between states
   */
  private findTransition<TState extends State>(
    from: string,
    to: string,
    machine: StateMachine<TState>
  ): Transition<TState> | undefined {
    // Check state-specific transitions
    const fromStateDef = machine.states[from];
    const stateTransition = fromStateDef?.transitions.find(t => t.to === to);
    if (stateTransition) return stateTransition;

    // Check global transitions
    const globalTransition = machine.globalTransitions?.find(
      t => t.from === from && t.to === to
    );
    return globalTransition;
  }

  /**
   * Execute state handler with retry policy
   */
  private async executeWithRetry<TState extends State, TInput, TOutput>(
    stateDef: any,
    state: TState,
    input: TInput,
    context: StateContext
  ): Promise<StateHandlerResult<TState, TOutput>> {
    const retryPolicy = stateDef.retryPolicy || { maxAttempts: 1, backoffMs: 0 };
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < retryPolicy.maxAttempts; attempt++) {
      try {
        return await stateDef.handler(state, input, context);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on last attempt
        if (attempt < retryPolicy.maxAttempts - 1) {
          const delay = this.calculateDelay(retryPolicy.backoffMs, attempt, retryPolicy.exponentialBackoff);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Calculate retry delay
   */
  private calculateDelay(baseMs: number, attempt: number, exponential?: boolean): number {
    if (exponential) {
      return baseMs * Math.pow(2, attempt);
    }
    return baseMs;
  }

  /**
   * Set timeout for instance
   */
  private setTimeout(instanceId: string, timeoutMs: number): void {
    const existingTimeout = this.timeouts.get(instanceId);
    if (existingTimeout) {
      // @ts-ignore - setTimeout/clearTimeout should be available in runtime
      clearTimeout(existingTimeout);
    }

    // @ts-ignore - setTimeout should be available in runtime
    const timeout = setTimeout(() => {
      this.handleTimeout(instanceId);
    }, timeoutMs);

    this.timeouts.set(instanceId, timeout as number);
  }

  /**
   * Handle timeout
   */
  private async handleTimeout(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const machine = this.machines.get(instance.machineId);
    if (!machine) return;

    const timeoutStateDef = machine.states[instance.currentState];
    if (timeoutStateDef?.type !== 'timeout') {
      // Try to transition to timeout state if it exists
      const timeoutState = Object.keys(machine.states).find(
        key => machine.states[key].type === 'timeout'
      );

      if (timeoutState) {
        try {
          await this.transition(instanceId, timeoutState);
        } catch (error) {
          // If transition fails, cancel the instance
          await this.cancel(instanceId);
        }
      } else {
        // No timeout state, cancel the instance
        await this.cancel(instanceId);
      }
    }
  }

  /**
   * Clean up instance
   */
  private cleanup(instanceId: string): void {
    const timeout = this.timeouts.get(instanceId);
    if (timeout) {
      // @ts-ignore - clearTimeout should be available in runtime
      clearTimeout(timeout);
      this.timeouts.delete(instanceId);
    }

    this.instances.delete(instanceId);
  }

  /**
   * Generate unique instance ID
   */
  private generateInstanceId(machineId: string, userId: string): string {
    return `${machineId}:${userId}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      // @ts-ignore - setTimeout should be available in runtime
      setTimeout(resolve, ms);
    });
  }

  /**
   * Clean up all instances
   */
  destroy(): void {
    for (const timeout of this.timeouts.values()) {
      // @ts-ignore - clearTimeout should be available in runtime
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    this.instances.clear();
    this.machines.clear();
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    registeredMachines: number;
    activeInstances: number;
    instancesByMachine: Record<string, number>;
  } {
    const instancesByMachine: Record<string, number> = {};

    for (const instance of this.instances.values()) {
      instancesByMachine[instance.machineId] = (instancesByMachine[instance.machineId] || 0) + 1;
    }

    return {
      registeredMachines: this.machines.size,
      activeInstances: this.instances.size,
      instancesByMachine,
    };
  }
}
