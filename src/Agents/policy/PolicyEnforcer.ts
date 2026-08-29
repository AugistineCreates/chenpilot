// chenpilot/src/Agents/policy/PolicyEnforcer.ts
import { toolRegistry } from "../registry/ToolRegistry";
import { userPreferencesService } from "../../Auth/userPreferences.service";
import { riskEngine, RiskEngine } from "../risk/RiskEngine";
import { TrustLevel, ContextProvenance } from "../context/TrustZone";
import { toolAuthorizationService } from "./ToolAuthorizationService";
import {
  securityAuditor,
  SecurityEventType,
} from "../../Security/promptIsolation/SecurityAuditor";
import logger from "../../config/logger";

export interface PolicyContext {
  userId: string;
  action: string;
  payload: Record<string, unknown>;
  trustLevel?: TrustLevel;
  provenance?: ContextProvenance;
  /** Optional pre-fetched market data — passed through to RiskEngine */
  marketData?: {
    liquidityDepth?: number;
    priceImpactPct?: number;
    spreadPct?: number;
    volatility24h?: number;
  };
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
  /** Full risk assessment — available even on denial */
  riskAssessment?: ReturnType<typeof riskEngine.assess>;
}

// Assets considered trusted (well-known, liquid)
const TRUSTED_ASSETS = new Set([
  "XLM",
  "USDC",
  "BTC",
  "ETH",
  "STRK",
  "USDT",
  "DAI",
]);

// Tools that are always considered high-risk and require explicit approval
const HIGH_RISK_TOOLS = new Set([
  "swap",
  "swap_tool",
  "wallet",
  "wallet_tool",
  "soroban_invoke",
  "strategyRegistry",
  "strategy_registry",
  "multi_hop_trade",
  "reconciliation",
  "reconciliation_tool",
]);

export class PolicyEnforcer {
  private normalizeAction(action: string): string {
    return toolAuthorizationService.normalizeAction(action);
  }

  /**
   * Hard gate: every planned action must pass before execution.
   * Returns PolicyResult — callers MUST abort on allowed === false.
   */
  async enforce(ctx: PolicyContext): Promise<PolicyResult> {
    const { userId, action, payload } = ctx;
    const canonicalAction = this.normalizeAction(action);
    const trustLevel = ctx.trustLevel ?? TrustLevel.AUTHENTICATED_USER;

    // 0. Trust zone boundary check — untrusted external triggers cannot execute high-risk tools
    if (trustLevel === TrustLevel.UNTRUSTED_EXTERNAL) {
      if (HIGH_RISK_TOOLS.has(action) || HIGH_RISK_TOOLS.has(canonicalAction)) {
        const reason = `Security policy denial: Action '${action}' is high-risk / state-modifying and cannot be triggered from untrusted external context.`;
        logger.warn("Policy denied: untrusted context execution attempt", {
          userId,
          action,
          trustLevel,
          reason,
        });
        securityAuditor.logSecurityEvent({
          eventType: SecurityEventType.UNAUTHORIZED_TOOL_REJECTED,
          provenance: ctx.provenance ?? ContextProvenance.EXTERNAL_API,
          trustLevel,
          rawPayload: JSON.stringify({ action, payload }),
          threatCategory: "UNAUTHORIZED_TOOL_TRIGGER",
          userId,
          action,
        });
        return {
          allowed: false,
          reason,
        };
      }
    }

    // 1. Tool capability check — tool must exist and be enabled
    const toolCapabilityResult = this.checkToolCapability(action);
    if (!toolCapabilityResult.allowed) {
      logger.warn("Policy denied: tool capability", {
        userId,
        action,
        reason: toolCapabilityResult.reason,
      });
      return toolCapabilityResult;
    }

    // 2. Asset trust check — any asset referenced in payload must be trusted
    const assetTrustResult = this.checkAssetTrust(action, payload);
    if (!assetTrustResult.allowed) {
      logger.warn("Policy denied: asset trust", {
        userId,
        action,
        reason: assetTrustResult.reason,
      });
      return assetTrustResult;
    }

    // 3. Risk engine assessment — replaces static RISK_TOOL_MAP
    let userPreferences: Parameters<
      typeof riskEngine.assess
    >[0]["userPreferences"];
    try {
      const prefs = await userPreferencesService.getPreferencesForAgent(userId);
      userPreferences = {
        riskLevel: prefs.riskLevel,
        preferredAssets: prefs.preferredAssets,
        defaultSlippage: prefs.defaultSlippage,
      };
    } catch {
      // Preferences unavailable — engine will apply conservative defaults
    }

    const assessment = riskEngine.assess({
      userId,
      action,
      payload,
      userPreferences,
      marketData: ctx.marketData,
    });

    // 4. Risk threshold check — block if score exceeds user tolerance
    const riskTier = RiskEngine.toPreferenceTier(assessment.tier);
    try {
      const toleranceCheck = await userPreferencesService.checkRiskTolerance(
        userId,
        riskTier
      );
      if (!toleranceCheck.allowed) {
        logger.warn("Policy denied: risk threshold", {
          userId,
          action,
          score: assessment.score,
          tier: assessment.tier,
        });
        return {
          allowed: false,
          reason: toleranceCheck.reason,
          riskAssessment: assessment,
        };
      }
    } catch {
      // Preferences unavailable — block critical/high actions or high-risk tools by default
      if (
        assessment.tier === "critical" ||
        assessment.tier === "high" ||
        HIGH_RISK_TOOLS.has(action) ||
        HIGH_RISK_TOOLS.has(canonicalAction)
      ) {
        return {
          allowed: false,
          reason: `Cannot verify risk tolerance for user '${userId}'. Action '${action}' (score ${assessment.score}) blocked.`,
          riskAssessment: assessment,
        };
      }
    }

    // 5. Approval check — high/critical risk or HIGH_RISK_TOOLS requires explicit approval unless auto-approved
    const isHighRiskAction =
      assessment.requiresApproval ||
      assessment.tier === "high" ||
      assessment.tier === "critical" ||
      HIGH_RISK_TOOLS.has(action) ||
      HIGH_RISK_TOOLS.has(canonicalAction);

    if (isHighRiskAction) {
      const approvalResult = await this.checkApprovalRequirement(
        userId,
        action,
        payload,
        assessment
      );
      if (!approvalResult.allowed) {
        logger.warn("Policy denied: approval required", {
          userId,
          action,
          score: assessment.score,
        });
        return { ...approvalResult, riskAssessment: assessment };
      }
    }

    logger.debug("Policy allowed", {
      userId,
      action,
      score: assessment.score,
      tier: assessment.tier,
    });
    return { allowed: true, riskAssessment: assessment };
  }

  private checkToolCapability(action: string): PolicyResult {
    const canonical = this.normalizeAction(action);
    const tool =
      toolRegistry.getTool(action) || toolRegistry.getTool(canonical);
    if (!tool) {
      return {
        allowed: false,
        reason: `Tool '${action}' is not registered or is disabled. LLM-planned actions must reference known, enabled tools.`,
      };
    }
    return { allowed: true };
  }

  private checkAssetTrust(
    action: string,
    payload: Record<string, unknown>
  ): PolicyResult {
    const canonical = this.normalizeAction(action);
    if (!HIGH_RISK_TOOLS.has(action) && !HIGH_RISK_TOOLS.has(canonical)) {
      return { allowed: true };
    }

    const assetFields = [
      "from",
      "to",
      "asset",
      "token",
      "fromToken",
      "toToken",
    ];
    for (const field of assetFields) {
      const value = payload[field];
      if (typeof value === "string" && value.trim()) {
        if (!TRUSTED_ASSETS.has(value.toUpperCase())) {
          return {
            allowed: false,
            reason: `Asset '${value}' in field '${field}' is not on the trusted asset list.`,
          };
        }
      }
    }
    return { allowed: true };
  }

  private async checkApprovalRequirement(
    userId: string,
    action: string,
    payload: Record<string, unknown>,
    assessment: ReturnType<typeof riskEngine.assess>
  ): Promise<PolicyResult> {
    try {
      const prefs = await userPreferencesService.getPreferencesForAgent(userId);
      if (prefs.autoApproveSmallTransactions) {
        const amount = this.extractAmount(payload);
        if (amount !== null && amount <= prefs.smallTransactionThreshold) {
          return { allowed: true };
        }
      }
    } catch {
      // fall through to denial
    }

    return {
      allowed: false,
      requiresApproval: true,
      reason: `Action '${action}' (risk score ${assessment.score}, tier ${assessment.tier}) requires explicit user approval.`,
    };
  }

  private extractAmount(payload: Record<string, unknown>): number | null {
    if (!payload) return null;
    for (const field of ["amount", "value", "quantity"]) {
      const val = payload[field];
      if (typeof val === "number" && isFinite(val)) return val;
      if (typeof val === "string") {
        const n = parseFloat(val);
        if (isFinite(n)) return n;
      }
    }
    return null;
  }
}

export const policyEnforcer = new PolicyEnforcer();
