/**
 * Workflow Engine
 * Orchestrates multi-step workflows with state management
 */

import {
  Workflow,
  WorkflowState,
  WorkflowTransition,
  WorkflowTransitionResult,
  CommandError,
  ErrorCode,
} from '../types.js';

export interface WorkflowInstance<TState> {
  id: string;
  workflowId: string;
  currentState: string;
  state: TState;
  userId: string;
  createdAt: number;
  updatedAt: number;
  timeoutAt?: number;
}

export class WorkflowEngine {
  private workflows: Map<string, Workflow<any>>;
  private instances: Map<string, WorkflowInstance<any>>;
  private timeouts: Map<string, NodeJS.Timeout>;

  constructor() {
    this.workflows = new Map();
    this.instances = new Map();
    this.timeouts = new Map();
  }

  /**
   * Register a workflow
   */
  register<TState>(workflow: Workflow<TState>): void {
    this.workflows.set(workflow.id, workflow);
  }

  /**
   * Start a new workflow instance
   */
  async start<TState>(
    workflowId: string,
    userId: string,
    initialState: TState
  ): Promise<WorkflowInstance<TState>> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const instanceId = this.generateInstanceId(workflowId, userId);
    const instance: WorkflowInstance<TState> = {
      id: instanceId,
      workflowId,
      currentState: workflow.initialState,
      state: initialState,
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.instances.set(instanceId, instance);

    // Set timeout if initial state has one
    const initialStateDef = workflow.states[workflow.initialState];
    if (initialStateDef?.timeout) {
      this.setTimeout(instanceId, initialStateDef.timeout);
    }

    return instance;
  }

  /**
   * Execute a workflow step
   */
  async executeStep<TState>(
    instanceId: string,
    input: any
  ): Promise<WorkflowTransitionResult<TState>> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Workflow instance ${instanceId} not found`);
    }

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${instance.workflowId} not found`);
    }

    const currentStateDef = workflow.states[instance.currentState];
    if (!currentStateDef) {
      throw new Error(`State ${instance.currentState} not found in workflow`);
    }

    try {
      // Execute the state handler
      const result = await currentStateDef.handler(instance.state, input);
      
      // Update instance state
      if (result.state) {
        instance.state = result.state;
      }
      instance.updatedAt = Date.now();

      // Transition to next state
      if (result.nextState) {
        await this.transition(instanceId, result.nextState);
      } else if (result.nextState === null) {
        // Workflow completed
        await this.complete(instanceId);
      }

      return result;
    } catch (error) {
      const commandError: CommandError = {
        code: 'WORKFLOW_ERROR',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      };

      if (workflow.onError) {
        await workflow.onError(commandError, instance.state);
      }

      throw commandError;
    }
  }

  /**
   * Transition to a new state
   */
  private async transition<TState>(instanceId: string, nextState: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) return;

    const transition = Object.values(workflow.transitions).find(
      t => t.from === instance.currentState && t.to === nextState
    );

    if (transition?.condition && !transition.condition(instance.state)) {
      throw new Error('Transition condition not met');
    }

    if (transition?.action) {
      await transition.action(instance.state);
    }

    instance.currentState = nextState;
    instance.updatedAt = Date.now();

    // Set timeout for new state
    const nextStateDef = workflow.states[nextState];
    if (nextStateDef?.timeout) {
      this.setTimeout(instanceId, nextStateDef.timeout);
    }
  }

  /**
   * Complete a workflow
   */
  private async complete<TState>(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) return;

    if (workflow.onCompletion) {
      await workflow.onCompletion(instance.state);
    }

    this.cleanup(instanceId);
  }

  /**
   * Cancel a workflow instance
   */
  cancel(instanceId: string): void {
    this.cleanup(instanceId);
  }

  /**
   * Get workflow instance
   */
  getInstance<TState>(instanceId: string): WorkflowInstance<TState> | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * Get user's active workflow instances
   */
  getUserInstances<TState>(userId: string): WorkflowInstance<TState>[] {
    return Array.from(this.instances.values()).filter(
      instance => instance.userId === userId
    );
  }

  /**
   * Set timeout for workflow instance
   */
  private setTimeout(instanceId: string, timeoutMs: number): void {
    // Clear existing timeout
    const existingTimeout = this.timeouts.get(instanceId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      this.cancel(instanceId);
    }, timeoutMs);

    this.timeouts.set(instanceId, timeout);
  }

  /**
   * Clean up workflow instance
   */
  private cleanup(instanceId: string): void {
    const timeout = this.timeouts.get(instanceId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(instanceId);
    }

    this.instances.delete(instanceId);
  }

  /**
   * Generate unique instance ID
   */
  private generateInstanceId(workflowId: string, userId: string): string {
    return `${workflowId}:${userId}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up all instances
   */
  destroy(): void {
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    this.instances.clear();
  }
}
