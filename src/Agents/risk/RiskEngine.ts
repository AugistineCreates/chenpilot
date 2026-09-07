import logger from "../../config/logger";

// ── Types ──────────────────────────────────────────────────────────────────────

export type RiskTier = "low" | "medium" | "high" | "critical";

export interface RiskInput {
  userId: string;
  action: string;
  payload: Record<string, unknown>;
  /** Pre-fetched user preferences (optional — engine fetches if absent) */
  userPreferences?: {
    riskLevel: "low" | "medium" | "high";
    preferredAssets: string[];
    defaultSlippage: number | null;
  };
  /** Pre-fetched market data (optional — engine uses defaults if absent) */
  marketData?: {
    liquidityDepth?: number; // total liquidity in USD-equivalent
    priceImpactPct?: number; // estimated price impact %
    spreadPct?: number; // bid-ask spread %
    volatility24h?: number; // 24h price volatility %
  };
}

export interface DimensionScore {
  score: number; // 0–1, higher = riskier
  weight: number; // contribution weight
  reason: string;
}

export interface RiskAssessment {
  /** Weighted composite score 0–100 */
  score: number;
  tier: RiskTier;
  dimensions: {
    liquidity: DimensionScore;
    slippage: DimensionScore;
    assetTrust: DimensionScore;
    protocolTrust: DimensionScore;
    userPreference: DimensionScore;
    actionType: DimensionScore;
  };
  warnings: string[];
  /** Whether this assessment requires explicit user approval */
  requiresApproval: boolean;
}

// ── Static knowledge tables ────────────────────────────────────────────────────

/** Trusted, well-audited assets — score 0 (no risk). Unknown assets score 1. */
const TRUSTED_ASSETS = new Set(["XLM", "USDC", "USDT", "BTC", "ETH", "STRK", "DAI"]);

/** Protocol trust scores: 0 = fully trusted, 1 = unknown/unaudited */
const PROTOCOL_TRUST: Record<string, number> = {
  // Read-only / informational
  price: 0,
  sep1: 0,
  "soroban-contract-state": 0,
  get_liquidity_pool_stats: 0,
  "stellar-liquidity": 0,
  contact: 0,
  qa: 0,
  meta: 0,
  risk_analysis_tool: 0,
  checkBalance: 0,
  getData: 0,
  // Moderate — multi-hop routing adds complexity
  "multi-hop-trade": 0.4,
  // High-trust execution tools (audited, in production)
  swap: 0.2,
  swap_tool: 0.2,
  wallet: 0.3,
  wallet_tool: 0.3,
  transfer: 0.3,
  approveSpender: 0.3,
  provideLiquidity: 0.4,
  stake: 0.3,
  // Soroban: arbitrary contract execution — trust depends on contract
  soroban_invoke: 0.6,
  // Strategy registry: governance-level action
  strategyRegistry: 0.7,
};

/** Base action-type risk scores */
const ACTION_TYPE_RISK: Record<string, number> = {
  // Read
  price: 0,
  price_tool: 0,
  sep1: 0,
  sep1_tool: 0,
  "soroban-contract-state": 0,
  get_liquidity_pool_stats: 0,
  "stellar-liquidity": 0,
  contact: 0,
  qa: 0,
  meta: 0,
  risk_analysis_tool: 0,
  checkBalance: 0,
  getData: 0,
  // Write — moderate
  "multi-hop-trade": 0.45,
  wallet: 0.5,
  wallet_tool: 0.5,
  transfer: 0.3,
  approveSpender: 0.3,
  provideLiquidity: 0.4,
  stake: 0.3,
  // Write — high
  swap: 0.6,
  swap_tool: 0.6,
  soroban_invoke: 0.65,
  strategyRegistry: 0.75,
};

/** Dimension weights — must sum to 1 */
const WEIGHTS = {
  liquidity: 0.2,
  slippage: 0.2,
  assetTrust: 0.2,
  protocolTrust: 0.15,
  userPreference: 0.15,
  actionType: 0.1,
} as const;

// ── Tier thresholds (score 0–100) ──────────────────────────────────────────────
const TIER_THRESHOLDS: Array<[number, RiskTier]> = [
  [70, "critical"],
  [50, "high"],
  [30, "medium"],
  [0, "low"],
];

// ── RiskEngine ─────────────────────────────────────────────────────────────────

export class RiskEngine {
  /**
   * Assess the risk of a single planned action.
   * All inputs are optional beyond userId/action/payload — the engine
   * applies conservative defaults when data is unavailable.
   */
  assess(input: RiskInput): RiskAssessment {
    const { action, payload, userPreferences, marketData } = input;
    const safePayload = payload || {};
    const liquidity = this.scoreLiquidity(marketData);
    const slippage = this.scoreSlippage(
      safePayload,
      userPreferences,
      marketData
    );
    const assetTrust = this.scoreAssetTrust(action, safePayload);
    const protocolTrust = this.scoreProtocolTrust(action);
    const userPref = this.scoreUserPreference(action, userPreferences);
    const actionType = this.scoreActionType(action);

    const dimensions = {
      liquidity,
      slippage,
      assetTrust,
      protocolTrust,
      userPreference: userPref,
      actionType,
    };

    const score = Math.round(
      (liquidity.score * liquidity.weight +
        slippage.score * slippage.weight +
        assetTrust.score * assetTrust.weight +
        protocolTrust.score * protocolTrust.weight +
        userPref.score * userPref.weight +
        actionType.score * actionType.weight) *
        100
    );

    const tier = this.toTier(score);
    const warnings = this.collectWarnings(dimensions, score);
    const requiresApproval = tier === "high" || tier === "critical";

    logger.debug("RiskEngine assessment", {
      action,
      score,
      tier,
      userId: input.userId,
    });

    return { score, tier, dimensions, warnings, requiresApproval };
  }

  /** Convert a RiskAssessment tier to the 3-level scale used by userPreferences */
  static toPreferenceTier(tier: RiskTier): "low" | "medium" | "high" {
    if (tier === "critical" || tier === "high") return "high";
    if (tier === "medium") return "medium";
    return "low";
  }

  // ── Dimension scorers ────────────────────────────────────────────────────────

  private scoreLiquidity(marketData?: RiskInput["marketData"]): DimensionScore {
    const w = WEIGHTS.liquidity;
    if (!marketData?.liquidityDepth) {
      // No data — conservative: assume thin liquidity
      return {
        score: 0.6,
        weight: w,
        reason: "Liquidity data unavailable — assuming moderate risk",
      };
    }
    const depth = marketData.liquidityDepth;
    // < $1k: critical; < $10k: high; < $100k: medium; >= $100k: low
    const score =
      depth < 1_000
        ? 0.9
        : depth < 10_000
          ? 0.65
          : depth < 100_000
            ? 0.35
            : 0.1;
    return {
      score,
      weight: w,
      reason: `Liquidity depth $${depth.toLocaleString()}`,
    };
  }

  private scoreSlippage(
    payload: Record<string, unknown>,
    prefs?: RiskInput["userPreferences"],
    marketData?: RiskInput["marketData"]
  ): DimensionScore {
    const w = WEIGHTS.slippage;
    // Effective slippage = max(payload slippage, market price impact)
    const payloadSlippage =
      this.extractNumber(payload, ["slippage"]) ??
      prefs?.defaultSlippage ??
      0.5;
    const priceImpact = marketData?.priceImpactPct ?? 0;
    const effective = Math.max(payloadSlippage, priceImpact);

    // 0–0.5%: low; 0.5–2%: medium; 2–5%: high; >5%: critical
    const score =
      effective > 5 ? 0.9 : effective > 2 ? 0.65 : effective > 0.5 ? 0.35 : 0.1;
    return {
      score,
      weight: w,
      reason: `Effective slippage ${effective.toFixed(2)}%`,
    };
  }

  private scoreAssetTrust(
    action: string,
    payload: Record<string, unknown>
  ): DimensionScore {
    const w = WEIGHTS.assetTrust;
    // Only relevant for financial operations
    if (ACTION_TYPE_RISK[action] === 0) {
      return {
        score: 0,
        weight: w,
        reason: "Read-only action — no asset risk",
      };
    }
    const assetFields = [
      "from",
      "to",
      "asset",
      "token",
      "fromToken",
      "toToken",
    ];
    const untrusted: string[] = [];
    for (const field of assetFields) {
      const val = payload[field];
      if (typeof val === "string" && val.trim()) {
        if (!TRUSTED_ASSETS.has(val.toUpperCase())) untrusted.push(val);
      }
    }
    if (untrusted.length === 0)
      return { score: 0.1, weight: w, reason: "All assets are trusted" };
    return {
      score: Math.min(0.5 + untrusted.length * 0.25, 1),
      weight: w,
      reason: `Untrusted asset(s): ${untrusted.join(", ")}`,
    };
  }

  private scoreProtocolTrust(action: string): DimensionScore {
    const w = WEIGHTS.protocolTrust;
    const score = PROTOCOL_TRUST[action] ?? 0.8; // unknown protocol = high risk
    const reason =
      score === 0
        ? "Trusted read-only protocol"
        : score < 0.4
          ? "Audited execution protocol"
          : score < 0.7
            ? "Moderate protocol trust"
            : "Unknown or unaudited protocol";
    return { score, weight: w, reason };
  }

  private scoreUserPreference(
    action: string,
    prefs?: RiskInput["userPreferences"]
  ): DimensionScore {
    const w = WEIGHTS.userPreference;
    if (!prefs)
      return {
        score: 0.5,
        weight: w,
        reason: "User preferences unavailable — neutral",
      };

    const actionRisk = ACTION_TYPE_RISK[action] ?? 0.5;
    const toleranceMap: Record<string, number> = {
      low: 0.3,
      medium: 0.6,
      high: 1.0,
    };
    const tolerance = toleranceMap[prefs.riskLevel] ?? 0.6;

    // Score = how much the action risk exceeds the user's tolerance
    const excess = Math.max(0, actionRisk - tolerance);
    const score = Math.min(excess * 2, 1); // scale excess to 0–1
    return {
      score,
      weight: w,
      reason:
        score > 0
          ? `Action risk (${(actionRisk * 100).toFixed(0)}%) exceeds user tolerance (${prefs.riskLevel})`
          : `Action within user risk tolerance (${prefs.riskLevel})`,
    };
  }

  private scoreActionType(action: string): DimensionScore {
    const w = WEIGHTS.actionType;
    const score = ACTION_TYPE_RISK[action] ?? 0.5;
    return {
      score,
      weight: w,
      reason: `Action type base risk: ${(score * 100).toFixed(0)}%`,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private toTier(score: number): RiskTier {
    for (const [threshold, tier] of TIER_THRESHOLDS) {
      if (score >= threshold) return tier;
    }
    return "low";
  }

  private collectWarnings(
    dims: RiskAssessment["dimensions"],
    score: number
  ): string[] {
    const w: string[] = [];
    if (dims.liquidity.score >= 0.6) w.push(dims.liquidity.reason);
    if (dims.slippage.score >= 0.6) w.push(dims.slippage.reason);
    if (dims.assetTrust.score >= 0.5) w.push(dims.assetTrust.reason);
    if (dims.protocolTrust.score >= 0.6) w.push(dims.protocolTrust.reason);
    if (dims.userPreference.score > 0) w.push(dims.userPreference.reason);
    if (score >= 70)
      w.push("Overall risk is CRITICAL — action blocked pending review");
    else if (score >= 50)
      w.push("Overall risk is HIGH — explicit approval required");
    return w;
  }

  private extractNumber(
    payload: Record<string, unknown>,
    fields: string[]
  ): number | null {
    for (const f of fields) {
      const v = payload[f];
      if (typeof v === "number" && isFinite(v)) return v;
      if (typeof v === "string") {
        const n = parseFloat(v);
        if (isFinite(n)) return n;
      }
    }
    return null;
  }
}

export const riskEngine = new RiskEngine();
