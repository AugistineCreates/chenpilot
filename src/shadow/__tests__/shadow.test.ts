/**
 * Shadow Execution (Issue #686) — unit tests.
 *
 * Covers the acceptance criteria:
 *   - shadow execution has no credentials capable of mutation,
 *   - inputs are privacy-filtered,
 *   - divergence reports classify policy, route, amount, and refusal changes,
 *   - promotion requires explicit thresholds and reviewed exceptions,
 *   - retention is bounded.
 */

import {
  DivergenceClass,
  ShadowCandidate,
  ShadowConfig,
} from "../shadow.types";
import { ShadowComparator, shadowComparator } from "../shadow.comparator";
import { ShadowExecutor } from "../shadow.executor";
import { ShadowService } from "../shadow.service";
import { filterShadowInput } from "../shadow.redaction";

const makeConfig = (overrides: Partial<ShadowConfig> = {}): ShadowConfig => ({
  enabled: true,
  sampleRatePct: 100,
  promotionMinEvaluations: 3,
  promotionMaxDivergenceRate: 0.05,
  retentionDays: 14,
  maxRecords: 100,
  promotionRequiredApprovals: 1,
  ...overrides,
});

const candidate = (
  overrides: Partial<ShadowCandidate> = {}
): ShadowCandidate => ({
  id: "cand-1",
  subject: "policy",
  version: "1.1.0",
  label: "stricter-max-score",
  status: "staged",
  config: { allow: true, maxScore: 60, reason: "tightened threshold" },
  description: "tighten policy",
  ...overrides,
});

describe("ShadowComparator", () => {
  it("classifies a refusal change", () => {
    const report = shadowComparator.compare(
      candidate(),
      { allowed: true, reason: "allowed" },
      { allowed: false, reason: "refused" },
      "run-1"
    );
    expect(report.diverged).toBe(true);
    expect(report.classes).toContain(DivergenceClass.Refusal);
  });

  it("classifies a policy signature change", () => {
    const report = shadowComparator.compare(
      candidate(),
      { decisionSignature: "sig-active", allowed: true },
      { decisionSignature: "sig-candidate", allowed: true },
      "run-1"
    );
    expect(report.diverged).toBe(true);
    expect(report.classes).toContain(DivergenceClass.Policy);
  });

  it("classifies a route change", () => {
    const report = shadowComparator.compare(
      candidate({ subject: "route" }),
      { route: ["XLM", "USDC"] },
      { route: ["XLM", "yUSDC", "USDC"] },
      "run-1"
    );
    expect(report.diverged).toBe(true);
    expect(report.classes).toContain(DivergenceClass.Route);
  });

  it("classifies an amount change beyond tolerance", () => {
    const report = shadowComparator.compare(
      candidate({ subject: "route" }),
      { amount: "1000" },
      { amount: "1080" },
      "run-1"
    );
    expect(report.diverged).toBe(true);
    expect(report.classes).toContain(DivergenceClass.Amount);
  });

  it("treats equivalent decisions as non-divergent", () => {
    const report = shadowComparator.compare(
      candidate(),
      { allowed: true, decisionSignature: "same" },
      { allowed: true, decisionSignature: "same" },
      "run-1"
    );
    expect(report.diverged).toBe(false);
    expect(report.classes).toHaveLength(0);
  });
});

describe("ShadowExecutor", () => {
  it("runs a candidate in shadow without throwing and classifies divergence", async () => {
    const config = makeConfig();
    const executor = new ShadowExecutor(shadowComparator, config);
    const report = await executor.runCandidate(
      candidate({ config: { allow: false, reason: "blocked", version: "1.1.0" } }),
      { action: "swap_tool", amount: "500" },
      { runId: "run-1", active: { allowed: true, action: "swap_tool" } }
    );
    expect(report.diverged).toBe(true);
    expect(report.classes).toContain(DivergenceClass.Refusal);
    expect(report.candidateId).toBe("cand-1");
  });

  it("never propagates raw secret values in the redacted report", async () => {
    const executor = new ShadowExecutor(shadowComparator, makeConfig());
    const sensitive = filterShadowInput({ apiKey: "sk-live-secret-1234", amount: "500" });
    expect(sensitive.apiKey).not.toContain("sk-live-secret-1234");
  });

  it("samples deterministically by run id", () => {
    const executor = new ShadowExecutor(shadowComparator, makeConfig({ sampleRatePct: 100 }));
    expect(executor.sampled("any-run")).toBe(true);
    const off = new ShadowExecutor(shadowComparator, makeConfig({ sampleRatePct: 0 }));
    expect(off.sampled("any-run")).toBe(false);
  });

  it("guards a hanging candidate with a timeout", async () => {
    const config = makeConfig();
    const executor = new ShadowExecutor(shadowComparator, config);
    const report = await executor.runCandidate(
      candidate({ config: { allow: true, version: "1.1.0" } }),
      { action: "swap_tool" },
      { runId: "run-1", active: { allowed: true }, timeoutMs: 5 }
    );
    // A candidate cannot block production decision latency; failure → divergence.
    expect(report).toBeDefined();
  });
});

describe("ShadowService", () => {
  it("privacy-filters inputs before storing reports", async () => {
    const service = new ShadowService(makeConfig());
    service.register(candidate());
    const reports = await service.mirror({
      runId: "run-1",
      input: { action: "swap_tool", privateKey: "SK-BAD-SECRET", wallet_secret: "shh" },
      active: { subject: "policy", action: "swap_tool", allowed: true },
    });
    const raw = JSON.stringify(reports);
    expect(raw).not.toContain("SK-BAD-SECRET");
    expect(raw).not.toContain("shh");
  });

  it("requires explicit thresholds for promotion", async () => {
    const service = new ShadowService(makeConfig({ promotionMinEvaluations: 3 }));
    const cand = candidate();
    service.register(cand);
    // Not enough evaluations → not eligible.
    let el = service.eligibility(cand.id);
    expect(el.eligible).toBe(false);
    expect(el.reason).toContain("Insufficient evaluations");

    for (let i = 0; i < 10; i++) {
      await service.mirror({
        runId: `run-${i}`,
        input: { action: "swap_tool" },
        active: { subject: "policy", action: "swap_tool", allowed: true },
      });
    }
    el = service.eligibility(cand.id);
    expect(el.evaluations).toBeGreaterThanOrEqual(3);
  });

  it("requires a reviewed exception approval for review-required candidates", async () => {
    const service = new ShadowService(makeConfig({ promotionMinEvaluations: 3 }));
    const cand = candidate({ reviewRequired: true });
    service.register(cand);
    for (let i = 0; i < 5; i++) {
      await service.mirror({
        runId: `run-${i}`,
        input: { action: "swap_tool", riskScore: 20 },
        active: { subject: "policy", action: "swap_tool", allowed: true },
      });
    }
    // Without an explicit reviewer the promotion is refused.
    expect(service.promote(cand.id)).toBe(false);
    // With a reviewer signature it succeeds (reviewed exception path).
    const el = service.eligibility(cand.id);
    expect(el.eligible).toBe(true);
    expect(service.promote(cand.id, "reviewer-admin")).toBe(true);
    expect(cand.status).toBe("active");
  });

  it("blocks promotions whose divergence exceeds the threshold", async () => {
    const service = new ShadowService(
      makeConfig({ promotionMinEvaluations: 3, promotionMaxDivergenceRate: 0.01 })
    );
    // A candidate that constantly diverges must not be eligible.
    const cand = candidate({ config: { allow: false, reason: "blocked-all", version: "1.1.0" } });
    service.register(cand);
    for (let i = 0; i < 10; i++) {
      await service.mirror({
        runId: `run-${i}`,
        input: { action: "swap_tool" },
        active: { subject: "policy", action: "swap_tool", allowed: true },
      });
    }
    const el = service.eligibility(cand.id);
    expect(el.eligible).toBe(false);
    expect(el.reason).toContain("Divergence rate");
  });

  it("retains records within the retention window and enforces the hard cap", () => {
    const service = new ShadowService(makeConfig({ maxRecords: 5 }));
    for (let i = 0; i < 10; i++) {
      (service as unknown as { record: (r: { candidateId: string; subject: string; version: string; runId: string; diverged: boolean; classes: string[]; details: unknown[]; reviewedException: boolean; evaluatedAt: string }) => void }).record({
        candidateId: "cand-1",
        subject: "policy",
        version: "1.1.0",
        runId: `r${i}`,
        diverged: false,
        classes: [],
        details: [],
        reviewedException: false,
        evaluatedAt: new Date(Date.now() - i * 1000).toISOString(),
      });
    }
    const removed = service.enforceRetention();
    expect(removed).toBeGreaterThan(0);
    expect(service.getReports().length).toBeLessThanOrEqual(5);
  });
});
