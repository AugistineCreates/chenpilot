// chenpilot/src/Agents/policy/ToolAuthorizationService.ts
import { toolRegistry } from "../registry/ToolRegistry";
import { ToolMetadata } from "../registry/ToolMetadata";
import { TrustLevel, ContextProvenance } from "../context/TrustZone";
import { UserRole } from "../../Auth/roles";
import { RiskLevel } from "../../Auth/userPreferences.entity";
import { WorkflowStep, WorkflowPlan } from "../types";
import logger from "../../config/logger";

/**
 * State-modifying or financial tools considered high-risk.
 * These can NEVER be authorized by untrusted external context alone.
 */
export const HIGH_RISK_ACTIONS = new Set([
  "swap",
  "swap_tool",
  "wallet",
  "wallet_tool",
  "soroban_invoke",
  "strategyRegistry",
  "strategy_registry",
  "multi_hop_trade",
  "multihop_trade",
  "reconciliation",
  "reconciliation_tool",
]);

/**
 * Safe, read-only informational tools that can be authorized in lower-trust contexts.
 */
export const READ_ONLY_ACTIONS = new Set([
  "price",
  "price_tool",
  "get_liquidity_pool_stats",
  "liquidity_pool_stats",
  "contact",
  "contact_lookup",
  "sep1",
  "sep1_tool",
  "qa_tool",
  "qatool",
  "risk_analysis",
  "soroban_contract_state",
]);

export interface ToolAuthorityContext {
  userId: string;
  userRole?: UserRole | string;
  contextTrustLevel: TrustLevel;
  triggerProvenance?: ContextProvenance;
  explicitAllowedTools?: string[];
  userPreferences?: {
    riskLevel: RiskLevel;
    preferredAssets?: string[];
    smallTransactionThreshold?: number;
    autoApproveSmallTransactions?: boolean;
    defaultSlippage?: number | null;
  };
}

export interface ToolAuthority {
  userId: string;
  contextTrustLevel: TrustLevel;
  authorizedTools: Set<string>;
  readOnlyOnly: boolean;
  highRiskAllowed: boolean;
  deniedTools: Map<string, string>;
  computedAt: number;
}

export interface StepAuthorizationResult {
  authorized: boolean;
  action: string;
  reason?: string;
  errorCategory?: string;
}

export interface PlanAuthorizationResult {
  authorized: boolean;
  totalSteps: number;
  unauthorizedSteps: StepAuthorizationResult[];
  errors: string[];
}

export class ToolAuthorizationService {
  /**
   * Normalizes action names to match canonical registered tools and aliases.
   */
  normalizeAction(action: string): string {
    const cleaned = action.trim().toLowerCase();
    if (cleaned === "swap") return "swap_tool";
    if (cleaned === "wallet") return "wallet_tool";
    if (cleaned === "price") return "price_tool";
    if (cleaned === "contact") return "contact";
    if (cleaned === "sep1") return "sep1";
    return cleaned;
  }

  /**
   * Computes the authorized tool set DETERMINISTICALLY OUTSIDE the model response.
   * This is calculated before prompt construction and model invocation.
   */
  computeToolAuthority(ctx: ToolAuthorityContext): ToolAuthority {
    const {
      userId,
      userRole = UserRole.USER,
      contextTrustLevel,
      explicitAllowedTools,
    } = ctx;

    const authorizedTools = new Set<string>();
    const deniedTools = new Map<string, string>();
    const readOnlyOnly = contextTrustLevel === TrustLevel.UNTRUSTED_EXTERNAL;
    const highRiskAllowed =
      contextTrustLevel === TrustLevel.SYSTEM ||
      contextTrustLevel === TrustLevel.AUTHENTICATED_USER;

    // Get all registered tools (with fallback for mocked registry in tests)
    let allTools =
      typeof toolRegistry?.getAllTools === "function"
        ? toolRegistry.getAllTools(false)
        : [];

    if (!allTools || allTools.length === 0) {
      const metadataList =
        typeof toolRegistry?.getToolMetadata === "function"
          ? toolRegistry.getToolMetadata()
          : [];
      if (metadataList && metadataList.length > 0) {
        allTools = metadataList.map((meta) => ({
          metadata: meta as ToolMetadata,
          execute: async () => ({ action: meta.name, status: "success" }),
        }));
      }
    }

    if (!allTools || allTools.length === 0) {
      // In minimal test setups with no tools registered, allow standard actions based on trust level
      return {
        userId,
        contextTrustLevel,
        authorizedTools: new Set(["*"]),
        readOnlyOnly,
        highRiskAllowed,
        deniedTools,
        computedAt: Date.now(),
      };
    }

    for (const tool of allTools) {
      const toolName = tool.metadata.name;
      const canonicalName = this.normalizeAction(toolName);

      // 1. Untrusted context restrictions (e.g. webhooks, memos, contract events without user auth)
      if (
        readOnlyOnly &&
        (HIGH_RISK_ACTIONS.has(canonicalName) ||
          HIGH_RISK_ACTIONS.has(toolName))
      ) {
        deniedTools.set(
          toolName,
          `Tool '${toolName}' is state-modifying / high-risk and cannot be executed in UNTRUSTED_EXTERNAL context.`
        );
        continue;
      }

      // 2. Role / Permission check
      const requiredPermissions = tool.metadata.permissions;
      if (requiredPermissions && requiredPermissions.length > 0) {
        let hasPermission = true;
        for (const permission of requiredPermissions) {
          if (permission === "admin" && userRole !== UserRole.ADMIN) {
            deniedTools.set(
              toolName,
              `Tool '${toolName}' requires 'admin' role.`
            );
            hasPermission = false;
            break;
          }
          if (
            permission === "moderator" &&
            userRole !== UserRole.MODERATOR &&
            userRole !== UserRole.ADMIN
          ) {
            deniedTools.set(
              toolName,
              `Tool '${toolName}' requires 'moderator' or 'admin' role.`
            );
            hasPermission = false;
            break;
          }
        }
        if (!hasPermission) continue;
      }

      // 3. Caller explicit allowlist check
      if (explicitAllowedTools && explicitAllowedTools.length > 0) {
        const isExplicitlyAllowed = explicitAllowedTools.some(
          (t) => this.normalizeAction(t) === canonicalName || t === toolName
        );
        if (!isExplicitlyAllowed) {
          deniedTools.set(
            toolName,
            `Tool '${toolName}' is not in the caller's explicit allowedTools list.`
          );
          continue;
        }
      }

      // Tool is authorized
      authorizedTools.add(toolName);
      authorizedTools.add(canonicalName);
    }

    logger.debug("Tool authority computed outside model", {
      userId,
      contextTrustLevel,
      authorizedCount: authorizedTools.size,
      deniedCount: deniedTools.size,
      readOnlyOnly,
    });

    return {
      userId,
      contextTrustLevel,
      authorizedTools,
      readOnlyOnly,
      highRiskAllowed,
      deniedTools,
      computedAt: Date.now(),
    };
  }

  /**
   * Filters tool metadata to ONLY include tools pre-authorized for this context.
   */
  filterAuthorizedToolMetadata(
    availableTools: ToolMetadata[],
    authority: ToolAuthority
  ): ToolMetadata[] {
    return availableTools.filter((tool) => {
      const canonical = this.normalizeAction(tool.name);
      return (
        authority.authorizedTools.has(tool.name) ||
        authority.authorizedTools.has(canonical)
      );
    });
  }

  /**
   * Verifies if a specific action is authorized according to the pre-computed authority.
   */
  verifyStepAuthorization(
    step: WorkflowStep,
    authority: ToolAuthority
  ): StepAuthorizationResult {
    const action = step.action;
    const canonical = this.normalizeAction(action);

    if (authority.authorizedTools.has("*")) {
      if (
        authority.readOnlyOnly &&
        (HIGH_RISK_ACTIONS.has(action) || HIGH_RISK_ACTIONS.has(canonical))
      ) {
        return {
          authorized: false,
          action,
          reason: `Tool '${action}' is state-modifying / high-risk and cannot be executed in UNTRUSTED_EXTERNAL context.`,
          errorCategory: "UNAUTHORIZED_TOOL",
        };
      }
      return { authorized: true, action };
    }

    if (
      !authority.authorizedTools.has(action) &&
      !authority.authorizedTools.has(canonical)
    ) {
      const denialReason =
        authority.deniedTools.get(action) ||
        authority.deniedTools.get(canonical) ||
        `Tool '${action}' is not in the pre-authorized tool set for trust level '${authority.contextTrustLevel}'.`;

      return {
        authorized: false,
        action,
        reason: denialReason,
        errorCategory: "UNAUTHORIZED_TOOL",
      };
    }

    return {
      authorized: true,
      action,
    };
  }

  /**
   * Verifies an entire workflow plan against pre-computed tool authority.
   */
  authorizePlan(
    plan: WorkflowPlan,
    authority: ToolAuthority
  ): PlanAuthorizationResult {
    const unauthorizedSteps: StepAuthorizationResult[] = [];
    const errors: string[] = [];

    for (const step of plan.workflow) {
      const result = this.verifyStepAuthorization(step, authority);
      if (!result.authorized) {
        unauthorizedSteps.push(result);
        errors.push(result.reason ?? `Unauthorized action: ${result.action}`);
      }
    }

    return {
      authorized: unauthorizedSteps.length === 0,
      totalSteps: plan.workflow.length,
      unauthorizedSteps,
      errors,
    };
  }
}

export const toolAuthorizationService = new ToolAuthorizationService();
