import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("../../src/config/logger");
jest.mock("../../src/config/config", () => ({
  default: {
    agent: { timeouts: { toolExecution: 30000, agentExecution: 60000 } },
    jwt: { secret: "test-secret-32-chars-long-enough!!" },
  },
}));
jest.mock("../../src/config/Datasource", () => ({
  AppDataSource: { getRepository: jest.fn() },
  default: { getRepository: jest.fn() },
}));

// Mock toolRegistry
const mockGetTool = jest.fn();
jest.mock("../../src/Agents/registry/ToolRegistry", () => ({
  toolRegistry: { getTool: mockGetTool },
}));

// Mock userPreferencesService
const mockCheckRiskTolerance = jest.fn();
const mockGetPreferencesForAgent = jest.fn();
jest.mock("../../src/Auth/userPreferences.service", () => ({
  userPreferencesService: {
    checkRiskTolerance: mockCheckRiskTolerance,
    getPreferencesForAgent: mockGetPreferencesForAgent,
  },
}));

import { PolicyEnforcer } from "../../src/Agents/policy/PolicyEnforcer";

const LOW_RISK_PREFS = {
  riskLevel: "low" as const,
  preferredAssets: ["XLM"],
  autoApproveSmallTransactions: false,
  smallTransactionThreshold: 10,
  defaultSlippage: null,
};

const AUTO_APPROVE_PREFS = {
  ...LOW_RISK_PREFS,
  riskLevel: "high" as const,
  autoApproveSmallTransactions: true,
  smallTransactionThreshold: 100,
};

describe("PolicyEnforcer", () => {
  let enforcer: PolicyEnforcer;

  beforeEach(() => {
    enforcer = new PolicyEnforcer();
    jest.clearAllMocks();
    // Default: tool exists, risk allowed, prefs available
    mockGetTool.mockReturnValue({ metadata: { name: "price" } });
    mockCheckRiskTolerance.mockResolvedValue({ allowed: true });
    mockGetPreferencesForAgent.mockResolvedValue(LOW_RISK_PREFS);
  });

  // ── 1. Tool capability ──────────────────────────────────────────────────────

  it("denies when tool is not registered", async () => {
    mockGetTool.mockReturnValue(undefined);
    const result = await enforcer.enforce({ userId: "u1", action: "unknown_tool", payload: {} });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not registered/);
  });

  it("allows when tool exists", async () => {
    const result = await enforcer.enforce({ userId: "u1", action: "price", payload: {} });
    expect(result.allowed).toBe(true);
  });

  // ── 2. Asset trust ──────────────────────────────────────────────────────────

  it("denies high-risk tool with untrusted asset in 'from' field", async () => {
    mockGetPreferencesForAgent.mockResolvedValue(AUTO_APPROVE_PREFS);
    mockCheckRiskTolerance.mockResolvedValue({ allowed: true });
    const result = await enforcer.enforce({
      userId: "u1",
      action: "swap",
      payload: { from: "SCAM", to: "XLM", amount: 5 },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/SCAM/);
  });

  it("allows high-risk tool with trusted assets when auto-approve and small amount", async () => {
    mockGetPreferencesForAgent.mockResolvedValue(AUTO_APPROVE_PREFS);
    mockCheckRiskTolerance.mockResolvedValue({ allowed: true });
    const result = await enforcer.enforce({
      userId: "u1",
      action: "swap",
      payload: { from: "XLM", to: "USDC", amount: 5 },
    });
    expect(result.allowed).toBe(true);
  });

  it("does not enforce asset trust on low-risk tools", async () => {
    const result = await enforcer.enforce({
      userId: "u1",
      action: "price",
      payload: { from: "ANYTHING" },
    });
    expect(result.allowed).toBe(true);
  });

  // ── 3. Risk threshold ───────────────────────────────────────────────────────

  it("denies when risk tolerance check fails", async () => {
    mockCheckRiskTolerance.mockResolvedValue({
      allowed: false,
      reason: "Transaction risk level (high) exceeds user's risk tolerance (low)",
    });
    const result = await enforcer.enforce({ userId: "u1", action: "price", payload: {} });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/risk tolerance/);
  });

  it("denies high-risk action when preferences service throws", async () => {
    mockCheckRiskTolerance.mockRejectedValue(new Error("DB error"));
    const result = await enforcer.enforce({ userId: "u1", action: "swap", payload: {} });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Cannot verify risk tolerance/);
  });

  it("allows low-risk action when preferences service throws", async () => {
    mockCheckRiskTolerance.mockRejectedValue(new Error("DB error"));
    // price is low-risk, so it should still be allowed
    const result = await enforcer.enforce({ userId: "u1", action: "price", payload: {} });
    expect(result.allowed).toBe(true);
  });

  // ── 4. Approval requirement ─────────────────────────────────────────────────

  it("denies high-risk tool without auto-approve", async () => {
    mockCheckRiskTolerance.mockResolvedValue({ allowed: true });
    mockGetPreferencesForAgent.mockResolvedValue(LOW_RISK_PREFS); // autoApprove = false
    const result = await enforcer.enforce({
      userId: "u1",
      action: "swap",
      payload: { from: "XLM", to: "USDC", amount: 5 },
    });
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it("denies high-risk tool with auto-approve but amount exceeds threshold", async () => {
    mockCheckRiskTolerance.mockResolvedValue({ allowed: true });
    mockGetPreferencesForAgent.mockResolvedValue(AUTO_APPROVE_PREFS); // threshold = 100
    const result = await enforcer.enforce({
      userId: "u1",
      action: "swap",
      payload: { from: "XLM", to: "USDC", amount: 200 },
    });
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it("allows high-risk tool with auto-approve and amount within threshold", async () => {
    mockCheckRiskTolerance.mockResolvedValue({ allowed: true });
    mockGetPreferencesForAgent.mockResolvedValue(AUTO_APPROVE_PREFS);
    const result = await enforcer.enforce({
      userId: "u1",
      action: "swap",
      payload: { from: "XLM", to: "USDC", amount: 50 },
    });
    expect(result.allowed).toBe(true);
  });

  it("denies high-risk tool when getPreferencesForAgent throws", async () => {
    mockCheckRiskTolerance.mockResolvedValue({ allowed: true });
    mockGetPreferencesForAgent.mockRejectedValue(new Error("DB error"));
    const result = await enforcer.enforce({
      userId: "u1",
      action: "swap",
      payload: { from: "XLM", to: "USDC", amount: 5 },
    });
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  // ── 5. Full allow path ──────────────────────────────────────────────────────

  it("allows a low-risk read-only action end-to-end", async () => {
    const result = await enforcer.enforce({
      userId: "u1",
      action: "price",
      payload: { asset: "XLM" },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
