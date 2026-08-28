import { toolRegistry } from "../registry/ToolRegistry";
import { userPreferencesService } from "../../Auth/userPreferences.service";
import { riskEngine, RiskEngine } from "../risk/RiskEngine";
import { assetRevocationService } from "../../Security";
import logger from "../../config/logger";

export interface PolicyContext {
  userId: string;
  action: string;
  payload: Record<string, unknown>;
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

// Well-known trusted assets — revoked assets are checked dynamically against the revocation feed.
const WELL_KNOWN_ASSETS = new Set(["XLM", "USDC", "BTC", "ETH", "STRK"]);

// Tools that are always considered high-risk and require explicit approval
const HIGH_RISK_TOOLS = new Set(["swap_tool", "wallet_tool", "soroban_invoke", "strategyRegistry"]);

export class PolicyEnforcer {
  /**
   * Hard gate: every planned action must pass before execution.
   * Returns PolicyResult — callers MUST abort on allowed === false.
   */
  async enforce(ctx: PolicyContext): Promise<PolicyResult> {
    const { userId, action, payload } = ctx;

    // 1. Tool capability check — tool must exist and be enabled
    const toolCapabilityResult = this.checkToolCapability(action);
    if (!toolCapabilityResult.allowed) {
      logger.warn("Policy denied: tool capability", { userId, action, reason: toolCapabilityResult.reason });
      return toolCapabilityResult;
    }

    // 2. Asset trust check — any asset referenced in payload must be trusted
    const assetTrustResult = await this.checkAssetTrust(action, payload);
    if (!assetTrustResult.allowed) {
      logger.warn("Policy denied: asset trust", { userId, action, reason: assetTrustResult.reason });
      return assetTrustResult;
    }

    // 3. Risk engine assessment — replaces static RISK_TOOL_MAP
    let userPreferences: Parameters<typeof riskEngine.assess>[0]["userPreferences"];
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
      const toleranceCheck = await userPreferencesService.checkRiskTolerance(userId, riskTier);
      if (!toleranceCheck.allowed) {
        logger.warn("Policy denied: risk threshold", { userId, action, score: assessment.score, tier: assessment.tier });
        return {
          allowed: false,
          reason: toleranceCheck.reason,
          riskAssessment: assessment,
        };
      }
    } catch {
      // Preferences unavailable — block critical/high actions by default
      if (assessment.tier === "critical" || assessment.tier === "high") {
        return {
          allowed: false,
          reason: `Cannot verify risk tolerance for user '${userId}'. Action '${action}' (score ${assessment.score}) blocked.`,
          riskAssessment: assessment,
        };
      }
    }

    // 5. Approval check — high/critical risk requires explicit approval unless auto-approved
    if (assessment.requiresApproval) {
      const approvalResult = await this.checkApprovalRequirement(userId, action, payload, assessment);
      if (!approvalResult.allowed) {
        logger.warn("Policy denied: approval required", { userId, action, score: assessment.score });
        return { ...approvalResult, riskAssessment: assessment };
      }
    }

    logger.debug("Policy allowed", { userId, action, score: assessment.score, tier: assessment.tier });
    return { allowed: true, riskAssessment: assessment };
  }

  private checkToolCapability(action: string): PolicyResult {
    const tool = toolRegistry.getTool(action);
    if (!tool) {
      return {
        allowed: false,
        reason: `Tool '${action}' is not registered or is disabled. LLM-planned actions must reference known, enabled tools.`,
      };
    }
    return { allowed: true };
  }

  private async checkAssetTrust(action: string, payload: Record<string, unknown>): Promise<PolicyResult> {
    if (!HIGH_RISK_TOOLS.has(action)) return { allowed: true };

    const assetFields = ["from", "to", "asset", "token", "fromToken", "toToken"];
    for (const field of assetFields) {
      const value = payload[field];
      if (typeof value === "string" && value.trim()) {
        const upper = value.toUpperCase();

        // Check revocation feed first — a revoked asset is never trusted
        try {
          const revocation = await assetRevocationService.isRevoked(upper, "asset");
          if (revocation.revoked) {
            return {
              allowed: false,
              reason: `Asset '${value}' in field '${field}' is revoked: ${revocation.reason}.`,
            };
          }
        } catch {
          // Revocation service unavailable — log and continue
          logger.warn("Revocation check failed during policy enforcement", { asset: upper, field });
        }

        if (!WELL_KNOWN_ASSETS.has(upper)) {
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
    for (const field of ["amount", "value", "quantity"]) {
      const val = payload[field];
      if (typeof val === "number" && isFinite(val)) return val;
      if (typeof val === "string") { const n = parseFloat(val); if (isFinite(n)) return n; }
    }
    return null;
  }
}

export const policyEnforcer = new PolicyEnforcer();
