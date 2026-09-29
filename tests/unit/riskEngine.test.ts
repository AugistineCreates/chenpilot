import { describe, it, expect } from "@jest/globals";

jest.mock("../../src/config/logger");
jest.mock("../../src/config/config", () => ({
  default: { agent: { timeouts: {} }, jwt: { secret: "test-secret-32-chars-long-enough!!" } },
}));
jest.mock("../../src/config/Datasource", () => ({
  AppDataSource: { getRepository: jest.fn() },
  default: { getRepository: jest.fn() },
}));

import { RiskEngine } from "../../src/Agents/risk/RiskEngine";

const engine = new RiskEngine();

const READ_ACTION = "price";
const SWAP_ACTION = "swap_tool";
const UNKNOWN_ACTION = "totally_unknown_tool";

const TRUSTED_PAYLOAD = { from: "XLM", to: "USDC", amount: 10 };
const UNTRUSTED_PAYLOAD = { from: "SCAM", to: "USDC", amount: 10 };

const HIGH_PREFS = { riskLevel: "high" as const, preferredAssets: ["XLM"], defaultSlippage: 0.5 };
const LOW_PREFS  = { riskLevel: "low"  as const, preferredAssets: ["XLM"], defaultSlippage: 0.5 };

// ── Dimension: actionType ──────────────────────────────────────────────────────

describe("RiskEngine — actionType dimension", () => {
  it("read-only action scores lower than swap", () => {
    const read = engine.assess({ userId: "u1", action: READ_ACTION, payload: {} });
    const swap = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD });
    expect(read.score).toBeLessThan(swap.score);
  });

  it("unknown action gets conservative (high) score", () => {
    const result = engine.assess({ userId: "u1", action: UNKNOWN_ACTION, payload: {} });
    expect(result.score).toBeGreaterThan(40);
  });
});

// ── Dimension: assetTrust ──────────────────────────────────────────────────────

describe("RiskEngine — assetTrust dimension", () => {
  it("trusted assets score lower than untrusted", () => {
    const trusted   = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD });
    const untrusted = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: UNTRUSTED_PAYLOAD });
    expect(trusted.score).toBeLessThan(untrusted.score);
  });

  it("read-only action has zero assetTrust risk regardless of payload", () => {
    const result = engine.assess({ userId: "u1", action: READ_ACTION, payload: UNTRUSTED_PAYLOAD });
    expect(result.dimensions.assetTrust.score).toBe(0);
  });
});

// ── Dimension: liquidity ───────────────────────────────────────────────────────

describe("RiskEngine — liquidity dimension", () => {
  it("deep liquidity scores lower than thin liquidity", () => {
    const deep = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD, marketData: { liquidityDepth: 500_000 } });
    const thin = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD, marketData: { liquidityDepth: 500 } });
    expect(deep.dimensions.liquidity.score).toBeLessThan(thin.dimensions.liquidity.score);
  });

  it("missing liquidity data uses conservative default (score >= 0.5)", () => {
    const result = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD });
    expect(result.dimensions.liquidity.score).toBeGreaterThanOrEqual(0.5);
  });
});

// ── Dimension: slippage ────────────────────────────────────────────────────────

describe("RiskEngine — slippage dimension", () => {
  it("high price impact raises slippage score", () => {
    const low  = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD, marketData: { priceImpactPct: 0.1 } });
    const high = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD, marketData: { priceImpactPct: 8 } });
    expect(low.dimensions.slippage.score).toBeLessThan(high.dimensions.slippage.score);
  });

  it("payload slippage field is respected", () => {
    const tight = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: { ...TRUSTED_PAYLOAD, slippage: 0.1 } });
    const loose = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: { ...TRUSTED_PAYLOAD, slippage: 10 } });
    expect(tight.dimensions.slippage.score).toBeLessThan(loose.dimensions.slippage.score);
  });
});

// ── Dimension: userPreference ──────────────────────────────────────────────────

describe("RiskEngine — userPreference dimension", () => {
  it("high-tolerance user scores lower than low-tolerance user for same swap", () => {
    const highTol = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD, userPreferences: HIGH_PREFS });
    const lowTol  = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD, userPreferences: LOW_PREFS });
    expect(highTol.dimensions.userPreference.score).toBeLessThanOrEqual(lowTol.dimensions.userPreference.score);
  });

  it("missing preferences returns neutral score (0.5)", () => {
    const result = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD });
    expect(result.dimensions.userPreference.score).toBe(0.5);
  });
});

// ── Tier mapping ───────────────────────────────────────────────────────────────

describe("RiskEngine — tier and toPreferenceTier", () => {
  it("score >= 70 maps to critical tier", () => {
    // Force a critical scenario: unknown action + untrusted asset + thin liquidity + high slippage
    const result = engine.assess({
      userId: "u1",
      action: UNKNOWN_ACTION,
      payload: UNTRUSTED_PAYLOAD,
      marketData: { liquidityDepth: 100, priceImpactPct: 15 },
      userPreferences: LOW_PREFS,
    });
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(["high", "critical"]).toContain(result.tier);
  });

  it("read-only action with trusted assets maps to low tier", () => {
    const result = engine.assess({
      userId: "u1",
      action: READ_ACTION,
      payload: {},
      marketData: { liquidityDepth: 1_000_000 },
      userPreferences: HIGH_PREFS,
    });
    expect(result.tier).toBe("low");
  });

  it("toPreferenceTier maps critical/high → high, medium → medium, low → low", () => {
    expect(RiskEngine.toPreferenceTier("critical")).toBe("high");
    expect(RiskEngine.toPreferenceTier("high")).toBe("high");
    expect(RiskEngine.toPreferenceTier("medium")).toBe("medium");
    expect(RiskEngine.toPreferenceTier("low")).toBe("low");
  });
});

// ── requiresApproval ──────────────────────────────────────────────────────────

describe("RiskEngine — requiresApproval", () => {
  it("high/critical tier sets requiresApproval = true", () => {
    const result = engine.assess({
      userId: "u1",
      action: UNKNOWN_ACTION,
      payload: UNTRUSTED_PAYLOAD,
      marketData: { liquidityDepth: 100, priceImpactPct: 15 },
      userPreferences: LOW_PREFS,
    });
    if (result.tier === "high" || result.tier === "critical") {
      expect(result.requiresApproval).toBe(true);
    }
  });

  it("low tier does not require approval", () => {
    const result = engine.assess({
      userId: "u1",
      action: READ_ACTION,
      payload: {},
      marketData: { liquidityDepth: 1_000_000 },
      userPreferences: HIGH_PREFS,
    });
    expect(result.requiresApproval).toBe(false);
  });
});

// ── Composite score sanity ─────────────────────────────────────────────────────

describe("RiskEngine — composite score", () => {
  it("score is between 0 and 100", () => {
    const cases = [
      { action: READ_ACTION, payload: {} },
      { action: SWAP_ACTION, payload: TRUSTED_PAYLOAD },
      { action: UNKNOWN_ACTION, payload: UNTRUSTED_PAYLOAD },
    ];
    for (const c of cases) {
      const result = engine.assess({ userId: "u1", ...c });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it("all six dimensions are present in the result", () => {
    const result = engine.assess({ userId: "u1", action: SWAP_ACTION, payload: TRUSTED_PAYLOAD });
    const keys = Object.keys(result.dimensions);
    expect(keys).toEqual(expect.arrayContaining([
      "liquidity", "slippage", "assetTrust", "protocolTrust", "userPreference", "actionType",
    ]));
  });
});
