import { SessionManager } from "../sessionManager";

/**
 * Platform abstraction for bot interactions
 */
export interface BotPlatformAdapter {
  platform: "discord" | "telegram";
  sendMessage(userId: string, message: string): Promise<boolean>;
}

/**
 * Workflow State representing the current progress of a multi-step action
 */
export interface WorkflowState {
  workflowId: string;
  userId: string;
  platform: "discord" | "telegram";
  type: string;
  step: number;
  data: Record<string, unknown>;
  isComplete: boolean;
  expiresAt?: Date;
}

/**
 * Result of a workflow step execution
 */
export interface WorkflowResult {
  message: string;
  nextStep?: number;
  isComplete?: boolean;
  data?: Record<string, unknown>;
}

/**
 * Interface for a specific workflow implementation (e.g., Multisig, Swap)
 */
export interface Workflow {
  type: string;
  start(userId: string, platform: "discord" | "telegram"): WorkflowResult;
  processInput(state: WorkflowState, input: string): Promise<WorkflowResult>;
  getStepMessage(state: WorkflowState): string;
  checkPolicy?(
    userId: string,
    platform: "discord" | "telegram",
    data: Record<string, unknown>
  ): Promise<{ allowed: boolean; message?: string }>;
}

/**
 * Bot Workflow Manager
 *
 * Unifies session handling, workflow execution, and backend orchestration.
 * Supports resumable conversations and policy-aware actions.
 */
export class BotWorkflowManager {
  private sessionManager: SessionManager;
  private workflows: Map<string, Workflow> = new Map();
  private activeSessions: Map<string, WorkflowState> = new Map(); // Local cache
  private backendUrl: string;

  constructor(backendUrl?: string) {
    this.backendUrl =
      backendUrl || process.env.BACKEND_URL || "http://localhost:3000";
    this.sessionManager = new SessionManager(this.backendUrl);
  }

  /**
   * Register a workflow type
   */
  registerWorkflow(workflow: Workflow) {
    this.workflows.set(workflow.type, workflow);
  }

  /**
   * Start a new workflow for a user
   */
  async startWorkflow(
    userId: string,
    platform: "discord" | "telegram",
    type: string
  ): Promise<WorkflowResult> {
    const workflow = this.workflows.get(type);
    if (!workflow) {
      return { message: `❌ Workflow type '${type}' not found.` };
    }

    // Check policies if the workflow defines any
    if (workflow.checkPolicy) {
      const policy = await workflow.checkPolicy(userId, platform, {});
      if (!policy.allowed) {
        return {
          message:
            policy.message ||
            `❌ You are not allowed to start this workflow due to policy restrictions.`,
        };
      }
    }

    // Check for existing session in backend
    const existing = await this.sessionManager.getSession(
      userId,
      platform,
      type as "multisig_wizard" | "swap_wizard" | "custom_flow"
    );
    if (existing.success && existing.session && existing.session.isActive) {
      return {
        message:
          `⚠️ You already have an active ${type} session. Type 'cancel' to abort or continue with the current step.\n\n` +
          workflow.getStepMessage(this.mapSessionToState(existing.session)),
      };
    }

    const result = workflow.start(userId, platform);

    // Create new session in backend
    const state: WorkflowState = {
      workflowId: "", // Will be set by backend
      userId,
      platform,
      type,
      step: result.nextStep || 1,
      data: result.data || {},
      isComplete: !!result.isComplete,
    };

    const saved = await this.sessionManager.saveSession({
      userId,
      platform,
      sessionType: type as "multisig_wizard" | "swap_wizard" | "custom_flow",
      step: state.step,
      sessionData: state.data as Record<
        string,
        string | number | boolean | null
      >,
    });

    if (saved.success && saved.session) {
      state.workflowId = saved.session.id;
      this.activeSessions.set(this.getSessionKey(userId, platform), state);
    }

    return result;
  }

  /**
   * Process user input for an active workflow
   */
  async handleInput(
    userId: string,
    platform: "discord" | "telegram",
    input: string
  ): Promise<WorkflowResult | null> {
    const key = this.getSessionKey(userId, platform);
    let state = this.activeSessions.get(key);

    // If not in cache, try to load from backend (resumable conversation)
    if (!state) {
      const activeSessions = await this.getActiveSessionsForUser(
        userId,
        platform
      );
      if (activeSessions.length > 0) {
        state = activeSessions[0]; // Take the most recent active session
        this.activeSessions.set(key, state);
      }
    }

    if (!state) return null; // No active workflow for this user

    const workflow = this.workflows.get(state.type);
    if (!workflow) return null;

    const trimmedInput = input.trim().toLowerCase();
    if (["cancel", "abort", "exit"].includes(trimmedInput)) {
      await this.sessionManager.deactivateSession(state.workflowId);
      this.activeSessions.delete(key);
      return {
        message: `❌ ${state.type} workflow cancelled.`,
        isComplete: true,
      };
    }

    const result = await workflow.processInput(state, input);

    // Update state
    state.step = result.nextStep ?? state.step;
    state.data = { ...state.data, ...(result.data || {}) };
    state.isComplete = !!result.isComplete;

    // Persist update to backend
    await this.sessionManager.updateSession(state.workflowId, {
      step: state.step,
      sessionData: state.data as Record<
        string,
        string | number | boolean | null
      >,
      isActive: !state.isComplete,
    });

    if (state.isComplete) {
      this.activeSessions.delete(key);
    }

    return result;
  }

  /**
   * Check if a risk level is allowed for a user based on backend preferences
   */
  async checkRiskPolicy(
    userId: string,
    riskLevel: "low" | "medium" | "high"
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const response = await fetch(
        `${this.backendUrl}/api/user/preferences/${userId}/check-risk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ riskLevel }),
        }
      );

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("Error checking risk policy:", error);
      return { allowed: true }; // Fallback to allowed if service is down
    }
  }

  /**
   * Get active sessions for a user from backend
   */
  private async getActiveSessionsForUser(
    userId: string,
    platform: "discord" | "telegram"
  ): Promise<WorkflowState[]> {
    // Note: The getSession API in sessionManager seems to only return one session per type.
    // We might need to iterate or rely on a specific type if needed.
    // For now, let's check common types.
    const types: Array<"multisig_wizard" | "swap_wizard" | "custom_flow"> = [
      "multisig_wizard",
      "swap_wizard",
      "custom_flow",
    ];
    const results: WorkflowState[] = [];

    for (const type of types) {
      const resp = await this.sessionManager.getSession(userId, platform, type);
      if (resp.success && resp.session && resp.session.isActive) {
        results.push(this.mapSessionToState(resp.session));
      }
    }

    return results;
  }

  private mapSessionToState(session: {
    id: string;
    userId: string;
    platform: string;
    sessionType: string;
    step: number;
    sessionData: Record<string, unknown>;
    isActive: boolean;
  }): WorkflowState {
    return {
      workflowId: session.id,
      userId: session.userId,
      platform: session.platform as "discord" | "telegram",
      type: session.sessionType,
      step: session.step,
      data: session.sessionData,
      isComplete: !session.isActive,
    };
  }

  private getSessionKey(
    userId: string,
    platform: "discord" | "telegram"
  ): string {
    return `${platform}:${userId}`;
  }
}

export const botWorkflowManager = new BotWorkflowManager();
